import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { isAddress } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import { domixAbi } from '@/contracts/abis'
import type { DomainInfo } from '@/hooks/useDomain'
import { useTx } from '@/hooks/useTx'
import { useNetwork } from '@/lib/network'
import { getProtocol, registrarAbi, registryAbi, resolverAbi, shortAddress } from '@/lib/protocol'
import { CheckCircle2, Circle } from 'lucide-react'
import { Button, Field, Input, TxBanner } from '../ui'

export function TransferPanel({ info }: { info: DomainInfo }) {
  const { address } = useAccount()
  const tx = useTx()
  const [to, setTo] = useState('')
  const valid = isAddress(to) && to.toLowerCase() !== address?.toLowerCase()

  const transfer = async () => {
    if (!address || !isAddress(to)) return
    await tx.run(`Transfer ${info.full}`, {
      to: info.collection,
      abi: registrarAbi,
      functionName: 'safeTransferFrom',
      args: [address, to, info.tokenId],
    })
  }
  return (
    <div className="space-y-4">
      <Field label="Recipient address" hint="Double-check the address. Transfers are final.">
        <Input placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value.trim())} spellCheck={false} />
      </Field>
      {to && !valid && <p className="text-sm text-[var(--danger)]">Enter a valid address that is not your own.</p>}
      <Button className="w-full" onClick={transfer} disabled={!valid || tx.busy} loading={tx.busy}>
        Transfer ownership
      </Button>
      <p className="text-xs text-[var(--subtle)]">The domain NFT moves to the recipient. They should run "Sync registry owner" afterwards so ArcNS record controls follow them. Any active listing stops being valid.</p>
      <TxBanner state={tx.state} />
    </div>
  )
}

/** Shown when the NFT owner and the ArcNS registry owner differ (always true right after a sale or transfer). */
export function ReclaimNotice({ info }: { info: DomainInfo }) {
  const { address } = useAccount()
  const tx = useTx()
  if (!address || !info.owner || info.owner.toLowerCase() !== address.toLowerCase()) return null
  if (info.registryOwner?.toLowerCase() === address.toLowerCase()) return null
  return (
    <div className="space-y-3 rounded-2xl border border-[rgba(245,199,107,0.35)] bg-[rgba(245,199,107,0.07)] p-4">
      <p className="text-sm text-[var(--warn)]">
        You own this domain NFT, but the ArcNS registry still lists a different controller. Sync it to edit the wallet address record.
      </p>
      <Button
        variant="secondary"
        onClick={() => tx.run('Sync registry owner', { to: info.collection, abi: registrarAbi, functionName: 'reclaim', args: [info.tokenId, address] })}
        disabled={tx.busy}
        loading={tx.busy}
      >
        Sync registry owner
      </Button>
      <TxBanner state={tx.state} />
    </div>
  )
}

const PROFILE_FIELDS = [
  { key: 'display', label: 'Display name', placeholder: 'Your name or brand' },
  { key: 'description', label: 'Bio', placeholder: 'A short description' },
  { key: 'url', label: 'Website', placeholder: 'https://' },
  { key: 'avatar', label: 'Avatar URL', placeholder: 'https://' },
  { key: 'twitter', label: 'X / Twitter', placeholder: 'handle' },
  { key: 'github', label: 'GitHub', placeholder: 'username' },
  { key: 'telegram', label: 'Telegram', placeholder: 'username' },
  { key: 'discord', label: 'Discord', placeholder: 'username' },
] as const

/** Reads verified public records. Records written by a previous owner are not returned by the contract. */
export function useProfileRecords(info: DomainInfo) {
  const { chainId, deployment } = useNetwork()
  const client = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['records', chainId, info.collection, info.tokenId.toString(), deployment.domix, info.owner],
    enabled: Boolean(client && deployment.domix && info.owner),
    queryFn: async () => {
      if (!client || !deployment.domix) return {}
      const entries = await Promise.all(
        PROFILE_FIELDS.map(async (f) => [
          f.key,
          await client.readContract({ address: deployment.domix!, abi: domixAbi, functionName: 'getRecord', args: [info.collection, info.tokenId, f.key] }).catch(() => ''),
        ] as const),
      )
      return Object.fromEntries(entries)
    },
  })
}

export function IdentityPanel({ info }: { info: DomainInfo }) {
  const { address } = useAccount()
  const { chainId, deployment } = useNetwork()
  const protocol = getProtocol(chainId)
  const tx = useTx()
  const records = useProfileRecords(info)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [walletEdit, setWalletEdit] = useState<string | undefined>(undefined)
  const values: Record<string, string> = { ...(records.data ?? {}), ...edits }
  const wallet = walletEdit ?? info.resolvedAddr ?? address ?? ''

  const isOwner = Boolean(address && info.owner?.toLowerCase() === address.toLowerCase())
  const registryOk = isOwner && info.registryOwner?.toLowerCase() === address?.toLowerCase()
  const changed = PROFILE_FIELDS.filter((f) => (values[f.key] ?? '') !== (records.data?.[f.key] ?? ''))

  const saveProfile = async () => {
    if (!deployment.domix || changed.length === 0) return
    await tx.run('Save public profile', {
      to: deployment.domix,
      abi: domixAbi,
      functionName: 'setRecords',
      args: [info.collection, info.tokenId, changed.map((f) => f.key), changed.map((f) => (values[f.key] ?? '').trim())],
    })
  }

  const saveWallet = async () => {
    if (!protocol || !isAddress(wallet)) return
    await tx.run('Set wallet address', { to: protocol.resolver, abi: resolverAbi, functionName: 'setAddr', args: [info.node, wallet] })
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-[var(--surface)] p-4">
        <p className="label-caps">Wallet address ({info.full})</p>
        <p className="mono mt-1 break-all text-sm">{info.resolvedAddr ?? 'Not set'}</p>
      </div>
      {isOwner && (
        <>
          <Field label="Point this name to a wallet" hint={registryOk ? 'Written to the ArcNS resolver. Anyone resolving this name will see this address.' : 'Sync the registry owner first (see the notice above).'}>
            <Input value={wallet} onChange={(e) => setWalletEdit(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
          </Field>
          <Button variant="secondary" className="w-full" onClick={saveWallet} disabled={!registryOk || !isAddress(wallet) || tx.busy} loading={tx.busy}>
            Save wallet address
          </Button>
        </>
      )}
      {deployment.domix ? (
        <div className="space-y-3">
          <p className="label-caps">Public profile</p>
          {PROFILE_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <Input
                value={values[f.key] ?? ''}
                disabled={!isOwner}
                placeholder={isOwner ? f.placeholder : 'Not set'}
                maxLength={512}
                onChange={(e) => setEdits((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </Field>
          ))}
          {isOwner && (
            <Button className="w-full" onClick={saveProfile} disabled={changed.length === 0 || tx.busy} loading={tx.busy}>
              Save profile onchain
            </Button>
          )}
          <p className="text-xs text-[var(--subtle)]">Only the verified owner can write these records. If the domain is sold or transferred, the previous owner's records stop showing.</p>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">Public profile records need the DOMIX contracts on this network.</p>
      )}
      <TxBanner state={tx.state} />
    </div>
  )
}

/**
 * Points a name at a wallet address in the ArcNS resolver. Handles the prerequisite steps for the owner:
 * syncing the registry owner after a sale or transfer, and setting the resolver if the name has none.
 */
export function SetWalletPanel({ info }: { info: DomainInfo }) {
  const { address } = useAccount()
  const { chainId } = useNetwork()
  const protocol = getProtocol(chainId)
  const tx = useTx()
  const [input, setInput] = useState<string | undefined>(undefined)
  const target = input ?? info.resolvedAddr ?? address ?? ''
  const valid = isAddress(target)
  const isOwner = Boolean(address && info.owner?.toLowerCase() === address.toLowerCase())
  const needsSync = isOwner && info.registryOwner?.toLowerCase() !== address?.toLowerCase()
  const needsResolver = !info.resolver
  const alreadySet = Boolean(valid && info.resolvedAddr && info.resolvedAddr.toLowerCase() === target.toLowerCase())
  const [done, setDone] = useState<string | null>(null)

  if (!protocol) return null
  if (!isOwner) return <p className="text-sm text-[var(--muted)]">Only the verified owner of {info.full} can set its wallet address.</p>

  const run = async () => {
    if (!address || !valid) return
    if (needsSync) {
      const ok = await tx.run('Sync registry owner', { to: info.collection, abi: registrarAbi, functionName: 'reclaim', args: [info.tokenId, address] })
      if (!ok) return
    }
    let resolver = info.resolver
    if (needsResolver) {
      const ok = await tx.run('Set resolver', { to: protocol.registry, abi: registryAbi, functionName: 'setResolver', args: [info.node, protocol.resolver] })
      if (!ok) return
      resolver = protocol.resolver
    }
    if (!resolver) return
    const hash = await tx.run(`Link ${info.full} to wallet`, { to: resolver, abi: resolverAbi, functionName: 'setAddr', args: [info.node, target] })
    if (hash) setDone(target)
  }

  const steps = [
    { label: 'Sync registry owner', needed: needsSync, hint: 'Your wallet becomes the registry controller of this name.' },
    { label: 'Set resolver', needed: needsResolver, hint: 'This name has no resolver yet.' },
    { label: 'Save wallet address', needed: true, hint: 'Written to the ArcNS resolver.' },
  ].filter((x) => x.needed)

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[var(--surface)] p-4">
        <p className="label-caps">{info.full} currently resolves to</p>
        <p className="mono mt-1 break-all text-sm">{info.resolvedAddr ?? 'No wallet address set'}</p>
      </div>
      <Field label="Wallet address" hint="Anyone who sends funds to this name or looks it up will see this address.">
        <Input value={target} onChange={(e) => setInput(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
      </Field>
      <div className="flex flex-wrap gap-2">
        {address && (
          <Button variant="secondary" onClick={() => setInput(address)} disabled={target.toLowerCase() === address.toLowerCase()}>
            Use my connected wallet ({shortAddress(address)})
          </Button>
        )}
      </div>
      {target && !valid && <p className="text-sm text-[var(--danger)]">Enter a valid wallet address.</p>}
      {steps.length > 1 && (
        <ul className="space-y-1.5 text-xs text-[var(--muted)]">
          {steps.map((st) => (
            <li key={st.label} className="flex items-start gap-2">
              <Circle size={12} className="mt-0.5 shrink-0" /> <span><span className="text-[var(--ink)]">{st.label}.</span> {st.hint}</span>
            </li>
          ))}
          <li className="text-[var(--subtle)]">Each step is a separate wallet confirmation.</li>
        </ul>
      )}
      <Button className="w-full" onClick={run} disabled={!valid || alreadySet || tx.busy} loading={tx.busy}>
        {alreadySet ? 'Already set to this address' : steps.length > 1 ? `Set wallet address (${steps.length} steps)` : 'Set wallet address'}
      </Button>
      {done && info.resolvedAddr?.toLowerCase() === done.toLowerCase() && (
        <p className="flex items-center gap-2 text-sm text-[var(--success)]">
          <CheckCircle2 size={16} /> {info.full} now resolves to <span className="mono">{shortAddress(done)}</span>
        </p>
      )}
      <TxBanner state={tx.state} />
    </div>
  )
}

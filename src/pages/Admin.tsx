import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ConnectKitButton } from 'connectkit'
import { ExternalLink } from 'lucide-react'
import { isAddress, type Abi, type Address } from 'viem'
import { usePublicClient, useSignMessage } from 'wagmi'
import { Badge, Button, Card, EmptyState, Field, Input, Stat, TxBanner } from '@/components/ui'
import { domixAbi } from '@/contracts/abis'
import { useOwnerInfo, useStableAddress } from '@/hooks/useOwner'
import { useTx } from '@/hooks/useTx'
import { useVolume } from '@/hooks/useVolume'
import { apiGet, apiPost } from '@/lib/api'
import { fmtUsdc } from '@/lib/format'
import { useNetwork } from '@/lib/network'
import { ARCNS, shortAddress } from '@/lib/protocol'
import { buildAddressExplorerUrl } from '@/onchain-facts'

interface Health {
  head: number
  synced: boolean
  blocksBehind: number | null
  sources: { kind: string; address: string; blocksRemaining: number; lastError: string | null }[]
}

function AdminSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading admin">
      <div className="space-y-2">
        <div className="h-10 w-40 animate-pulse rounded-xl bg-[var(--surface)]" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded-lg bg-[var(--surface)]" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-[var(--surface)]" />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-2xl bg-[var(--surface)]" />
    </div>
  )
}

export function AdminPage() {
  const { address, settling } = useStableAddress()
  const ownerInfo = useOwnerInfo()
  const { chainId, deployment, deployed, chainName } = useNetwork()
  const client = usePublicClient({ chainId })
  const tx = useTx()
  const { signMessageAsync } = useSignMessage()
  const [fee, setFee] = useState('')
  const [treasuryInput, setTreasuryInput] = useState('')
  const [overview, setOverview] = useState<{ counts: Record<string, number> } | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)

  const me = address?.toLowerCase()
  const isOwner = Boolean(me && ownerInfo.data && me === ownerInfo.data.owner.toLowerCase())
  const isPending = Boolean(me && ownerInfo.data && me === ownerInfo.data.pendingOwner.toLowerCase())
  const allowed = isOwner || isPending

  const chain = useQuery({
    queryKey: ['admin-chain', chainId, deployment.domix],
    enabled: Boolean(client && deployed && allowed),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      if (!client || !deployment.domix) throw new Error('not deployed')
      const m = deployment.domix
      const read = <T,>(p: Promise<T>) => p
      const [feeBps, maxFee, treasury, paused, sales, volume, fees, buffer] = await Promise.all([
        read(client.readContract({ address: m, abi: domixAbi, functionName: 'feeBps' })),
        read(client.readContract({ address: m, abi: domixAbi, functionName: 'MAX_FEE_BPS' })),
        read(client.readContract({ address: m, abi: domixAbi, functionName: 'treasury' })),
        read(client.readContract({ address: m, abi: domixAbi, functionName: 'paused' })),
        read(client.readContract({ address: m, abi: domixAbi, functionName: 'salesCount' })),
        read(client.readContract({ address: m, abi: domixAbi, functionName: 'totalVolume' })),
        read(client.readContract({ address: m, abi: domixAbi, functionName: 'totalFees' })),
        read(client.readContract({ address: m, abi: domixAbi, functionName: 'minExpiryBuffer' })),
      ])
      const registrars = await Promise.all(
        (ARCNS[chainId]?.tlds ?? []).map(async (t) => {
          const [allowed, hasExpiry] = await client.readContract({ address: m, abi: domixAbi, functionName: 'collectionInfo', args: [t.registrar] })
          return { tld: t.tld, registrar: t.registrar, allowed, hasExpiry }
        }),
      )
      return { feeBps, maxFee, treasury, registrars, paused, sales, volume, fees, buffer }
    },
  })
  const stats = useQuery({
    queryKey: ['admin-stats', chainId],
    enabled: allowed,
    retry: false,
    refetchInterval: 20_000,
    queryFn: () => apiGet<{ active_listings: number; active_auctions: number; active_offers: number }>('/stats', { chainId }),
  })
  const vol = useVolume()
  const health = useQuery({ queryKey: ['health', chainId], enabled: allowed, retry: false, refetchInterval: 10_000, queryFn: () => apiGet<Health>('/health', { chainId }) })

  if (!deployed) return <EmptyState title="Nothing to administer" body="The DOMIX contract is not deployed on this network." />
  if (settling || (!ownerInfo.data && ownerInfo.isPending)) return <AdminSkeleton />
  if (!ownerInfo.data) {
    return (
      <EmptyState
        title="Could not read the contract owner"
        body="The network is busy right now. Your contract is fine; try again in a moment."
        action={<Button onClick={() => void ownerInfo.refetch()} loading={ownerInfo.isFetching}>Try again</Button>}
      />
    )
  }
  if (!allowed) {
    const owner = ownerInfo.data.owner
    return (
      <EmptyState
        title={address ? 'This is not the owner wallet' : 'Connect the owner wallet'}
        body={
          address
            ? `You are connected as ${address}. Switch to the owner wallet ${owner} on ${chainName} to manage DOMIX.`
            : `Connect the owner wallet ${owner} on ${chainName} to manage DOMIX. Permissions are enforced by the contract as well.`
        }
        action={
          <ConnectKitButton.Custom>
            {({ show }) => <Button onClick={show}>{address ? 'Switch wallet' : 'Connect wallet'}</Button>}
          </ConnectKitButton.Custom>
        }
      />
    )
  }
  const c = chain.data
  if (!c) return chain.isError ? <EmptyState title="Could not read contract state" body="Check your connection and refresh." /> : <AdminSkeleton />

  const m = deployment.domix!
  const setFeeTx = () => {
    const bps = Math.round(Number(fee) * 100)
    if (!Number.isFinite(bps) || bps < 0 || bps > Number(c.maxFee)) return
    return tx.run('Update marketplace fee', { to: m, abi: domixAbi, functionName: 'setFee', args: [bps] })
  }
  const feeBpsInput = Math.round(Number(fee) * 100)
  const feeInvalid = fee === '' || !Number.isFinite(feeBpsInput) || feeBpsInput < 0 || feeBpsInput > Number(c.maxFee)

  const toggle = (label: string, to: Address, abi: Abi, paused: boolean) =>
    tx.run(`${paused ? 'Unpause' : 'Pause'} ${label}`, { to, abi, functionName: paused ? 'unpause' : 'pause' })

  const loadOverview = async () => {
    if (!address) return
    setOverviewError(null)
    try {
      const { nonce } = await apiGet<{ nonce: string }>('/auth/nonce', { address })
      const message = `DOMIX admin overview\nAddress: ${address}\nChain: ${chainId}\nNonce: ${nonce}`
      const signature = await signMessageAsync({ message })
      setOverview(await apiPost('/admin/overview', { address, message, signature, chainId }))
    } catch (error) {
      const msg = (error as { shortMessage?: string; message?: string }).shortMessage ?? (error as Error).message
      if (!/rejected|denied/i.test(msg)) setOverviewError(msg)
    }
  }

  const contracts: { label: string; address?: Address; paused?: boolean; abi?: Abi }[] = [
    { label: 'DOMIX', address: deployment.domix, paused: c.paused, abi: domixAbi },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-4xl font-bold">Admin</h1>
        <p className="mt-2 text-[var(--muted)]">Every setting here is enforced by the contracts. This page only sends the transactions.</p>
      </div>

      {isPending && !isOwner && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">You have a pending ownership transfer. Accept it to take control of the contract.</p>
          <div className="flex gap-2">
            {contracts.map((x) => (
              <Button key={x.label} variant="secondary" onClick={() => x.address && x.abi && tx.run(`Accept ${x.label} ownership`, { to: x.address, abi: x.abi, functionName: 'acceptOwnership' })} disabled={tx.busy}>
                {x.label}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Completed sales" value={(vol.data?.sales ?? c.sales).toString()} sub="Fixed-price, offers and auctions" />
        <Stat label="Marketplace volume" value={`${fmtUsdc(vol.data?.volume ?? c.volume)} USDC`} sub={vol.data?.volume24h !== null && vol.data ? `${fmtUsdc(vol.data.volume24h ?? 0n)} USDC in the last 24h` : 'Contract counter'} />
        <Stat label="Fees collected" value={`${fmtUsdc(vol.data?.fees ?? c.fees)} USDC`} sub={`To ${shortAddress(c.treasury)}`} />
        <Stat label="Active auctions" value={stats.data?.active_auctions ?? '…'} sub={`${stats.data?.active_listings ?? '…'} listings · ${stats.data?.active_offers ?? '…'} offers (indexed)`} />
      </div>

      {vol.data && (
        <Card className="space-y-3">
          <p className="label-caps">Volume reconciliation</p>
          <ul className="grid gap-2 text-sm sm:grid-cols-3">
            {vol.data.breakdown ? (
              (['direct', 'offers', 'auctions'] as const).map((k) => (
                <li key={k} className="rounded-xl bg-[var(--surface)] p-3">
                  <p className="text-[var(--muted)]">{k === 'direct' ? 'Fixed-price sales' : k === 'offers' ? 'Accepted offers' : 'Settled auctions'}</p>
                  <p className="num font-semibold">{fmtUsdc(vol.data.breakdown![k].volume)} USDC</p>
                  <p className="text-xs text-[var(--subtle)]">{vol.data.breakdown![k].sales} sales</p>
                </li>
              ))
            ) : (
              <li className="text-[var(--muted)]">Sale events are unavailable while the indexer is catching up.</li>
            )}
          </ul>
          <p className="text-xs text-[var(--subtle)]">
            Contract counter: {fmtUsdc(vol.data.counter)} USDC.{' '}
            {vol.data.matches ? 'It matches the total of settled sale events.' : vol.data.source === 'events' ? 'It is lower than the sale events: a sale settled without being recorded by the counter. The event total is shown.' : 'It is higher than the indexed events: the indexer is still catching up. The counter is shown.'}
          </p>
        </Card>
      )}

      <Card className="space-y-4">
        <p className="label-caps">Contract status</p>
        <ul className="divide-y divide-[var(--border)]">
          {contracts.map((x) => (
            <li key={x.label} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">{x.label}</p>
                {x.address && (
                  <a href={buildAddressExplorerUrl(chainId, x.address)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 text-xs text-[var(--accent-hover)] hover:underline">
                    {x.address} <ExternalLink size={11} />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={x.paused ? 'bad' : 'good'}>{x.paused ? 'Paused' : 'Live'}</Badge>
                {isOwner && x.address && x.abi && (
                  <Button variant={x.paused ? 'secondary' : 'danger'} onClick={() => toggle(x.label, x.address!, x.abi!, Boolean(x.paused))} disabled={tx.busy}>
                    {x.paused ? 'Unpause' : 'Pause'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-[var(--subtle)]">Pausing stops new listings, purchases, offers and auctions. Cancellations, refunds and settlement of existing auctions always stay available so funds are never trapped.</p>
      </Card>

      {isOwner && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="space-y-3">
            <p className="label-caps">Marketplace fee</p>
            <p className="text-sm text-[var(--muted)]">
              Currently {(c.feeBps / 100).toFixed(2)}%. The contract limit is {(Number(c.maxFee) / 100).toFixed(2)}%.
            </p>
            <Field label="New fee (%)">
              <Input inputMode="decimal" placeholder="2.5" value={fee} onChange={(e) => setFee(e.target.value)} />
            </Field>
            <Button className="w-full" onClick={setFeeTx} disabled={feeInvalid || tx.busy}>
              Update fee
            </Button>
          </Card>
          <Card className="space-y-3">
            <p className="label-caps">Fee treasury</p>
            <p className="mono break-all text-sm text-[var(--muted)]">{c.treasury}</p>
            <Field label="New treasury address">
              <Input placeholder="0x…" value={treasuryInput} onChange={(e) => setTreasuryInput(e.target.value.trim())} spellCheck={false} />
            </Field>
            <Button
              className="w-full"
              onClick={() => tx.run('Update treasury', { to: m, abi: domixAbi, functionName: 'setTreasury', args: [treasuryInput] })}
              disabled={!isAddress(treasuryInput) || tx.busy}
            >
              Update treasury
            </Button>
          </Card>
        </div>
      )}
      {isOwner && (
        <Card className="space-y-3">
          <p className="label-caps">Allowed registrars</p>
          <p className="text-sm text-[var(--muted)]">Only names from allowed ArcNS registrars can be listed, offered on or auctioned. Allow each registrar once after deployment.</p>
          <ul className="divide-y divide-[var(--border)]">
            {c.registrars.map((r) => (
              <li key={r.registrar} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">.{r.tld}</p>
                  <p className="mono text-xs text-[var(--subtle)]">{r.registrar}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={r.allowed ? 'good' : 'warn'}>{r.allowed ? 'Allowed' : 'Not allowed'}</Badge>
                  <Button
                    variant={r.allowed ? 'danger' : 'secondary'}
                    onClick={() => tx.run(`${r.allowed ? 'Disallow' : 'Allow'} .${r.tld}`, { to: m, abi: domixAbi, functionName: 'setCollection', args: [r.registrar, !r.allowed, true] })}
                    disabled={tx.busy}
                  >
                    {r.allowed ? 'Disallow' : 'Allow'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <TxBanner state={tx.state} />

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="label-caps">Indexer</p>
          <Badge tone={health.data?.synced ? 'good' : 'warn'}>{health.isError ? 'Backend unreachable' : health.data?.synced ? 'In sync' : `Catching up (${health.data?.blocksBehind ?? '…'} blocks behind)`}</Badge>
        </div>
        <ul className="space-y-1 text-xs text-[var(--subtle)]">
          {health.data?.sources.map((s) => (
            <li key={s.address} className="mono">
              {s.kind} {shortAddress(s.address)}: {s.blocksRemaining === 0 ? 'synced' : `${s.blocksRemaining} blocks remaining`}
              {s.lastError ? ` (last error: ${s.lastError})` : ''}
            </li>
          ))}
        </ul>
        <Button variant="secondary" onClick={loadOverview}>
          Load backend overview (signed request)
        </Button>
        {overview && <p className="text-sm text-[var(--muted)]">{Object.entries(overview.counts).map(([k, v]) => `${k.replace('_', ' ')}: ${v}`).join(' · ')}</p>}
        {overviewError && <p className="text-sm text-[var(--danger)]">{overviewError}</p>}
        <p className="text-xs text-[var(--subtle)]">The backend checks your signature against the DOMIX owner onchain. It keeps no separate admin list.</p>
      </Card>
    </div>
  )
}

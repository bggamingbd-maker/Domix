import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toHex, type Hex } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import type { DomainInfo } from '@/hooks/useDomain'
import { useTx } from '@/hooks/useTx'
import { useUsdcBalance } from '@/hooks/useUsdc'
import { useNetwork } from '@/lib/network'
import { controllerAbi, getProtocol, YEAR } from '@/lib/protocol'
import { fmtUsdc } from '@/lib/format'
import { Button, Card, Field, TxBanner } from '../ui'

function YearsSelect({ years, onChange }: { years: number; onChange: (n: number) => void }) {
  return (
    <Field label="Registration length">
      <select
        value={years}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[rgba(4,12,28,0.6)] px-3 text-sm"
      >
        {[1, 2, 3, 5, 10].map((y) => (
          <option key={y} value={y}>
            {y} {y === 1 ? 'year' : 'years'}
          </option>
        ))}
      </select>
    </Field>
  )
}

function useRentPrice(info: DomainInfo, years: number) {
  const { chainId } = useNetwork()
  const client = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['rent', chainId, info.label, info.tld, years],
    enabled: Boolean(client),
    queryFn: async () => {
      if (!client) throw new Error('no client')
      const p = await client.readContract({ address: info.controller, abi: controllerAbi, functionName: 'rentPrice', args: [info.label, BigInt(years) * YEAR] })
      return { base: BigInt(p.base), premium: BigInt(p.premium), total: BigInt(p.base) + BigInt(p.premium) }
    },
  })
}

interface StoredCommit {
  secret: Hex
  commitment: Hex
  years: number
}

/** Two-step commit/reveal registration against the ArcNS controller. USDC is pulled by the controller on register. */
export function RegisterPanel({ info }: { info: DomainInfo }) {
  const { address } = useAccount()
  const { chainId, usdc } = useNetwork()
  const client = usePublicClient({ chainId })
  const protocol = getProtocol(chainId)
  const balance = useUsdcBalance()
  const tx = useTx()
  const [years, setYears] = useState(1)
  const price = useRentPrice(info, years)
  const storageKey = `domix.commit.${chainId}.${address}.${info.full}`
  const [stored, setStored] = useState<StoredCommit | null>(() => JSON.parse(localStorage.getItem(storageKey) ?? 'null') as StoredCommit | null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const status = useQuery({
    queryKey: ['commit-status', chainId, stored?.commitment],
    enabled: Boolean(stored && client),
    refetchInterval: 4000,
    queryFn: async () => {
      if (!client || !stored) throw new Error('no commit')
      const [timestamp, exists, matured, expired] = await client.readContract({
        address: info.controller,
        abi: controllerAbi,
        functionName: 'getCommitmentStatus',
        args: [stored.commitment],
      })
      return { timestamp, exists, matured, expired }
    },
  })

  if (!protocol) return null
  const duration = BigInt(years) * YEAR
  const total = price.data?.total ?? 0n
  const insufficient = balance.data !== undefined && price.data !== undefined && balance.data < total

  const commit = async () => {
    if (!address || !client) return
    const secret = toHex(crypto.getRandomValues(new Uint8Array(32)))
    const commitment = await client.readContract({
      address: info.controller,
      abi: controllerAbi,
      functionName: 'makeCommitment',
      args: [info.label, address, duration, secret, protocol.resolver, false, address],
    })
    const hash = await tx.run('Commit registration', { to: info.controller, abi: controllerAbi, functionName: 'commit', args: [commitment] })
    if (hash) {
      const record: StoredCommit = { secret, commitment, years }
      localStorage.setItem(storageKey, JSON.stringify(record))
      setStored(record)
    }
  }

  const register = async () => {
    if (!address || !stored || !price.data) return
    const dur = BigInt(stored.years) * YEAR
    const ok = await tx.ensureUsdcAllowance(usdc, info.controller, price.data.total)
    if (!ok) return
    const hash = await tx.run(`Register ${info.full}`, {
      to: info.controller,
      abi: controllerAbi,
      functionName: 'register',
      args: [info.label, address, dur, stored.secret, protocol.resolver, false, price.data.total],
    })
    if (hash) {
      localStorage.removeItem(storageKey)
      setStored(null)
    }
  }

  const secondsLeft = status.data?.exists ? Math.max(0, Number(status.data.timestamp) + 60 - Math.floor(now / 1000)) : 60
  const ready = Boolean(stored && status.data?.matured && !status.data.expired)

  return (
    <Card className="space-y-4">
      <div>
        <p className="label-caps">Register</p>
        <p className="display text-xl font-semibold">{info.full} is available</p>
      </div>
      <YearsSelect years={stored ? stored.years : years} onChange={setYears} />
      <div className="flex items-end justify-between rounded-xl bg-[var(--surface)] p-4">
        <span className="text-sm text-[var(--muted)]">Registration price</span>
        <span className="display num text-2xl font-semibold">{price.data ? `${fmtUsdc(price.data.total)} USDC` : '…'}</span>
      </div>
      {price.data && price.data.premium > 0n && <p className="text-xs text-[var(--warn)]">Includes a {fmtUsdc(price.data.premium)} USDC premium for a recently expired name.</p>}
      {insufficient && <p className="text-sm text-[var(--danger)]">Your USDC balance is below the registration price.</p>}
      {!stored ? (
        <>
          <Button className="w-full" onClick={commit} disabled={!address || tx.busy || insufficient} loading={tx.busy}>
            {address ? 'Step 1: Commit' : 'Connect a wallet to register'}
          </Button>
          <p className="text-xs text-[var(--subtle)]">Registration uses commit and reveal to stop front-running. No USDC leaves your wallet until step 2.</p>
        </>
      ) : (
        <>
          <Button className="w-full" onClick={register} disabled={!ready || tx.busy || insufficient} loading={tx.busy}>
            {ready ? 'Step 2: Approve USDC and register' : `Waiting ${secondsLeft}s for the commitment to mature`}
          </Button>
          {status.data?.expired && <p className="text-sm text-[var(--danger)]">Commitment expired. Commit again.</p>}
        </>
      )}
      <TxBanner state={tx.state} />
    </Card>
  )
}

export function RenewPanel({ info }: { info: DomainInfo }) {
  const { usdc } = useNetwork()
  const [years, setYears] = useState(1)
  const price = useRentPrice(info, years)
  const balance = useUsdcBalance()
  const tx = useTx()

  const renew = async () => {
    if (!price.data) return
    const ok = await tx.ensureUsdcAllowance(usdc, info.controller, price.data.total)
    if (!ok) return
    await tx.run(`Renew ${info.full}`, {
      to: info.controller,
      abi: controllerAbi,
      functionName: 'renew',
      args: [info.label, BigInt(years) * YEAR, price.data.total],
    })
  }
  const insufficient = balance.data !== undefined && price.data !== undefined && balance.data < price.data.total

  return (
    <div className="space-y-3">
      <YearsSelect years={years} onChange={setYears} />
      <div className="flex justify-between rounded-xl bg-[var(--surface)] p-3 text-sm">
        <span className="text-[var(--muted)]">Renewal price</span>
        <span className="num font-semibold">{price.data ? `${fmtUsdc(price.data.total)} USDC` : '…'}</span>
      </div>
      {insufficient && <p className="text-sm text-[var(--danger)]">Your USDC balance is below the renewal price.</p>}
      <Button className="w-full" onClick={renew} disabled={tx.busy || insufficient || !price.data} loading={tx.busy}>
        Approve USDC and renew
      </Button>
      <TxBanner state={tx.state} />
    </div>
  )
}

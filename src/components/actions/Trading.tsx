import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { useAccount, usePublicClient } from 'wagmi'
import { domixAbi } from '@/contracts/abis'
import type { DomainInfo } from '@/hooks/useDomain'
import { useNow } from '@/hooks/useNow'
import { useTx } from '@/hooks/useTx'
import { useUsdcBalance } from '@/hooks/useUsdc'
import { useNetwork } from '@/lib/network'
import { fmtDate, fmtUsdc } from '@/lib/format'
import { shortAddress } from '@/lib/protocol'
import { Link } from '@/lib/router'
import { parseUsdc } from '@/onchain-money'
import { Button, Card, Field, Input, TxBanner } from '../ui'

const DAY = 86_400

function parsePrice(text: string): bigint | undefined {
  try {
    const v = parseUsdc(text.trim())
    return v > 0n ? v : undefined
  } catch {
    return undefined
  }
}

function DurationSelect({ days, onChange, options }: { days: number; onChange: (n: number) => void; options: number[] }) {
  return (
    <Field label="Duration">
      <select
        value={days}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[rgba(4,12,28,0.6)] px-3 text-sm"
      >
        {options.map((d) => (
          <option key={d} value={d}>
            {d} {d === 1 ? 'day' : 'days'}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function BuyPanel({ info }: { info: DomainInfo }) {
  const { address } = useAccount()
  const { chainId, deployment, usdc } = useNetwork()
  const client = usePublicClient({ chainId })
  const balance = useUsdcBalance()
  const tx = useTx()
  const listing = info.listing
  const quote = useQuery({
    queryKey: ['quote', chainId, listing?.price.toString()],
    enabled: Boolean(client && listing && deployment.domix),
    queryFn: async () => {
      if (!client || !listing || !deployment.domix) throw new Error('not ready')
      const [fee, proceeds] = await client.readContract({ address: deployment.domix, abi: domixAbi, functionName: 'quoteFee', args: [listing.price] })
      return { fee, proceeds }
    },
  })
  if (!listing || !deployment.domix) return null
  const mine = address?.toLowerCase() === listing.seller.toLowerCase()
  const short = balance.data !== undefined && balance.data < listing.price

  const buy = async () => {
    if (!deployment.domix) return
    const ok = await tx.ensureUsdcAllowance(usdc, deployment.domix, listing.price)
    if (!ok) return
    await tx.run(`Buy ${info.full}`, {
      to: deployment.domix,
      abi: domixAbi,
      functionName: 'buy',
      args: [info.collection, info.tokenId, listing.price],
    })
  }

  return (
    <Card className="space-y-4">
      <div>
        <p className="label-caps">Buy now</p>
        <p className="display num text-4xl font-semibold">
          {fmtUsdc(listing.price)} <span className="text-lg text-[var(--muted)]">USDC</span>
        </p>
      </div>
      <dl className="space-y-2 rounded-xl bg-[var(--surface)] p-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-[var(--muted)]">Seller</dt>
          <dd className="mono">{shortAddress(listing.seller)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--muted)]">Marketplace fee (paid by seller)</dt>
          <dd className="num">{quote.data ? `${fmtUsdc(quote.data.fee)} USDC` : '…'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--muted)]">Seller receives</dt>
          <dd className="num">{quote.data ? `${fmtUsdc(quote.data.proceeds)} USDC` : '…'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--muted)]">Listing ends</dt>
          <dd>{fmtDate(listing.expiresAt)}</dd>
        </div>
      </dl>
      {short && <p className="text-sm text-[var(--danger)]">Your USDC balance is {fmtUsdc(balance.data ?? 0n)}. You need {fmtUsdc(listing.price)}.</p>}
      <Button className="w-full" onClick={buy} disabled={!address || mine || short || tx.busy} loading={tx.busy}>
        {!address ? 'Connect a wallet to buy' : mine ? 'This is your listing' : 'Approve USDC and buy'}
      </Button>
      <p className="text-xs text-[var(--subtle)]">
        Payment and ownership transfer happen in one transaction. If either step fails, nothing moves. After buying, use "Sync registry owner" in My Domains so ArcNS record controls follow the new owner.
      </p>
      <TxBanner state={tx.state} />
    </Card>
  )
}

const LIST_DAYS = [1, 7, 30, 90, 365]

export function ListPanel({ info, onDone }: { info: DomainInfo; onDone?: () => void }) {
  const { address } = useAccount()
  const { chainId, deployment } = useNetwork()
  const client = usePublicClient({ chainId })
  const now = useNow()
  const tx = useTx()
  const existing = info.listing?.valid ? info.listing : undefined
  const [price, setPrice] = useState(existing ? fmtUsdc(existing.price, 6).replace(/\.?0+$/, '') : '')
  const [days, setDays] = useState(30)
  const [result, setResult] = useState<'listed' | 'updated' | 'cancelled' | null>(null)
  const parsed = parsePrice(price)

  const rules = useQuery({
    queryKey: ['list-rules', chainId, deployment.domix, info.collection, parsed?.toString() ?? ''],
    enabled: Boolean(client && deployment.domix),
    queryFn: async () => {
      if (!client || !deployment.domix) throw new Error('not ready')
      const m = deployment.domix
      const [collection, buffer, minPrice, fee] = await Promise.all([
        client.readContract({ address: m, abi: domixAbi, functionName: 'collectionInfo', args: [info.collection] }),
        client.readContract({ address: m, abi: domixAbi, functionName: 'minExpiryBuffer' }),
        client.readContract({ address: m, abi: domixAbi, functionName: 'MIN_PRICE' }),
        parsed && parsed >= 10_000n ? client.readContract({ address: m, abi: domixAbi, functionName: 'quoteFee', args: [parsed] }) : Promise.resolve(null),
      ])
      return { allowed: collection[0], hasExpiry: collection[1], buffer: BigInt(buffer), minPrice, fee }
    },
  })

  if (!deployment.domix) return null
  const domix = deployment.domix
  const isOwner = Boolean(address && info.owner?.toLowerCase() === address.toLowerCase())
  const nowSec = BigInt(Math.floor(now / 1000))
  const expires = info.expires ?? 0n
  const allowedDays = LIST_DAYS.filter((d) => !rules.data?.hasExpiry || expires > nowSec + BigInt(d * DAY) + (rules.data?.buffer ?? 0n))
  const effectiveDays = allowedDays.includes(days) ? days : (allowedDays[allowedDays.length - 1] ?? days)
  const tooCheap = parsed !== undefined && rules.data !== undefined && parsed < rules.data.minPrice

  const blocker = !address
    ? 'Connect your wallet to list this domain.'
    : !isOwner
      ? `Only the owner of ${info.full} can list it.`
      : rules.data && !rules.data.allowed
        ? 'This registrar is not enabled on the DOMIX marketplace.'
        : rules.data?.hasExpiry && allowedDays.length === 0
          ? `${info.full} expires too soon to list. Renew it first, then list it.`
          : null

  const submit = async () => {
    if (!parsed || blocker || tooCheap) return
    if (existing) {
      const hash = await tx.run('Update listing', { to: domix, abi: domixAbi, functionName: 'updateListing', args: [info.collection, info.tokenId, parsed, BigInt(effectiveDays * DAY)] })
      if (hash) setResult('updated')
      return
    }
    const ok = await tx.ensureDomainApproval(info.collection, info.tokenId, domix)
    if (!ok) return
    const hash = await tx.run(`List ${info.full}`, { to: domix, abi: domixAbi, functionName: 'list', args: [info.collection, info.tokenId, parsed, BigInt(effectiveDays * DAY)] })
    if (hash) setResult('listed')
  }
  const cancel = async () => {
    const hash = await tx.run('Cancel listing', { to: domix, abi: domixAbi, functionName: 'cancelListing', args: [info.collection, info.tokenId] })
    if (hash) setResult('cancelled')
  }

  if (result) {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto text-[var(--success)]" size={40} />
        <div>
          <p className="display text-xl font-bold">
            {result === 'cancelled' ? 'Listing cancelled' : result === 'updated' ? 'Listing updated' : `${info.full} is listed`}
          </p>
          {result !== 'cancelled' && parsed !== undefined && <p className="num mt-1 text-[var(--muted)]">{fmtUsdc(parsed)} USDC · live on the marketplace</p>}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link to={`/domain/${info.full}`} onClick={onDone} className="btn-grad inline-flex min-h-11 flex-1 items-center justify-center rounded-xl text-sm font-semibold">
            View domain page
          </Link>
          {onDone && (
            <Button variant="secondary" className="flex-1" onClick={onDone}>
              Done
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Field label="Price (USDC)" hint={`Minimum ${fmtUsdc(rules.data?.minPrice ?? 10_000n)} USDC. The seller pays the marketplace fee out of this price.`}>
        <Input inputMode="decimal" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
      {tooCheap && <p className="text-sm text-[var(--danger)]">The minimum listing price is {fmtUsdc(rules.data?.minPrice ?? 0n)} USDC.</p>}
      <DurationSelect days={effectiveDays} onChange={setDays} options={allowedDays.length ? allowedDays : LIST_DAYS} />
      {rules.data?.fee && parsed !== undefined && !tooCheap && (
        <dl className="space-y-1.5 rounded-xl bg-[var(--surface)] p-3 text-sm">
          <div className="flex justify-between"><dt className="text-[var(--muted)]">Listing price</dt><dd className="num">{fmtUsdc(parsed)} USDC</dd></div>
          <div className="flex justify-between"><dt className="text-[var(--muted)]">Marketplace fee</dt><dd className="num">{fmtUsdc(rules.data.fee[0])} USDC</dd></div>
          <div className="flex justify-between border-t border-[var(--border)] pt-1.5 font-semibold"><dt>You receive</dt><dd className="num">{fmtUsdc(rules.data.fee[1])} USDC</dd></div>
        </dl>
      )}
      {blocker && <p className="text-sm text-[var(--warn)]">{blocker}</p>}
      <Button className="w-full" onClick={submit} disabled={!parsed || tooCheap || Boolean(blocker) || tx.busy} loading={tx.busy}>
        {existing ? 'Update listing' : 'Approve and list for sale'}
      </Button>
      {existing && (
        <Button variant="danger" className="w-full" onClick={cancel} disabled={!isOwner || tx.busy}>
          Cancel listing
        </Button>
      )}
      <p className="text-xs text-[var(--subtle)]">
        Two confirmations the first time: approve the marketplace for this one domain, then list it. Your domain stays in your wallet while listed and only moves when a buyer pays your price.
      </p>
      <TxBanner state={tx.state} />
    </div>
  )
}

export function OfferPanel({ info }: { info: DomainInfo }) {
  const { address } = useAccount()
  const { deployment, usdc } = useNetwork()
  const balance = useUsdcBalance()
  const tx = useTx()
  const [price, setPrice] = useState('')
  const [days, setDays] = useState(7)
  const parsed = parsePrice(price)
  if (!deployment.domix) return null
  const domix = deployment.domix
  const short = parsed !== undefined && balance.data !== undefined && balance.data < parsed

  const submit = async () => {
    if (!parsed) return
    const ok = await tx.ensureUsdcAllowance(usdc, domix, parsed)
    if (!ok) return
    await tx.run(`Offer ${price} USDC`, { to: domix, abi: domixAbi, functionName: 'makeOffer', args: [info.collection, info.tokenId, parsed, BigInt(days * DAY)] })
  }

  return (
    <Card className="space-y-4">
      <div>
        <p className="label-caps">Make an offer</p>
        <p className="text-sm text-[var(--muted)]">Your USDC stays in your wallet until the owner accepts. You approve only the offer amount.</p>
      </div>
      <Field label="Offer (USDC)">
        <Input inputMode="decimal" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
      <DurationSelect days={days} onChange={setDays} options={[1, 3, 7, 14, 30]} />
      {short && <p className="text-sm text-[var(--danger)]">Your balance is {fmtUsdc(balance.data ?? 0n)} USDC.</p>}
      <Button variant="secondary" className="w-full" onClick={submit} disabled={!address || !parsed || short || tx.busy} loading={tx.busy}>
        {address ? 'Approve USDC and send offer' : 'Connect a wallet to offer'}
      </Button>
      <TxBanner state={tx.state} />
    </Card>
  )
}

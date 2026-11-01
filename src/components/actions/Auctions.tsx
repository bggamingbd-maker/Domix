import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { erc20Abi } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import { domixAbi } from '@/contracts/abis'
import type { DomainInfo } from '@/hooks/useDomain'
import { useAuctions } from '@/hooks/useMarket'
import { useTx } from '@/hooks/useTx'
import { useUsdcBalance } from '@/hooks/useUsdc'
import { apiGet, type OfferRow } from '@/lib/api'
import { countdown, fmtDate, fmtUsdc } from '@/lib/format'
import { useNetwork } from '@/lib/network'
import { shortAddress } from '@/lib/protocol'
import { parseUsdc } from '@/onchain-money'
import { Badge, Button, Card, EmptyState, Field, Input, Spinner, TxBanner } from '../ui'

const HOUR = 3600

function parsePrice(text: string): bigint | undefined {
  try {
    const v = parseUsdc(text.trim())
    return v > 0n ? v : undefined
  } catch {
    return undefined
  }
}

function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** Active offers for one domain, re-read from the DOMIX contract with the offerer's current funding. */
export function OffersList({ info }: { info: DomainInfo }) {
  const { address } = useAccount()
  const { chainId, deployment, usdc } = useNetwork()
  const client = usePublicClient({ chainId })
  const tx = useTx()
  const offers = useQuery({
    queryKey: ['offers', chainId, info.collection, info.tokenId.toString(), deployment.domix],
    enabled: Boolean(client && deployment.domix),
    refetchInterval: 20_000,
    queryFn: async () => {
      if (!client || !deployment.domix) return []
      const { offers: rows } = await apiGet<{ offers: OfferRow[] }>('/offers', { chainId, collection: info.collection, tokenId: info.tokenId.toString() })
      const now = BigInt(Math.floor(Date.now() / 1000))
      const live = await Promise.all(
        rows.map(async (r) => {
          const id = BigInt(r.id)
          const o = await client.readContract({ address: deployment.domix!, abi: domixAbi, functionName: 'getOffer', args: [id] })
          if (o.status !== 0 || BigInt(o.expiresAt) <= now) return null
          const [balance, allowance] = await Promise.all([
            client.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [o.offerer] }),
            client.readContract({ address: usdc, abi: erc20Abi, functionName: 'allowance', args: [o.offerer, deployment.domix!] }),
          ])
          const price = BigInt(o.price)
          return { id, offerer: o.offerer, price, expiresAt: BigInt(o.expiresAt), funded: balance >= price && allowance >= price }
        }),
      )
      return live.filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => (a.price < b.price ? 1 : -1))
    },
  })
  if (!deployment.domix) return null
  const domixAddr = deployment.domix
  const isOwner = address && info.owner?.toLowerCase() === address.toLowerCase()

  const accept = async (id: bigint) => {
    const ok = await tx.ensureDomainApproval(info.collection, info.tokenId, domixAddr)
    if (!ok) return
    await tx.run('Accept offer', { to: domixAddr, abi: domixAbi, functionName: 'acceptOffer', args: [id] })
  }

  return (
    <Card className="space-y-3">
      <p className="label-caps">Offers</p>
      {offers.isLoading ? (
        <Spinner />
      ) : !offers.data?.length ? (
        <p className="text-sm text-[var(--muted)]">No active offers.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {offers.data.map((o) => (
            <li key={o.id.toString()} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="display num text-lg font-semibold">{fmtUsdc(o.price)} USDC</p>
                <p className="mono text-xs text-[var(--subtle)]">
                  from {shortAddress(o.offerer)} · expires {fmtDate(o.expiresAt)}
                </p>
                {!o.funded && <Badge tone="warn">Offerer balance or allowance is currently too low</Badge>}
              </div>
              <div className="flex gap-2">
                {isOwner && (
                  <>
                    <Button onClick={() => accept(o.id)} disabled={tx.busy || !o.funded}>
                      Accept
                    </Button>
                    <Button variant="secondary" onClick={() => tx.run('Reject offer', { to: domixAddr, abi: domixAbi, functionName: 'rejectOffer', args: [o.id] })} disabled={tx.busy}>
                      Reject
                    </Button>
                  </>
                )}
                {address?.toLowerCase() === o.offerer.toLowerCase() && (
                  <Button variant="danger" onClick={() => tx.run('Cancel offer', { to: domixAddr, abi: domixAbi, functionName: 'cancelOffer', args: [o.id] })} disabled={tx.busy}>
                    Cancel
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <TxBanner state={tx.state} />
    </Card>
  )
}

export function AuctionPanel({ info, inline = false }: { info: DomainInfo; inline?: boolean }) {
  const { address } = useAccount()
  const { deployment, usdc } = useNetwork()
  const auctions = useAuctions({ status: 'active' })
  const balance = useUsdcBalance()
  const tx = useTx()
  const now = useNow()
  const [bid, setBid] = useState('')
  const auction = auctions.data?.find((a) => a.collection.toLowerCase() === info.collection.toLowerCase() && a.tokenId === info.tokenId && a.status === 0)
  if (!deployment.domix) return null
  const domixAddr = deployment.domix
  const me = address?.toLowerCase()

  if (!auction) {
    return !inline && info.owner && me === info.owner.toLowerCase() ? <CreateAuction info={info} /> : null
  }

  const end = Number(auction.endTime)
  const ended = end <= Math.floor(now / 1000)
  const hasBid = auction.highestBidder !== '0x0000000000000000000000000000000000000000'
  const parsed = parsePrice(bid)
  const tooLow = parsed !== undefined && parsed < auction.minNextBid
  const short = parsed !== undefined && balance.data !== undefined && balance.data < parsed
  const isSeller = me === auction.seller.toLowerCase()

  const placeBid = async () => {
    if (!parsed) return
    const ok = await tx.ensureUsdcAllowance(usdc, domixAddr, parsed)
    if (!ok) return
    await tx.run('Place bid', { to: domixAddr, abi: domixAbi, functionName: 'bid', args: [auction.id, parsed] })
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="label-caps">Auction #{auction.id.toString()}</p>
          <p className="display num text-3xl font-semibold">
            {fmtUsdc(hasBid ? auction.highestBid : auction.startPrice)} <span className="text-base text-[var(--muted)]">USDC</span>
          </p>
          <p className="text-xs text-[var(--subtle)]">{hasBid ? `Highest bidder ${shortAddress(auction.highestBidder)}` : 'Starting price, no bids yet'}</p>
        </div>
        <Badge tone={ended ? 'warn' : 'accent'}>{countdown(end, now)}</Badge>
      </div>
      {!ended && (
        <>
          <Field label={`Your bid (minimum ${fmtUsdc(auction.minNextBid)} USDC)`}>
            <Input inputMode="decimal" placeholder={fmtUsdc(auction.minNextBid)} value={bid} onChange={(e) => setBid(e.target.value)} />
          </Field>
          {tooLow && <p className="text-sm text-[var(--danger)]">Bid must be at least {fmtUsdc(auction.minNextBid)} USDC.</p>}
          {short && <p className="text-sm text-[var(--danger)]">Your USDC balance is too low.</p>}
          <Button className="w-full" onClick={placeBid} disabled={!address || isSeller || !parsed || tooLow || short || tx.busy} loading={tx.busy}>
            {isSeller ? 'You cannot bid on your own auction' : 'Approve USDC and place bid'}
          </Button>
          <p className="text-xs text-[var(--subtle)]">Your bid is held by the auction contract. If someone outbids you it is refunded automatically, or you can claim it from My Domains. Late bids extend the end time by up to 10 minutes.</p>
        </>
      )}
      {ended && (
        <Button className="w-full" onClick={() => tx.run('Settle auction', { to: domixAddr, abi: domixAbi, functionName: 'settle', args: [auction.id] })} disabled={!address || tx.busy} loading={tx.busy}>
          Settle auction
        </Button>
      )}
      {isSeller && !hasBid && !ended && (
        <Button variant="danger" className="w-full" onClick={() => tx.run('Cancel auction', { to: domixAddr, abi: domixAbi, functionName: 'cancelAuction', args: [auction.id, auction.seller] })} disabled={tx.busy}>
          Cancel auction (no bids yet)
        </Button>
      )}
      <TxBanner state={tx.state} />
    </Card>
  )
}

function CreateAuction({ info }: { info: DomainInfo }) {
  const { deployment } = useNetwork()
  const tx = useTx()
  const [start, setStart] = useState('')
  const [inc, setInc] = useState('1')
  const [hours, setHours] = useState(24)
  const parsedStart = parsePrice(start)
  const parsedInc = parsePrice(inc)
  if (!deployment.domix) return null
  const domixAddr = deployment.domix

  const create = async () => {
    if (!parsedStart || !parsedInc) return
    const ok = await tx.ensureDomainApproval(info.collection, info.tokenId, domixAddr)
    if (!ok) return
    await tx.run(`Start auction for ${info.full}`, {
      to: domixAddr,
      abi: domixAbi,
      functionName: 'createAuction',
      args: [info.collection, info.tokenId, parsedStart, parsedInc, BigInt(hours * HOUR)],
    })
  }

  return (
    <div className="space-y-4">
      <Field label="Starting price (USDC)">
        <Input inputMode="decimal" placeholder="0.00" value={start} onChange={(e) => setStart(e.target.value)} />
      </Field>
      <Field label="Minimum bid increment (USDC)">
        <Input inputMode="decimal" value={inc} onChange={(e) => setInc(e.target.value)} />
      </Field>
      <Field label="Duration">
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[rgba(4,12,28,0.6)] px-3 text-sm">
          {[1, 6, 24, 72, 168, 336].map((h) => (
            <option key={h} value={h}>
              {h < 24 ? `${h} hours` : `${h / 24} days`}
            </option>
          ))}
        </select>
      </Field>
      <Button className="w-full" onClick={create} disabled={!parsedStart || !parsedInc || tx.busy} loading={tx.busy}>
        Approve and start auction
      </Button>
      <p className="text-xs text-[var(--subtle)]">
        Starting an auction moves your domain into the auction contract's escrow until it settles. You can cancel only while there are no bids. If the highest bidder cannot receive the domain, the bid is refunded and you can claim the domain back.
      </p>
      <TxBanner state={tx.state} />
    </div>
  )
}

export function AuctionEmpty() {
  return <EmptyState title="No active auctions" body="Auctions appear here as soon as an owner starts one." />
}

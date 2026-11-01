import { useQuery } from '@tanstack/react-query'
import { ArrowLeftRight, Gavel, Handshake, ExternalLink, Pause, Play, Plus, Settings2, ShoppingCart, Tag, UserRound, X, RefreshCcw, type LucideIcon } from 'lucide-react'
import { apiGet, type ActivityRow } from '@/lib/api'
import { fmtDateTime, fmtUsdc } from '@/lib/format'
import { useNetwork } from '@/lib/network'
import { shortAddress } from '@/lib/protocol'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { motion } from 'framer-motion'
import { useLite } from '@/hooks/useLite'
import { LiveDot, Skeleton } from './fx/Ambient'
import { Badge, EmptyState } from './ui'

const ZERO = '0x0000000000000000000000000000000000000000'

interface Described {
  icon: LucideIcon
  text: string
  usdc?: string
}

function describe(e: ActivityRow): Described | null {
  const a = e.args
  const name = e.label ? e.label : a.tokenId ? `token ${String(a.tokenId).slice(0, 6)}…` : 'a domain'
  const price = a.price ? fmtUsdc(a.price) : undefined
  switch (e.name) {
    case 'Listed':
      return { icon: Tag, text: `${name} listed for sale`, usdc: price }
    case 'ListingUpdated':
      return { icon: Tag, text: `Listing for ${name} updated`, usdc: price }
    case 'ListingCancelled':
      return { icon: X, text: `Listing for ${name} cancelled` }
    case 'Sold':
      return { icon: ShoppingCart, text: `${name} sold to ${shortAddress(a.buyer)}`, usdc: price }
    case 'OfferMade':
      return { icon: Handshake, text: `Offer on ${name} by ${shortAddress(a.offerer)}`, usdc: price }
    case 'OfferAccepted':
      return { icon: Handshake, text: `Offer #${a.id} accepted`, usdc: price }
    case 'OfferRejected':
      return { icon: X, text: `Offer #${a.id} rejected` }
    case 'OfferCancelled':
      return { icon: X, text: `Offer #${a.id} cancelled` }
    case 'AuctionCreated':
      return { icon: Gavel, text: `Auction #${a.id} started for ${name}`, usdc: a.startPrice ? fmtUsdc(a.startPrice) : undefined }
    case 'BidPlaced':
      return { icon: Gavel, text: `Bid on auction #${a.id} by ${shortAddress(a.bidder)}`, usdc: a.amount ? fmtUsdc(a.amount) : undefined }
    case 'AuctionSettled':
      return { icon: Gavel, text: `Auction #${a.id} won by ${shortAddress(a.winner)}`, usdc: price }
    case 'AuctionCancelled':
      return { icon: X, text: `Auction #${a.id} cancelled` }
    case 'AuctionFailed':
      return { icon: X, text: `Auction #${a.id} could not deliver; bidder refunded`, usdc: a.bid ? fmtUsdc(a.bid) : undefined }
    case 'RefundWithdrawn':
      return { icon: RefreshCcw, text: `Refund claimed by ${shortAddress(a.recipient)}`, usdc: a.amount ? fmtUsdc(a.amount) : undefined }
    case 'NameRegistered':
      return { icon: Plus, text: `${a.name} registered by ${shortAddress(a.owner)}`, usdc: a.cost ? fmtUsdc(a.cost) : undefined }
    case 'NameRenewed':
      return { icon: RefreshCcw, text: `${a.name} renewed`, usdc: a.cost ? fmtUsdc(a.cost) : undefined }
    case 'RecordSet':
      return { icon: UserRound, text: `Profile record "${String(a.key)}" updated on ${name}` }
    case 'CollectionSet':
      return { icon: Settings2, text: `Registrar ${shortAddress(String(a.collection))} ${a.allowed ? 'allowed' : 'removed'} by the owner` }
    case 'FeeSet':
      return { icon: Settings2, text: `Marketplace fee set to ${(Number(a.feeBps) / 100).toFixed(2)}%` }
    case 'TreasurySet':
      return { icon: Settings2, text: `Fee treasury set to ${shortAddress(String(a.treasury))}` }
    case 'Paused':
      return { icon: Pause, text: 'Marketplace paused by the owner' }
    case 'Unpaused':
      return { icon: Play, text: 'Marketplace resumed by the owner' }
    case 'OwnershipTransferred':
      return { icon: Settings2, text: `Ownership set to ${shortAddress(String(a.newOwner))}` }
    case 'Transfer':
      if (a.from === ZERO) return null // mint is reported by NameRegistered
      return { icon: ArrowLeftRight, text: `${name} transferred ${shortAddress(a.from)} to ${shortAddress(a.to)}` }
    default:
      return null
  }
}

interface Props {
  address?: string
  tokenId?: bigint
  collection?: string
  limit?: number
  empty?: string
}

export function ActivityFeed({ address, tokenId, collection, limit = 30, empty = 'No activity yet.' }: Props) {
  const { chainId } = useNetwork()
  const feed = useQuery({
    queryKey: ['activity', chainId, address, tokenId?.toString(), collection, limit],
    refetchInterval: 6000,
    queryFn: () => apiGet<{ events: ActivityRow[] }>('/activity', { chainId, address, tokenId: tokenId?.toString(), collection, limit }),
  })
  const reduce = useLite()
  if (feed.isLoading)
    return (
      <div className="space-y-2" role="status" aria-label="Loading activity">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    )
  if (feed.isError) return <EmptyState title="Activity is unavailable" body="The indexer could not be reached. Onchain data is unaffected." />
  const rows = (feed.data?.events ?? []).map((e) => ({ e, d: describe(e) })).filter((r): r is { e: ActivityRow; d: Described } => r.d !== null)
  if (rows.length === 0) return <EmptyState title={empty} body="Registrations, listings, offers and sales show up here within seconds of confirming onchain." />
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-xs text-[var(--subtle)]">
        <LiveDot /> Live from onchain events, updated every few seconds
      </p>
    <ul className="glass divide-y divide-[var(--border)] overflow-hidden rounded-2xl">
      {rows.map(({ e, d }, i) => (
        <motion.li
          key={`${e.tx_hash}-${e.log_index}`}
          initial={reduce ? false : { opacity: 0, x: -14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: Math.min(i, 8) * 0.02, duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-strong)] text-[var(--accent-hover)]">
              <d.icon size={16} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm">{d.text}</p>
              <p className="text-xs text-[var(--subtle)]">{fmtDateTime(e.block_time)} · block {e.block_number}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {d.usdc && <span className="num text-sm font-semibold">{d.usdc} USDC</span>}
            <Badge tone="good">
              <span className="mr-1.5 inline-block size-1.5 rounded-full bg-[var(--success)]" /> Confirmed
            </Badge>
            <a
              href={buildTxExplorerUrl(chainId, e.tx_hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="mono inline-flex min-h-8 items-center gap-1 text-xs text-[var(--accent-hover)] hover:underline"
              aria-label="View transaction on explorer"
            >
              {e.tx_hash.slice(0, 8)}… <ExternalLink size={12} />
            </a>
          </div>
        </motion.li>
      ))}
    </ul>
    </div>
  )
}

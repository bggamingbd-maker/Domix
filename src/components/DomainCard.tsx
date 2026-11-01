import { ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { fmtDate, fmtUsdc } from '@/lib/format'
import { shortAddress } from '@/lib/protocol'
import { DomainTile } from './DomainTile'
import { Badge } from './ui'

interface Props {
  label: string | null
  tld: string | null
  tokenId: bigint
  price?: bigint
  priceLabel?: string
  seller?: string
  expires?: bigint | null
  badge?: ReactNode
  footer?: ReactNode
  /** Position in a grid; staggers the entrance. */
  index?: number
  /** Animated gradient border for premium placement. */
  featured?: boolean
}

/** Domain tile for listings, owned names and search results. Every figure passed in comes from the chain. */
export function DomainCard({ label, tld, tokenId, price, priceLabel = 'Price', seller, expires, badge, footer, index = 0, featured = false }: Props) {
  const name = label && tld ? `${label}.${tld}` : null
  const meta = [seller ? `Seller ${shortAddress(seller)}` : null, expires ? `Expires ${fmtDate(expires)}` : null].filter(Boolean).join(' · ')
  return (
    <DomainTile
      name={name ?? `Token ${tokenId.toString().slice(0, 8)}…`}
      to={name ? `/domain/${name}` : undefined}
      index={index}
      featured={featured}
      meta={meta || undefined}
      valueLabel={price !== undefined ? priceLabel : undefined}
      value={price !== undefined ? <><span className="glow-num">{fmtUsdc(price)}</span> <span className="text-xs font-medium text-[var(--muted)]">USDC</span></> : undefined}
      badge={
        badge ??
        (price !== undefined ? (
          <Badge tone="good">
            <ShieldCheck size={12} className="mr-1" /> Verified
          </Badge>
        ) : undefined)
      }
      footer={footer}
    />
  )
}

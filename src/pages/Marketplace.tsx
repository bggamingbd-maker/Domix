import { useEffect, useState } from 'react'
import { Badge, Card, EmptyState, Input } from '@/components/ui'
import { DomainCard } from '@/components/DomainCard'
import { AnimatedText } from '@/components/fx/Motion'
import { SkeletonCards } from '@/components/fx/Ambient'
import { useAuctions, useListings, type ListingFilters } from '@/hooks/useMarket'
import { countdown } from '@/lib/format'
import { useNetwork } from '@/lib/network'
import { getProtocol, tldByRegistrar } from '@/lib/protocol'
import { parseUsdc } from '@/onchain-money'
import clsx from 'clsx'

function usdcToRaw(text: string): string | undefined {
  try {
    return text.trim() ? parseUsdc(text.trim()).toString() : undefined
  } catch {
    return undefined
  }
}

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function Auctions() {
  const auctions = useAuctions({ status: 'active' })
  const { chainId } = useNetwork()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (auctions.isLoading) return <SkeletonCards count={3} />
  const live = (auctions.data ?? []).filter((a) => a.status === 0)
  if (!live.length) return <EmptyState title="No live auctions" body="When an owner starts an auction it shows up here with its countdown." />
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {live.map((a, i) => (
        <DomainCard
          index={i}
          key={a.id.toString()}
          label={a.label}
          tld={tldByRegistrar(chainId, a.collection)?.tld ?? null}
          tokenId={a.tokenId}
          price={a.highestBid > 0n ? a.highestBid : a.startPrice}
          priceLabel={a.highestBid > 0n ? 'Current bid' : 'Starting price'}
          seller={a.seller}
          badge={<Badge tone="accent">{countdown(Number(a.endTime), now)}</Badge>}
        />
      ))}
    </div>
  )
}

export function MarketplacePage() {
  const { deployed, chainName } = useNetwork()
  const protocol = getProtocol(useNetwork().chainId)
  const [tab, setTab] = useState<'buy' | 'auctions'>('buy')
  const [q, setQ] = useState('')
  const [collection, setCollection] = useState('')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [sort, setSort] = useState('recent')
  const filters: ListingFilters = useDebounced({
    q: q.trim() || undefined,
    collection: collection || undefined,
    min: usdcToRaw(min),
    max: usdcToRaw(max),
    sort,
    limit: 60,
  })
  const listings = useListings(filters)

  return (
    <div className="space-y-6">
      <div>
        <AnimatedText as="h1" text="Marketplace" gradient className="display text-4xl font-extrabold" />
        <p className="mt-2 text-[var(--muted)]">Every listing shown here is re-checked against the marketplace contract on {chainName} before it appears.</p>
      </div>

      {!deployed ? (
        <EmptyState title="Marketplace not deployed on this network" body="No DOMIX contracts are configured for this network, so there are no listings to show." />
      ) : (
        <>
          <div className="flex gap-2" role="tablist">
            {(['buy', 'auctions'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={clsx('min-h-11 rounded-xl px-5 text-sm font-medium', tab === t ? 'bg-[var(--surface-strong)] text-[var(--ink)]' : 'text-[var(--muted)] hover:text-[var(--ink)]')}
              >
                {t === 'buy' ? 'Buy now' : 'Auctions'}
              </button>
            ))}
          </div>

          {tab === 'auctions' ? (
            <Auctions />
          ) : (
            <>
              <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Input placeholder="Search names" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search names" />
                <select value={collection} onChange={(e) => setCollection(e.target.value)} aria-label="Extension" className="min-h-11 rounded-xl border border-[var(--border)] bg-[rgba(4,12,28,0.6)] px-3 text-sm">
                  <option value="">All extensions</option>
                  {protocol?.tlds.map((t) => (
                    <option key={t.tld} value={t.registrar}>
                      .{t.tld}
                    </option>
                  ))}
                </select>
                <Input placeholder="Min USDC" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} aria-label="Minimum price" />
                <Input placeholder="Max USDC" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} aria-label="Maximum price" />
                <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" className="min-h-11 rounded-xl border border-[var(--border)] bg-[rgba(4,12,28,0.6)] px-3 text-sm">
                  <option value="recent">Recently listed</option>
                  <option value="price_asc">Price: low to high</option>
                  <option value="price_desc">Price: high to low</option>
                  <option value="ending">Ending soonest</option>
                </select>
              </Card>
              {listings.isLoading ? (
                <SkeletonCards count={6} />
              ) : listings.isError ? (
                <EmptyState title="Listings are unavailable" body="The indexer could not be reached. Open a domain page to buy it directly from the contract." />
              ) : listings.data?.listings.length ? (
                <>
                  <p className="text-sm text-[var(--subtle)]">
                    {listings.data.listings.length} verified {listings.data.listings.length === 1 ? 'listing' : 'listings'}
                    {listings.data.checked > listings.data.listings.length ? ` (${listings.data.checked - listings.data.listings.length} hidden: no longer valid onchain)` : ''}
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {listings.data.listings.map((l, i) => (
                      <DomainCard index={i} key={`${l.collection}-${l.tokenId}`} label={l.label} tld={l.tld} tokenId={l.tokenId} price={l.price} seller={l.seller} expires={l.nameExpires} />
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState title="No listings match" body="Nothing is listed with these filters. Be the first: open a domain you own and choose List for sale." />
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

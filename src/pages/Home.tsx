import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Search, ShieldCheck, Tag, Wallet } from 'lucide-react'
import { useAccount } from 'wagmi'
import { ActivityFeed } from '@/components/ActivityFeed'
import { AllDomains } from '@/components/AllDomains'
import { DomainCard } from '@/components/DomainCard'
import { DomainTile } from '@/components/DomainTile'
import { ListDomainModal } from '@/components/ListDomainModal'
import { GetStarted } from '@/components/GetStarted'
import { SuggestionCard } from '@/components/SuggestionCard'
import { LiveRegistryFeed } from '@/components/LiveRegistryFeed'
import { Skeleton, SkeletonCards } from '@/components/fx/Ambient'
import { LazyMount } from '@/components/fx/LazyMount'
import { AnimatedText, CountUp, Magnetic, Reveal, SectionTitle, Typewriter } from '@/components/fx/Motion'
import { Badge, Card, EmptyState, Stat } from '@/components/ui'
import { useListings } from '@/hooks/useMarket'
import { useVolume, type TradingVolume } from '@/hooks/useVolume'
import { FEATURED_NAMES } from '@/lib/featured'
import { apiGet, backendAvailable } from '@/lib/api'
import { fmtUsdc } from '@/lib/format'
import { useNetwork } from '@/lib/network'
import { shortAddress, tldByRegistrar } from '@/lib/protocol'
import { Link } from '@/lib/router'
import { SearchBar } from './Explore'
import { useOwned } from '@/hooks/useOwned'
import { useOwnedCount } from '@/hooks/useOwnedCount'

interface TrendingRow {
  collection: string
  token_id: string
  actions: number
  label: string | null
}

function volumeNote(v: TradingVolume | undefined, deployed: boolean): string {
  if (!deployed) return 'DOMIX not deployed here'
  if (!v) return 'Reading settled sales'
  const sales = `${v.sales} settled ${v.sales === 1 ? 'sale' : 'sales'}`
  if (v.matches) return `${sales} · matches contract counter`
  if (v.source === 'contract') return `${sales} · contract counter${v.behind ? ' (indexer catching up)' : ''}`
  return `${sales} · from sale events (counter ${fmtUsdc(v.counter)})`
}

const usdcFormat = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} USDC`

function StatValue({ loading, value, format, finalText }: { loading: boolean; value?: number; format?: (n: number) => string; finalText?: string }) {
  if (loading) return <Skeleton className="h-8 w-24 !rounded-lg" />
  if (value === undefined) return <span className="text-[var(--subtle)]">—</span>
  return <CountUp to={value} format={format} finalText={finalText} />
}

function MarketStats() {
  const { address } = useAccount()
  const { chainId, deployed } = useNetwork()
  const volume = useVolume()
  const indexed = useQuery({
    queryKey: ['home-index-stats', chainId],
    refetchInterval: 8000,
    queryFn: () => apiGet<{ indexed_domains?: number; active_auctions: number }>('/stats', { chainId }),
  })
  const listed = useListings({ limit: 200 })
  const clientOnly = !backendAvailable
  const mine = useOwned(clientOnly ? undefined : address)
  const mineCount = useOwnedCount(clientOnly ? address : undefined)
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {clientOnly ? (
        <Stat
          label="Open auctions"
          value={<StatValue loading={deployed && indexed.isLoading} value={deployed ? indexed.data?.active_auctions : undefined} />}
          sub={deployed ? 'Live on DOMIX' : 'DOMIX not deployed here'}
        />
      ) : (
        <Stat
          label="Total domains"
          value={<StatValue loading={indexed.isLoading} value={indexed.data?.indexed_domains} />}
          sub="ArcNS names indexed on this network"
        />
      )}
      <Stat
        label="Listed domains"
        value={<StatValue loading={deployed && listed.isLoading} value={deployed ? listed.data?.listings.length : undefined} />}
        sub={deployed ? 'Verified against the contract' : 'DOMIX not deployed here'}
      />
      <Stat
        label="Trading volume"
        value={
          <StatValue
            loading={deployed && volume.isLoading}
            value={deployed && volume.data ? Number(volume.data.volume) / 1e6 : undefined}
            format={usdcFormat}
            finalText={volume.data ? `${fmtUsdc(volume.data.volume)} USDC` : undefined}
          />
        }
        sub={volumeNote(volume.data, deployed)}
      />
      <Stat
        label="My domains"
        value={
          <StatValue
            loading={Boolean(address) && (clientOnly ? mineCount.isLoading : mine.isLoading)}
            value={address ? (clientOnly ? mineCount.data : mine.data?.length) : undefined}
          />
        }
        sub={address ? 'Confirmed against the registry' : 'Connect a wallet'}
      />
    </div>
  )
}

function Featured({ onList }: { onList: () => void }) {
  const forSale = useListings({ sort: 'recent', limit: 100 })
  const listings = forSale.data?.listings ?? []
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <AnimatedText as="p" onView text="Featured names · live availability" className="label-caps" stagger={0.018} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {FEATURED_NAMES.map((n, i) => (
            <SuggestionCard key={`${n.label}.${n.tld}`} label={n.label} tld={n.tld} index={i} />
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <p className="label-caps">Listed for sale · {listings.length} on DOMIX</p>
        {forSale.isLoading ? (
          <SkeletonCards count={4} />
        ) : listings.length === 0 ? (
          <GetStarted onList={onList} />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {listings.map((l, i) => (
              <DomainTile
                key={`${l.collection}-${l.tokenId}`}
                name={l.label && l.tld ? `${l.label}.${l.tld}` : `Token ${l.tokenId.toString().slice(0, 8)}…`}
                to={l.label && l.tld ? `/domain/${l.label}.${l.tld}` : undefined}
                index={i}
                meta={`Seller ${shortAddress(l.seller)}`}
                value={`${fmtUsdc(l.price)} USDC`}
                badge={<Badge tone="accent">For sale</Badge>}
              />
            ))}
          </div>
        )}
      </div>
      {backendAvailable && (
        <>
          <LazyMount minHeight={320}>
            <AllDomains />
          </LazyMount>
          <LazyMount minHeight={200}>
            <LiveRegistryFeed />
          </LazyMount>
        </>
      )}
    </div>
  )
}

function Recent() {
  const recent = useListings({ sort: 'recent', limit: 6 })
  if (recent.isLoading) return <SkeletonCards count={3} />
  const rows = recent.data?.listings ?? []
  if (!rows.length) return <EmptyState title="Nothing listed yet" body="New listings appear here the moment an owner lists a name." />
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((l, i) => (
        <DomainCard index={i} key={`${l.collection}-${l.tokenId}`} label={l.label} tld={l.tld} tokenId={l.tokenId} price={l.price} seller={l.seller} expires={l.nameExpires} />
      ))}
    </div>
  )
}

function Trending() {
  const { chainId } = useNetwork()
  const trending = useQuery({ queryKey: ['trending', chainId], refetchInterval: 60_000, queryFn: () => apiGet<{ trending: TrendingRow[] }>('/trending', { chainId }) })
  if (trending.isLoading) return <SkeletonCards count={3} />
  const rows = trending.data?.trending ?? []
  if (!rows.length) return <EmptyState title="No trading activity this week" body="Trending ranks domains by listings, offers, bids and sales in the last 7 days." />
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.slice(0, 6).map((r, i) => (
        <DomainCard
          index={i}
          key={`${r.collection}-${r.token_id}`}
          label={r.label}
          tld={tldByRegistrar(chainId, r.collection)?.tld ?? null}
          tokenId={BigInt(r.token_id)}
          badge={<Badge tone="accent">{r.actions} actions this week</Badge>}
        />
      ))}
    </div>
  )
}

const STEPS = [
  { icon: Search, title: 'Discover', body: 'Search any ArcNS name. Availability and ownership come straight from the registry contracts.' },
  { icon: Wallet, title: 'Own', body: 'Register new names with USDC, or buy listed ones. The domain NFT lands in your wallet, never in ours.' },
  { icon: Tag, title: 'Trade', body: 'List at a fixed price, accept offers, or run an auction. Payment and transfer settle together or not at all.' },
  { icon: ShieldCheck, title: 'Stay in control', body: 'Your domain stays in your wallet while listed. Offers never lock your USDC. Auction escrow is explicit and refundable.' },
]

const HERO_MESSAGES = ['Discover. Own. Trade.', 'Search .arc and .circle names.', 'Pay and settle in USDC.', 'Your domain stays in your wallet.']

export function HomePage() {
  const { chainName } = useNetwork()
  const [listOpen, setListOpen] = useState(false)
  return (
    <div className="space-y-20">
      <section className="pt-4 text-center sm:pt-10">
        <Badge tone="accent">
          <span className="live-dot mr-2 inline-block" aria-hidden="true" /> {chainName} · Powered by USDC
        </Badge>
        <AnimatedText as="p" text="DOMIX" gradient stagger={0.09} className="display mt-6 block text-[clamp(4.25rem,19vw,10.5rem)] font-extrabold leading-[0.95]" />
        <AnimatedText
          as="h1"
          text="Your Digital Identity Starts Here."
          delay={0.7}
          stagger={0.022}
          className="display mx-auto mt-4 block max-w-3xl text-balance text-3xl font-bold leading-tight sm:text-5xl"
        />
        <p className="display mt-5 h-8 text-xl font-semibold text-[var(--cyan)] sm:text-2xl">
          <Typewriter messages={HERO_MESSAGES} />
        </p>
        <div className="mx-auto mt-9 max-w-2xl">
          <SearchBar />
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Magnetic>
            <Link to="/explore" className="btn-grad inline-flex min-h-12 items-center gap-2 rounded-2xl px-7 text-base font-semibold">
              Explore Domains <ArrowRight size={18} />
            </Link>
          </Magnetic>
          <Magnetic>
            <button onClick={() => setListOpen(true)} className="glass inline-flex min-h-12 items-center gap-2 rounded-2xl px-7 text-base font-semibold">
              List Domain <Tag size={16} />
            </button>
          </Magnetic>
        </div>
      </section>

      <Reveal>
        <MarketStats />
      </Reveal>

      <section className="space-y-5">
        <SectionTitle>Featured domains</SectionTitle>
        <Featured onList={() => setListOpen(true)} />
      </section>

      <section className="space-y-5">
        <div className="flex items-end justify-between gap-3">
          <SectionTitle>Marketplace activity</SectionTitle>
          <Link to="/activity" className="text-sm text-[var(--accent-hover)] hover:underline">
            View all
          </Link>
        </div>
        <Reveal>
          <LazyMount minHeight={280}>
            <ActivityFeed limit={8} empty="No marketplace activity yet. Registrations, listings and sales appear here as they happen." />
          </LazyMount>
        </Reveal>
      </section>

      <section className="space-y-5">
        <SectionTitle>Trending this week</SectionTitle>
        <LazyMount minHeight={200}>
          <Trending />
        </LazyMount>
      </section>

      <section className="space-y-5">
        <div className="flex items-end justify-between gap-3">
          <SectionTitle>Recently listed</SectionTitle>
          <Link to="/marketplace" className="text-sm text-[var(--accent-hover)] hover:underline">
            View marketplace
          </Link>
        </div>
        <LazyMount minHeight={200}>
          <Recent />
        </LazyMount>
      </section>

      <ListDomainModal open={listOpen} onClose={() => setListOpen(false)} />

      <section className="space-y-5">
        <SectionTitle>How DOMIX works</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.08}>
              <Card className="h-full">
                <span className="flex size-10 items-center justify-center rounded-xl bg-[rgba(99,102,241,0.2)] text-[var(--cyan)]">
                  <s.icon size={18} />
                </span>
                <p className="label-caps mt-4">Step {i + 1}</p>
                <p className="display mt-1 text-lg font-bold">{s.title}</p>
                <p className="mt-2 text-sm text-[var(--muted)]">{s.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { isAddress, type Address } from 'viem'
import { usePublicClient } from 'wagmi'
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui'
import { domainKey, fetchDomain, isExpired, useDomain } from '@/hooks/useDomain'
import { apiGet, type OwnedRow } from '@/lib/api'
import { fmtDate, fmtUsdc } from '@/lib/format'
import { useNetwork } from '@/lib/network'
import { getProtocol, parseDomainInput, registrarAbi, shortAddress } from '@/lib/protocol'
import { navigate, useSearchParam } from '@/lib/router'
import { DomainCard } from '@/components/DomainCard'
import { DomainTile } from '@/components/DomainTile'
import { AnimatedText } from '@/components/fx/Motion'

export function SearchBar({ initial = '', autoFocus = false }: { initial?: string; autoFocus?: boolean }) {
  const [value, setValue] = useState(initial)
  const { chainId, deployment } = useNetwork()
  const client = usePublicClient({ chainId })
  const queryClient = useQueryClient()
  const domix = deployment.domix

  // Start reading the name while the user is still typing, so the result is usually ready when they press Search.
  useEffect(() => {
    const v = value.trim()
    if (!client || !v || isAddress(v)) return
    const timer = setTimeout(() => {
      const parsed = parseDomainInput(v)
      if (!parsed || typeof parsed === 'string') return
      const tlds = getProtocol(chainId)?.tlds.filter((t) => !/\.(arc|circle)$/.test(v) || t.tld === parsed.tld) ?? []
      for (const t of tlds) {
        void queryClient.prefetchQuery({
          queryKey: domainKey(chainId, parsed.label, t.tld, domix),
          staleTime: 15_000,
          queryFn: () => fetchDomain(client, chainId, domix, parsed.label, t.tld),
        })
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [value, client, chainId, domix, queryClient])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    if (v) navigate(`/explore?q=${encodeURIComponent(v)}`)
  }
  return (
    <form onSubmit={submit} className="glass glow-border flex items-center gap-2 rounded-2xl p-2 shadow-[0_0_60px_-20px_rgba(59,130,255,0.6)] focus-within:shadow-[0_0_80px_-12px_rgba(139,92,246,0.75)]" role="search">
      <Search size={18} className="ml-3 shrink-0 text-[var(--subtle)]" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus={autoFocus}
        placeholder="Search a name (alice.arc) or a wallet address (0x…)"
        aria-label="Search domains or wallet addresses"
        className="min-h-11 w-full bg-transparent px-1 text-base text-[var(--ink)] outline-none"
        spellCheck={false}
      />
      <button type="submit" className="btn-grad min-h-11 shrink-0 rounded-xl px-5 text-sm font-semibold">
        Search
      </button>
    </form>
  )
}

function NameResult({ label, tld }: { label: string; tld: 'arc' | 'circle' }) {
  const q = useDomain(label, tld)
  if (q.isLoading) return <Card className="animate-pulse !p-6">Checking {label}.{tld}…</Card>
  if (q.isError || !q.data)
    return (
      <Card className="flex items-center justify-between gap-3">
        <span>Could not check {label}.{tld}.</span>
        <Button variant="secondary" onClick={() => void q.refetch()}>
          Try again
        </Button>
      </Card>
    )
  const d = q.data
  const listed = d.listing?.valid ? d.listing : undefined
  return (
    <DomainTile
      name={d.full}
      to={`/domain/${d.full}`}
      badge={d.available ? <Badge tone="good">Available</Badge> : listed ? <Badge tone="accent">For sale</Badge> : <Badge>Taken</Badge>}
      meta={
        d.available
          ? 'Available to register now'
          : `Owned by ${d.owner ? shortAddress(d.owner) : 'unknown'}${d.expires && d.expires > 0n ? ` · ${isExpired(d) ? 'expired' : 'expires'} ${fmtDate(d.expires)}` : ''}`
      }
      value={listed ? `${fmtUsdc(listed.price)} USDC` : undefined}
      valueLabel={listed ? 'Listed price' : undefined}
    />
  )
}

function AddressResult({ address }: { address: Address }) {
  const { chainId } = useNetwork()
  const client = usePublicClient({ chainId })
  const owned = useQuery({
    queryKey: ['owned', chainId, address],
    enabled: Boolean(client),
    queryFn: async () => {
      if (!client) return []
      const { domains } = await apiGet<{ domains: OwnedRow[] }>(`/owned/${address}`, { chainId })
      // The index only proposes candidates: confirm each one against the registrar.
      const checked = await Promise.all(
        domains.map(async (d) => {
          const owner = await client.readContract({ address: d.collection as Address, abi: registrarAbi, functionName: 'ownerOf', args: [BigInt(d.token_id)] }).catch(() => undefined)
          return owner && owner.toLowerCase() === address.toLowerCase() ? d : null
        }),
      )
      return checked.filter((d): d is OwnedRow => d !== null)
    },
  })
  const protocol = getProtocol(chainId)
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted)]">
        Domains owned by <span className="mono">{shortAddress(address)}</span>
      </p>
      {owned.isLoading ? (
        <Spinner />
      ) : owned.isError ? (
        <EmptyState title="Wallet search needs the indexer" body="The backend could not be reached, so owned domains cannot be listed. Search a specific name instead." />
      ) : owned.data?.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {owned.data.map((d) => (
            <DomainCard
              key={`${d.collection}-${d.token_id}`}
              label={d.label}
              tld={protocol?.tlds.find((t) => t.registrar.toLowerCase() === d.collection.toLowerCase())?.tld ?? null}
              tokenId={BigInt(d.token_id)}
              expires={d.expires ? BigInt(d.expires) : null}
              badge={<Badge>Owned</Badge>}
            />
          ))}
        </div>
      ) : (
        <EmptyState title="No domains found" body="This wallet does not own any indexed ArcNS domains on this network." />
      )}
    </div>
  )
}

export function ExplorePage() {
  const [q] = useSearchParam('q')
  const { chainName } = useNetwork()
  const protocol = getProtocol(useNetwork().chainId)
  const trimmed = q.trim()
  const parsed = trimmed && !isAddress(trimmed) ? parseDomainInput(trimmed) : null

  return (
    <div className="space-y-6">
      <div>
        <AnimatedText as="h1" text="Explore" gradient className="display text-4xl font-extrabold" />
        <p className="mt-2 text-[var(--muted)]">Availability and ownership are read live from the ArcNS contracts on {chainName}.</p>
      </div>
      <SearchBar initial={q} />
      {protocol && (
        <p className="text-sm text-[var(--subtle)]">
          Supported extensions: {protocol.tlds.map((t) => `.${t.tld}`).join(', ')} via {protocol.name}.
        </p>
      )}
      {!trimmed ? (
        <EmptyState title="Search to get started" body="Try a name like alice.arc, or paste a wallet address to see the domains it owns." />
      ) : isAddress(trimmed) ? (
        <AddressResult address={trimmed} />
      ) : typeof parsed === 'string' ? (
        <Card className="text-sm text-[var(--danger)]">{parsed}</Card>
      ) : parsed ? (
        <div className="space-y-3">
          {(trimmed.endsWith('.arc') || trimmed.endsWith('.circle') ? protocol?.tlds.filter((t) => t.tld === parsed.tld) : protocol?.tlds)?.map((t) => (
            <NameResult key={t.tld} label={parsed.label} tld={t.tld} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

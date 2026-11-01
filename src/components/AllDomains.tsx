import { useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { zeroAddress, type Address } from 'viem'
import { usePublicClient } from 'wagmi'
import { domixAbi } from '@/contracts/abis'
import { apiGet } from '@/lib/api'
import { useNow } from '@/hooks/useNow'
import { fmtUsdc } from '@/lib/format'
import { useNetwork } from '@/lib/network'
import { registrarAbi, shortAddress, tldByRegistrar } from '@/lib/protocol'
import { DomainRow } from './DomainTile'
import { Skeleton } from './fx/Ambient'
import { Badge, Button, EmptyState, Input } from './ui'

interface Row {
  collection: Address
  token_id: string
  label: string
  owner: string
  expires: string | null
}

const PAGE = 24

/**
 * Every registered ArcNS name the indexer knows about, newest activity first.
 * The index only proposes names: owner, expiry and any DOMIX listing are re-read from the contracts for each page.
 */
export function AllDomains() {
  const { chainId, deployment } = useNetwork()
  const client = usePublicClient({ chainId })
  const nowSec = BigInt(Math.floor(useNow(60_000) / 1000))
  const [text, setText] = useState('')
  const [q, setQ] = useState('')

  const pages = useInfiniteQuery({
    queryKey: ['all-domains', chainId, q],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => apiGet<{ total: number; domains: Row[] }>('/domains', { chainId, q, limit: PAGE, offset: pageParam }),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.domains.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    refetchInterval: 60_000,
  })
  const rows = pages.data?.pages.flatMap((p) => p.domains) ?? []
  const total = pages.data?.pages[0]?.total ?? 0

  const live = useQuery({
    queryKey: ['all-domains-live', chainId, deployment.domix, rows.map((r) => r.token_id).join(',')],
    enabled: Boolean(client && rows.length),
    queryFn: async () => {
      if (!client) return {}
      const entries = await Promise.all(
        rows.map(async (r) => {
          const id = BigInt(r.token_id)
          const [owner, expires] = await Promise.all([
            client.readContract({ address: r.collection, abi: registrarAbi, functionName: 'ownerOf', args: [id] }).catch(() => undefined),
            client.readContract({ address: r.collection, abi: registrarAbi, functionName: 'nameExpires', args: [id] }).catch(() => undefined),
          ])
          let price: bigint | undefined
          if (deployment.domix && owner) {
            const m = deployment.domix
            const valid = await client.readContract({ address: m, abi: domixAbi, functionName: 'isListingValid', args: [r.collection, id] }).catch(() => false)
            if (valid) {
              const l = await client.readContract({ address: m, abi: domixAbi, functionName: 'getListing', args: [r.collection, id] })
              if (l.seller !== zeroAddress) price = BigInt(l.price)
            }
          }
          return [r.token_id, { owner, expires, price }] as const
        }),
      )
      return Object.fromEntries(entries)
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-caps">All domains · {total.toLocaleString('en-US')} registered</p>
          <p className="mt-1 text-xs text-[var(--subtle)]">Owner, expiry and listing status are confirmed against the contracts for every tile.</p>
        </div>
        <form
          className="flex w-full gap-2 sm:w-auto"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            setQ(text.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''))
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter by name" aria-label="Filter domains by name" className="sm:w-56" />
          <Button type="submit" variant="secondary" aria-label="Filter">
            <Search size={16} />
          </Button>
        </form>
      </div>

      {pages.isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState title="No domains indexed yet" body={q ? `No indexed name starts with "${q}". Use search to check any name directly.` : 'The registry index is still loading. Use search to check any name directly.'} />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r, i) => {
            const v = live.data?.[r.token_id]
            const tld = tldByRegistrar(chainId, r.collection)?.tld ?? 'arc'
            const name = `${r.label}.${tld}`
            const owner = v?.owner ?? r.owner
            const exp = v?.expires ?? (r.expires ? BigInt(r.expires) : undefined)
            const gone = live.data !== undefined && v !== undefined && !v.owner
            const grace = !gone && exp !== undefined && exp > 0n && exp <= nowSec
            // Same lines and badges as the suggestion tiles above.
            const listed = v?.price !== undefined
            const badge = listed ? <Badge tone="accent">For sale</Badge> : gone ? <Badge tone="good">Available</Badge> : grace ? <Badge tone="warn">Grace period</Badge> : <Badge>Registered</Badge>
            const meta = listed ? 'Listed price' : gone ? 'Register, 1 year' : `Owner ${shortAddress(owner)}`
            return (
              <DomainRow
                key={`${r.collection}-${r.token_id}`}
                name={name}
                to={`/domain/${name}`}
                index={i % PAGE}
                badge={badge}
                meta={meta}
                value={listed ? `${fmtUsdc(v.price ?? 0n)} USDC` : undefined}
              />
            )
          })}
        </ul>
      )}

      {pages.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => pages.fetchNextPage()} loading={pages.isFetchingNextPage}>
            Load more domains
          </Button>
        </div>
      )}
    </div>
  )
}

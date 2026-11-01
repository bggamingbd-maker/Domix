import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { apiGet, type ActivityRow } from '@/lib/api'
import { fmtDate, fmtUsdc, relativeTime } from '@/lib/format'
import { useNetwork } from '@/lib/network'
import { shortAddress } from '@/lib/protocol'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { LiveDot, Skeleton } from './fx/Ambient'

/** Newest ArcNS registrations and renewals, straight from the registry controller's events. */
export function LiveRegistryFeed({ limit = 6 }: { limit?: number }) {
  const { chainId } = useNetwork()
  const feed = useQuery({
    queryKey: ['registry-feed', chainId, limit],
    refetchInterval: 6000,
    queryFn: () => apiGet<{ events: ActivityRow[] }>('/activity', { chainId, names: 'NameRegistered,NameRenewed', limit }),
  })
  if (feed.isLoading) return <Skeleton className="h-40" />
  const rows = feed.data?.events ?? []
  if (feed.isError || rows.length === 0) return null
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-xs text-[var(--subtle)]">
        <LiveDot /> Latest ArcNS registrations and renewals on this network
      </p>
      <ul className="glass divide-y divide-[var(--border)] overflow-hidden rounded-2xl">
        {rows.map((e) => (
          <li key={`${e.tx_hash}-${e.log_index}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="display truncate text-base font-semibold">
                {e.args.name}
                <span className="ml-2 text-xs font-medium text-[var(--accent-hover)]">{e.name === 'NameRegistered' ? 'Registered' : 'Renewed'}</span>
              </p>
              <p className="mono text-xs text-[var(--subtle)]">
                {e.args.owner ? `${shortAddress(e.args.owner)} · ` : ''}expires {fmtDate(e.args.expires)} · {relativeTime(Number(e.block_time))}
              </p>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="num font-semibold">{fmtUsdc(e.args.cost)} USDC</span>
              <a href={buildTxExplorerUrl(chainId, e.tx_hash)} target="_blank" rel="noopener noreferrer" className="mono inline-flex min-h-8 items-center gap-1 text-xs text-[var(--accent-hover)] hover:underline" aria-label="View transaction on explorer">
                {e.tx_hash.slice(0, 8)}… <ExternalLink size={12} />
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

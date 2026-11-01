import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { isExpired, useDomain } from '@/hooks/useDomain'
import { fmtUsdc } from '@/lib/format'
import { useNetwork } from '@/lib/network'
import { controllerAbi, shortAddress, tldInfo, YEAR } from '@/lib/protocol'
import { DomainTile } from './DomainTile'
import { CountUp } from './fx/Motion'
import { LiveDot, Skeleton } from './fx/Ambient'
import { Badge } from './ui'

/** Compact suggestion with live availability, owner and price read from the ArcNS registry. */
export function SuggestionCard({ label, tld, index, featured = false }: { label: string; tld: 'arc' | 'circle'; index: number; featured?: boolean }) {
  const { chainId } = useNetwork()
  const client = usePublicClient({ chainId })
  const q = useDomain(label, tld)
  const d = q.data
  // The price read does not wait for the availability read: both go out in the same request batch.
  const controller = tldInfo(chainId, tld)?.controller
  const rent = useQuery({
    queryKey: ['featured-rent', chainId, label, tld],
    enabled: Boolean(client && controller),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      if (!client || !controller) throw new Error('not ready')
      const p = await client.readContract({ address: controller, abi: controllerAbi, functionName: 'rentPrice', args: [label, YEAR] })
      return BigInt(p.base) + BigInt(p.premium)
    },
  })
  if (q.isLoading || !d) return <Skeleton className="h-28" />
  const listed = d.listing?.valid ? d.listing : undefined
  const badge = listed ? <Badge tone="accent">For sale</Badge> : d.available ? (
      <Badge tone="good">
        <LiveDot className="mr-1.5 h-1.5 w-1.5" /> Available
      </Badge>
    ) : isExpired(d) ? <Badge tone="warn">Grace period</Badge> : <Badge>Registered</Badge>
  const amount = listed ? listed.price : d.available ? rent.data : undefined
  const value =
    amount !== undefined ? (
      <span className="whitespace-nowrap">
        <CountUp to={Number(amount) / 1_000_000} format={(n) => n.toFixed(2)} finalText={fmtUsdc(amount)} className="glow-num" />{' '}
        <span className="text-[10px] font-medium text-[var(--muted)] sm:text-xs">USDC</span>
      </span>
    ) : d.available ? (
      '…'
    ) : undefined
  const meta = listed ? 'Listed price' : d.available ? 'Register, 1 year' : d.owner ? `Owner ${shortAddress(d.owner)}` : undefined
  return <DomainTile name={d.full} to={`/domain/${d.full}`} index={index} featured={featured} float className={d.available ? 'tile-avail' : undefined} badge={badge} meta={meta} value={value} />
}

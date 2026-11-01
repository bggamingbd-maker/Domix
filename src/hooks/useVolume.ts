import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { domixAbi } from '@/contracts/abis'
import { apiGet } from '@/lib/api'
import { useNetwork } from '@/lib/network'

interface VolumeApi {
  volume: string
  fees: string
  sales: number
  volume24h: string
  breakdown: Record<'direct' | 'offers' | 'auctions', { sales: number; volume: string; fees: string }>
  synced: boolean
  blocksBehind: number | null
}

export interface TradingVolume {
  /** Total settled USDC volume in 6-decimal units. */
  volume: bigint
  fees: bigint
  sales: number
  volume24h: bigint | null
  /** Where the number comes from. */
  source: 'events' | 'contract'
  /** The marketplace contract's own running counter. */
  counter: bigint
  /** True when the event total equals the contract counter, null when events are not available. */
  matches: boolean | null
  breakdown: VolumeApi['breakdown'] | null
  behind: number | null
}

/**
 * Trading volume from settled sales only: fixed-price Sold, OfferAccepted and AuctionSettled events,
 * cross-checked against the marketplace contract's counter. Falls back to the counter if the indexer is unavailable or behind.
 */
export function useVolume() {
  const { chainId, deployment, deployed } = useNetwork()
  const client = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['volume', chainId, deployment.domix],
    enabled: Boolean(client && deployed && deployment.domix),
    refetchInterval: 10_000,
    queryFn: async (): Promise<TradingVolume> => {
      if (!client || !deployment.domix) throw new Error('not ready')
      const m = deployment.domix
      const [counter, fees, salesCount, indexed] = await Promise.all([
        client.readContract({ address: m, abi: domixAbi, functionName: 'totalVolume' }),
        client.readContract({ address: m, abi: domixAbi, functionName: 'totalFees' }),
        client.readContract({ address: m, abi: domixAbi, functionName: 'salesCount' }),
        apiGet<VolumeApi>('/volume', { chainId }).catch(() => null),
      ])
      if (indexed) {
        // Event totals and the contract counter are each a lower bound of the truth: the counter misses sales whose
        // accounting call failed, and the events miss anything not yet indexed. The larger one is the accurate figure.
        const eventVolume = BigInt(indexed.volume)
        const eventFees = BigInt(indexed.fees)
        const fromEvents = eventVolume >= counter
        return {
          volume: fromEvents ? eventVolume : counter,
          fees: eventFees >= fees ? eventFees : fees,
          sales: Math.max(indexed.sales, Number(salesCount)),
          volume24h: BigInt(indexed.volume24h),
          source: fromEvents ? 'events' : 'contract',
          counter,
          matches: eventVolume === counter,
          breakdown: indexed.breakdown,
          behind: indexed.synced ? 0 : indexed.blocksBehind,
        }
      }
      return {
        volume: counter,
        fees,
        sales: Number(salesCount),
        volume24h: null,
        source: 'contract',
        counter,
        matches: null,
        breakdown: null,
        behind: null,
      }
    },
  })
}

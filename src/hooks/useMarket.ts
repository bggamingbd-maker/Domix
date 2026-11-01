import { useQuery } from '@tanstack/react-query'
import { zeroAddress, type Address } from 'viem'
import { usePublicClient } from 'wagmi'
import { domixAbi } from '@/contracts/abis'
import { apiGet, type AuctionRow, type ListingRow } from '@/lib/api'
import { useNetwork } from '@/lib/network'
import { registrarAbi, tldByRegistrar } from '@/lib/protocol'

export interface VerifiedListing {
  collection: Address
  tokenId: bigint
  label: string | null
  tld: string | null
  seller: Address
  /** Price read from the marketplace contract, not from the index. */
  price: bigint
  expiresAt: bigint
  nameExpires: bigint | null
}

export interface ListingFilters {
  q?: string
  collection?: string
  min?: string
  max?: string
  sort?: string
  seller?: string
  limit?: number
}

/** Index rows are only candidates: each one is re-read from the marketplace and dropped unless isListingValid is true. */
export function useListings(filters: ListingFilters = {}) {
  const { chainId, deployment, deployed } = useNetwork()
  const client = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['listings', chainId, filters, deployment.domix],
    enabled: deployed && Boolean(client),
    refetchInterval: 8000,
    queryFn: async (): Promise<{ listings: VerifiedListing[]; checked: number }> => {
      if (!client || !deployment.domix) return { listings: [], checked: 0 }
      const { listings } = await apiGet<{ listings: ListingRow[] }>('/listings', { chainId, ...filters })
      const verified = await Promise.all(
        listings.map(async (row): Promise<VerifiedListing | null> => {
          const collection = row.collection as Address
          const tokenId = BigInt(row.token_id)
          const [valid, live] = await Promise.all([
            client.readContract({ address: deployment.domix!, abi: domixAbi, functionName: 'isListingValid', args: [collection, tokenId] }),
            client.readContract({ address: deployment.domix!, abi: domixAbi, functionName: 'getListing', args: [collection, tokenId] }),
          ])
          if (!valid || live.seller === zeroAddress) return null
          let label = row.label
          if (!label) label = await client.readContract({ address: collection, abi: registrarAbi, functionName: 'labelOf', args: [tokenId] }).catch(() => null)
          return {
            collection,
            tokenId,
            label,
            tld: tldByRegistrar(chainId, collection)?.tld ?? null,
            seller: live.seller,
            price: BigInt(live.price),
            expiresAt: BigInt(live.expiresAt),
            nameExpires: row.name_expires ? BigInt(row.name_expires) : null,
          }
        }),
      )
      return { listings: verified.filter((v): v is VerifiedListing => v !== null), checked: listings.length }
    },
  })
}

export interface LiveAuction {
  id: bigint
  collection: Address
  tokenId: bigint
  label: string | null
  seller: Address
  startPrice: bigint
  minIncrement: bigint
  highestBid: bigint
  highestBidder: Address
  endTime: bigint
  status: number
  minNextBid: bigint
}

/** Auction rows from the index, with state re-read from the auction contract. */
export function useAuctions(opts: { status?: string; seller?: string } = {}) {
  const { chainId, deployment, deployed } = useNetwork()
  const client = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['auctions', chainId, opts, deployment.domix],
    enabled: deployed && Boolean(client),
    refetchInterval: 8000,
    queryFn: async (): Promise<LiveAuction[]> => {
      if (!client || !deployment.domix) return []
      const { auctions } = await apiGet<{ auctions: AuctionRow[] }>('/auctions', { chainId, ...opts })
      return Promise.all(
        auctions.map(async (row) => {
          const id = BigInt(row.id)
          const [a, minNextBid] = await Promise.all([
            client.readContract({ address: deployment.domix!, abi: domixAbi, functionName: 'getAuction', args: [id] }),
            client.readContract({ address: deployment.domix!, abi: domixAbi, functionName: 'minNextBid', args: [id] }).catch(() => 0n),
          ])
          return {
            id,
            collection: a.collection,
            tokenId: a.tokenId,
            label: row.label,
            seller: a.seller,
            startPrice: BigInt(a.startPrice),
            minIncrement: BigInt(a.minIncrement),
            highestBid: BigInt(a.highestBid),
            highestBidder: a.highestBidder,
            endTime: BigInt(a.endTime),
            status: a.status,
            minNextBid,
          }
        }),
      )
    },
  })
}

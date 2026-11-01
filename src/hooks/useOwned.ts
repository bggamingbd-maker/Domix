import { useQuery } from '@tanstack/react-query'
import { zeroAddress, type Address } from 'viem'
import { usePublicClient } from 'wagmi'
import { domixAbi } from '@/contracts/abis'
import { apiGet, type OfferRow, type OwnedRow } from '@/lib/api'
import { useNetwork } from '@/lib/network'
import { registrarAbi, tldByRegistrar } from '@/lib/protocol'

export interface OwnedDomain {
  collection: Address
  tokenId: bigint
  label: string | null
  tld: string | null
  expires: bigint | null
  listingPrice: bigint | null
  topOffer: bigint | null
}

/** Domains the address owns, confirmed against the registrar's ownerOf, with live listing and offer data. */
export function useOwned(address: Address | undefined) {
  const { chainId, deployment, deployed } = useNetwork()
  const client = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['my-domains', chainId, address, deployment.domix],
    enabled: Boolean(address && client),
    refetchInterval: 15_000,
    queryFn: async (): Promise<OwnedDomain[]> => {
      if (!client || !address) return []
      const { domains } = await apiGet<{ domains: OwnedRow[] }>(`/owned/${address}`, { chainId })
      const offers = deployed
        ? await apiGet<{ offers: OfferRow[] }>(`/received-offers/${address}`, { chainId }).then((r) => r.offers).catch(() => [] as OfferRow[])
        : []
      const rows = await Promise.all(
        domains.map(async (d): Promise<OwnedDomain | null> => {
          const collection = d.collection as Address
          const tokenId = BigInt(d.token_id)
          const owner = await client.readContract({ address: collection, abi: registrarAbi, functionName: 'ownerOf', args: [tokenId] }).catch(() => undefined)
          if (!owner || owner.toLowerCase() !== address.toLowerCase()) return null
          const expires = await client.readContract({ address: collection, abi: registrarAbi, functionName: 'nameExpires', args: [tokenId] }).catch(() => undefined)
          let label = d.label
          if (!label) label = await client.readContract({ address: collection, abi: registrarAbi, functionName: 'labelOf', args: [tokenId] }).catch(() => null)
          let listingPrice: bigint | null = null
          if (deployment.domix) {
            const [valid, live] = await Promise.all([
              client.readContract({ address: deployment.domix, abi: domixAbi, functionName: 'isListingValid', args: [collection, tokenId] }),
              client.readContract({ address: deployment.domix, abi: domixAbi, functionName: 'getListing', args: [collection, tokenId] }),
            ])
            if (valid && live.seller !== zeroAddress) listingPrice = BigInt(live.price)
          }
          let topOffer: bigint | null = null
          if (deployment.domix) {
            const mine = offers.filter((o) => o.collection.toLowerCase() === collection.toLowerCase() && o.token_id === d.token_id)
            const now = BigInt(Math.floor(Date.now() / 1000))
            for (const o of mine) {
              const live = await client.readContract({ address: deployment.domix, abi: domixAbi, functionName: 'getOffer', args: [BigInt(o.id)] })
              const price = BigInt(live.price)
              if (live.status === 0 && BigInt(live.expiresAt) > now && (topOffer === null || price > topOffer)) topOffer = price
            }
          }
          return { collection, tokenId, label, tld: tldByRegistrar(chainId, collection)?.tld ?? null, expires: expires ?? null, listingPrice, topOffer }
        }),
      )
      return rows.filter((r): r is OwnedDomain => r !== null)
    },
  })
}


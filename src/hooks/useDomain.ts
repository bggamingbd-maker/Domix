import { useQuery } from '@tanstack/react-query'
import { zeroAddress, type Address, type Hex } from 'viem'
import { usePublicClient } from 'wagmi'
import { domixAbi } from '@/contracts/abis'
import { getProtocol, labelToTokenId, nodeOf, registrarAbi, controllerAbi, registryAbi, resolverAbi, tldInfo } from '@/lib/protocol'
import { useNetwork } from '@/lib/network'

export interface ListingInfo {
  seller: Address
  price: bigint
  expiresAt: bigint
  /** Result of the marketplace's own onchain validity check (owner, approval, expiry, allowlist). */
  valid: boolean
}

export interface DomainInfo {
  chainId: number
  label: string
  tld: 'arc' | 'circle'
  full: string
  collection: Address
  controller: Address
  tokenId: bigint
  node: Hex
  /** controller.available(label): true only when the name can be registered right now. */
  available: boolean
  owner?: Address
  registryOwner?: Address
  /** Resolver contract set for this name in the registry (zero when unset). */
  resolver?: Address
  expires?: bigint
  resolvedAddr?: Address
  listing?: ListingInfo
}

type Client = NonNullable<ReturnType<typeof usePublicClient>>

/**
 * Everything the app needs to know about one name, read in as few round trips as possible:
 * one batched request for registry, registrar, controller and marketplace state, then one more only when a resolver is set.
 */
export async function fetchDomain(
  client: Client,
  chainId: number,
  domix: Address | undefined,
  label: string,
  tld: 'arc' | 'circle',
): Promise<DomainInfo> {
  const protocol = getProtocol(chainId)
  const info = tldInfo(chainId, tld)
  if (!protocol || !info) throw new Error('Naming protocol not available on this network')
  const tokenId = labelToTokenId(label)
  const node = nodeOf(label, tld)
  const collection = info.registrar

  const [available, owner, expires, registryOwner, resolverAddr, rawListing, listingValid] = await Promise.all([
    client.readContract({ address: info.controller, abi: controllerAbi, functionName: 'available', args: [label] }),
    client.readContract({ address: collection, abi: registrarAbi, functionName: 'ownerOf', args: [tokenId] }).catch(() => undefined),
    client.readContract({ address: collection, abi: registrarAbi, functionName: 'nameExpires', args: [tokenId] }).catch(() => undefined),
    client.readContract({ address: protocol.registry, abi: registryAbi, functionName: 'owner', args: [node] }).catch(() => undefined),
    client.readContract({ address: protocol.registry, abi: registryAbi, functionName: 'resolver', args: [node] }).catch(() => undefined),
    domix ? client.readContract({ address: domix, abi: domixAbi, functionName: 'getListing', args: [collection, tokenId] }).catch(() => undefined) : undefined,
    domix ? client.readContract({ address: domix, abi: domixAbi, functionName: 'isListingValid', args: [collection, tokenId] }).catch(() => false) : false,
  ])

  let resolvedAddr: Address | undefined
  if (resolverAddr && resolverAddr !== zeroAddress) {
    const a = await client.readContract({ address: resolverAddr, abi: resolverAbi, functionName: 'addr', args: [node] }).catch(() => undefined)
    if (a && a !== zeroAddress) resolvedAddr = a
  }

  let listing: ListingInfo | undefined
  if (owner && rawListing && rawListing.seller !== zeroAddress) {
    listing = { seller: rawListing.seller, price: BigInt(rawListing.price), expiresAt: BigInt(rawListing.expiresAt), valid: listingValid }
  }

  return {
    chainId,
    label,
    tld,
    full: `${label}.${tld}`,
    collection,
    controller: info.controller,
    tokenId,
    node,
    available,
    owner: owner && owner !== zeroAddress ? owner : undefined,
    registryOwner: registryOwner && registryOwner !== zeroAddress ? registryOwner : undefined,
    resolver: resolverAddr && resolverAddr !== zeroAddress ? resolverAddr : undefined,
    expires,
    resolvedAddr,
    listing,
  }
}

export const domainKey = (chainId: number, label: string | undefined, tld: string | undefined, domix: Address | undefined) =>
  ['domain', chainId, label, tld, domix] as const

export function useDomain(label: string | undefined, tld: 'arc' | 'circle' | undefined) {
  const { chainId, deployment } = useNetwork()
  const client = usePublicClient({ chainId })

  return useQuery({
    queryKey: domainKey(chainId, label, tld, deployment.domix),
    enabled: Boolean(client && label && tld && getProtocol(chainId)),
    refetchInterval: 15_000,
    retry: 2,
    retryDelay: (attempt) => 250 * 2 ** attempt,
    queryFn: () => {
      if (!client || !label || !tld) throw new Error('not ready')
      return fetchDomain(client, chainId, deployment.domix, label, tld)
    },
  })
}

/** True if the name is past its expiry (ownerOf may still answer during the grace period). */
export function isExpired(info: DomainInfo): boolean {
  return info.expires !== undefined && info.expires > 0n && info.expires <= BigInt(Math.floor(Date.now() / 1000))
}

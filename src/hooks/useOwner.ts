import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import { domixAbi } from '@/contracts/abis'
import { useNetwork } from '@/lib/network'

export interface OwnerInfo {
  owner: Address
  pendingOwner: Address
}

const ownerKey = (chainId: number, domix: string) => `domix.owner:${chainId}:${domix.toLowerCase()}`
const ADDRESS_KEY = 'domix.lastAddress'

function readCachedOwner(chainId: number, domix: string): OwnerInfo | undefined {
  try {
    const raw = localStorage.getItem(ownerKey(chainId, domix))
    return raw ? (JSON.parse(raw) as OwnerInfo) : undefined
  } catch {
    return undefined
  }
}

/**
 * Owner and pending owner of the DOMIX contract. Cached in memory and in localStorage, so the Admin tab can
 * render on the first frame and never disappears while a refresh is in flight. Ownership rarely changes.
 */
export function useOwnerInfo() {
  const { chainId, deployment } = useNetwork()
  const client = usePublicClient({ chainId })
  const domix = deployment.domix
  return useQuery({
    queryKey: ['owner-info', chainId, domix],
    enabled: Boolean(client && domix),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 4,
    retryDelay: (attempt) => Math.min(800 * 2 ** attempt, 10_000),
    placeholderData: keepPreviousData,
    initialData: () => (domix ? readCachedOwner(chainId, domix) : undefined),
    initialDataUpdatedAt: 0,
    queryFn: async (): Promise<OwnerInfo> => {
      if (!client || !domix) throw new Error('not deployed')
      const [owner, pendingOwner] = await Promise.all([
        client.readContract({ address: domix, abi: domixAbi, functionName: 'owner' }),
        client.readContract({ address: domix, abi: domixAbi, functionName: 'pendingOwner' }),
      ])
      const info = { owner, pendingOwner }
      try {
        localStorage.setItem(ownerKey(chainId, domix), JSON.stringify(info))
      } catch {
        /* storage unavailable: the in-memory cache still works */
      }
      return info
    },
  })
}

/**
 * The connected address, held steady while the wallet reconnects after a page load.
 * `settling` is true while the wallet is still reconnecting, so screens can wait instead of flashing "not connected".
 */
export function useStableAddress(): { address: Address | undefined; settling: boolean } {
  const { address, status } = useAccount()
  const [grace, setGrace] = useState(true)
  const previous = useRef(status)

  useEffect(() => {
    if (status === 'connected' && address) {
      localStorage.setItem(ADDRESS_KEY, address)
    } else if (status === 'disconnected' && previous.current === 'connected') {
      localStorage.removeItem(ADDRESS_KEY)
    }
    previous.current = status
  }, [status, address])

  useEffect(() => {
    const timer = setTimeout(() => setGrace(false), 2500)
    return () => clearTimeout(timer)
  }, [])

  const remembered = (localStorage.getItem(ADDRESS_KEY) as Address | null) ?? undefined
  const settling = status === 'connecting' || status === 'reconnecting' || (grace && status === 'disconnected' && Boolean(remembered))
  return { address: address ?? (settling ? remembered : undefined), settling }
}

/** True when the connected wallet is the DOMIX owner or the pending owner. Drives the Admin tab. */
export function useIsAdmin(): boolean {
  const { address } = useStableAddress()
  const { data } = useOwnerInfo()
  if (!address || !data) return false
  const me = address.toLowerCase()
  return data.owner.toLowerCase() === me || data.pendingOwner.toLowerCase() === me
}

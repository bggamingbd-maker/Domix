import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { usePublicClient } from 'wagmi'
import { useNetwork } from '@/lib/network'
import { ARCNS, registrarAbi } from '@/lib/protocol'

/** How many ArcNS names a wallet holds, read from the registrars' balanceOf. Exact and instant, no indexer needed. */
export function useOwnedCount(address: Address | undefined) {
  const { chainId } = useNetwork()
  const client = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['owned-count', chainId, address],
    enabled: Boolean(address && client),
    refetchInterval: 20_000,
    queryFn: async () => {
      if (!client || !address) return 0
      const counts = await Promise.all((ARCNS[chainId]?.tlds ?? []).map((t) => client.readContract({ address: t.registrar, abi: registrarAbi, functionName: 'balanceOf', args: [address] })))
      return counts.reduce((n, c) => n + Number(c), 0)
    },
  })
}

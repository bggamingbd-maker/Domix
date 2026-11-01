import { erc20Abi } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { useNetwork } from '@/lib/network'

/** Live USDC balance from the ERC-20 view (6 decimals). On Arc this is the same pool as the gas balance. */
export function useUsdcBalance() {
  const { address } = useAccount()
  const { chainId, usdc } = useNetwork()
  return useReadContract({
    address: usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: Boolean(address), refetchInterval: 30_000 },
  })
}

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Address } from 'viem'
import deploymentsJson from '@/deployments.json'
import { getUsdc, requireChain } from '@/onchain-facts'
import { ARC_MAINNET_ID, ARC_TESTNET_ID } from '@/config'

export interface DomixDeployment {
  /** The single DOMIX contract: listings, offers, auctions and profile records. */
  domix?: Address
  /** Block the contract was deployed at; used as the indexer floor. */
  deployBlock?: number
}

const deployments = deploymentsJson as Record<string, DomixDeployment>

export function getDeployment(chainId: number): DomixDeployment {
  return deployments[String(chainId)] ?? {}
}

export function isDeployed(d: DomixDeployment): d is DomixDeployment & { domix: Address } {
  return Boolean(d.domix)
}

interface NetworkState {
  chainId: number
  setChainId: (id: number) => void
  deployment: DomixDeployment
  deployed: boolean
  usdc: Address
  isMainnet: boolean
  chainName: string
}

const NetworkContext = createContext<NetworkState | null>(null)
const STORAGE_KEY = 'domix.network'

function initialChain(): number {
  const stored = Number(localStorage.getItem(STORAGE_KEY))
  if (stored === ARC_MAINNET_ID || stored === ARC_TESTNET_ID) return stored
  const fromEnv = Number(import.meta.env.VITE_DOMIX_CHAIN_ID)
  if (fromEnv === ARC_MAINNET_ID || fromEnv === ARC_TESTNET_ID) return fromEnv
  // Arc Mainnet is the default. Visitors can switch to Arc Testnet from the header.
  return ARC_MAINNET_ID
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [chainId, setChain] = useState<number>(initialChain)
  const setChainId = useCallback((id: number) => {
    localStorage.setItem(STORAGE_KEY, String(id))
    setChain(id)
  }, [])

  const value = useMemo<NetworkState>(() => {
    const deployment = getDeployment(chainId)
    const usdc = getUsdc(chainId)
    if (!usdc) throw new Error(`USDC is not registered for chain ${chainId}`)
    return {
      chainId,
      setChainId,
      deployment,
      deployed: isDeployed(deployment),
      usdc: usdc.address as Address,
      isMainnet: chainId === ARC_MAINNET_ID,
      chainName: requireChain(chainId).name,
    }
  }, [chainId, setChainId])

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
}

export function useNetwork(): NetworkState {
  const ctx = useContext(NetworkContext)
  if (!ctx) throw new Error('useNetwork must be used inside NetworkProvider')
  return ctx
}

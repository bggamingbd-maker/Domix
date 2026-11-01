/**
 * wagmi configuration: Arc Mainnet and Arc Testnet.
 * Built with Arc Studio — https://studio.arc.io
 */

import { fallback, http, createConfig } from 'wagmi'
import { arc, arcTestnet } from 'viem/chains'
import { injected, walletConnect } from 'wagmi/connectors'
import { requireChain } from '@/onchain-facts'
import { registerChain } from './tracing'

export const ARC_MAINNET_ID = 5042
export const ARC_TESTNET_ID = 5042002

const mainnetRpc = requireChain(ARC_MAINNET_ID).rpcUrls[0]
const testnetRpc = requireChain(ARC_TESTNET_ID).rpcUrls[0]

// Where reads go, in order. A failed or rate-limited read moves on to the next entry, so one busy endpoint does not stall the app.
// Dev preview: the same-origin relay in vite.config.ts first. Built apps: the public RPC directly, then a same-origin copy
// (`/rpc/<chainId>`, forwarded by the host: see public/vercel.json) that reaches the chain from a different network address.
const origin = typeof window !== 'undefined' ? window.location.origin : undefined
const sameOrigin = (chainId: number) => (origin ? `${origin}/rpc/${chainId}` : undefined)
const endpoints = (chainId: number, publicUrl: string): string[] => {
  const proxy = sameOrigin(chainId)
  if (!proxy) return [publicUrl]
  return import.meta.env.DEV ? [proxy, publicUrl] : [publicUrl, proxy]
}
const mainnetEndpoints = endpoints(ARC_MAINNET_ID, mainnetRpc)
const testnetEndpoints = endpoints(ARC_TESTNET_ID, testnetRpc)

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, testnetRpc)
registerChain(arc.id, mainnetRpc)
for (const url of testnetEndpoints) registerChain(arcTestnet.id, url)
for (const url of mainnetEndpoints) registerChain(arc.id, url)

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined

/** WalletConnect only appears when a real project id is configured. */
export const walletConnectEnabled = Boolean(walletConnectProjectId)

const rpcOptions = { batch: { wait: 25, batchSize: 40 }, retryCount: 1, retryDelay: 300, timeout: 12_000 } as const
const rpcTransport = (urls: string[]) => fallback(urls.map((u) => http(u, rpcOptions)), { retryCount: 4, retryDelay: 400, rank: false })

export const config = createConfig({
  chains: [arcTestnet, arc],
  connectors: [
    // MetaMask, Rabby and any EIP-1193 injected wallet
    injected(),
    ...(walletConnectProjectId ? [walletConnect({ projectId: walletConnectProjectId, showQrModal: true })] : []),
  ],
  transports: {
    // Public RPC endpoints rate-limit bursts: group concurrent calls into one request and retry with backoff.
    [arcTestnet.id]: rpcTransport(testnetEndpoints),
    [arc.id]: rpcTransport(mainnetEndpoints),
  },
})

import { createPublicClient, http, type Address, type PublicClient } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import deploymentsJson from '../src/deployments.json'
import { getChain } from '../src/onchain-facts'

export interface DomixDeployment {
  /** The single DOMIX contract: listings, offers, auctions and profile records. */
  domix?: Address
  deployBlock?: number
}

export const deployments = deploymentsJson as Record<string, DomixDeployment>

/** Compass chain keys used by the sandbox RPC proxy. */
const PROXY_KEYS: Record<number, string> = { 5042002: 'Arc_Testnet', 5042: 'Arc' }

export const API_PORT = Number(process.env.DOMIX_API_PORT ?? 3001)

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. Add it to .env (see README).')
  return url
}

/** Chains the indexer follows. Defaults to every chain DOMIX or ArcNS runs on. */
export function indexedChains(): number[] {
  const raw = process.env.INDEX_CHAINS ?? '5042,5042002'
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => n === 5042002 || n === 5042)
}

/** Proxy URLs that answered a probe at startup. A proxy token that is missing, expired or rejected is ignored. */
const workingProxy = new Set<number>()

function proxyUrl(chainId: number): string | undefined {
  const key = PROXY_KEYS[chainId]
  const proxied = (process.env.RPC_PROXY_CHAINS || '').split(',')
  if (process.env.RPC_PROXY_BASE_URL && process.env.RPC_PROXY_TOKEN && key && proxied.indexOf(key) !== -1) {
    return `${process.env.RPC_PROXY_BASE_URL}/api/rpc/${key}?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
  }
  return undefined
}

/** Call once at startup: keeps the keyed RPC proxy only when it actually answers, otherwise the public RPC is used. */
export async function probeRpc(chains: number[]): Promise<void> {
  for (const chainId of chains) {
    const url = proxyUrl(chainId)
    if (!url) continue
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId' }),
        signal: AbortSignal.timeout(8000),
      })
      const body = (await res.json()) as { result?: string }
      if (body.result) workingProxy.add(chainId)
    } catch {
      /* proxy unavailable: use the public RPC */
    }
    console.log(`[rpc] chain ${chainId}: ${workingProxy.has(chainId) ? 'RPC proxy' : 'public RPC'}`)
  }
}

export function resolveRpcUrl(chainId: number): { url: string; viaProxy: boolean } {
  const proxied = workingProxy.has(chainId) ? proxyUrl(chainId) : undefined
  if (proxied) return { url: proxied, viaProxy: true }
  const fact = getChain(chainId)
  const url = fact?.rpcUrls[0]
  if (!url) throw new Error(`No RPC URL known for chain ${chainId}`)
  return { url, viaProxy: false }
}

/**
 * The sandbox shares one IP between this indexer and the browser relay, and the public RPC rate-limits it.
 * Space every indexer request out so the app's own reads always have headroom.
 */
const RPC_GAP_MS = 220
let nextSlot = 0
const pacedFetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
  const now = Date.now()
  const at = Math.max(now, nextSlot)
  nextSlot = at + RPC_GAP_MS
  if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now))
  return fetch(input, init)
}

const clients = new Map<number, PublicClient>()

export function clientFor(chainId: number): PublicClient {
  const existing = clients.get(chainId)
  if (existing) return existing
  const chain = chainId === 5042 ? arc : arcTestnet
  const { url } = resolveRpcUrl(chainId)
  const client = createPublicClient({ chain, transport: http(url, { retryCount: 5, retryDelay: 800, timeout: 20_000, fetchFn: pacedFetch }) }) as PublicClient
  clients.set(chainId, client)
  return client
}

export function domixFor(chainId: number): DomixDeployment {
  return deployments[String(chainId)] ?? {}
}

export function isDomixDeployed(d: DomixDeployment): boolean {
  return Boolean(d.domix)
}

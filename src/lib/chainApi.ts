/**
 * Backend-free data layer. A built app (Vercel, Netlify) has no indexer, but every marketplace action goes through the
 * single DOMIX contract, so its event log is small. This module reads that log straight from the chain, keeps it in
 * memory and localStorage, and answers the same requests the indexer API does. Anything that needs the full ArcNS
 * history (owned-name lists, registry totals) is reported as unsupported and the UI hides it.
 */
import { decodeEventLog, type Address } from 'viem'
import { getPublicClient } from 'wagmi/actions'
import { config } from '@/config'
import { domixAbi } from '@/contracts/abis'
import deploymentsJson from '@/deployments.json'
import { FEATURED_NAMES } from '@/lib/featured'
import { labelToTokenId, registrarAbi, tldInfo } from '@/lib/protocol'
import type { ActivityRow, AuctionRow, ListingRow, OfferRow, OwnedRow } from '@/lib/api'

export class UnsupportedRequest extends Error {}

type Params = Record<string, string | number | undefined>
type Args = Record<string, unknown>

interface Ev {
  block: number
  time: number
  tx: string
  idx: number
  name: string
  args: Args
}

interface ChainState {
  events: Ev[]
  cursor: number
  labels: Record<string, string | null>
  syncedAt: number
}

const deployments = deploymentsJson as Record<string, { domix?: Address; deployBlock?: number }>
const CHUNK = 8_999 // the public RPC rejects getLogs ranges above 10,000 blocks
const MIN_SYNC_GAP_MS = 3_000

const states = new Map<number, ChainState>()
const inflight = new Map<number, Promise<ChainState>>()

const storageKey = (chainId: number, domix: string) => `domix.events.v1.${chainId}.${domix.toLowerCase()}`
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean' ? String(v) : '')
const lower = (v: unknown): string => str(v).toLowerCase()

function load(chainId: number, domix: string): ChainState | undefined {
  try {
    const raw = localStorage.getItem(storageKey(chainId, domix))
    return raw ? (JSON.parse(raw) as ChainState) : undefined
  } catch {
    return undefined
  }
}

function save(chainId: number, domix: string, st: ChainState) {
  try {
    localStorage.setItem(storageKey(chainId, domix), JSON.stringify({ ...st, syncedAt: 0 }))
  } catch {
    /* storage full or unavailable: the in-memory copy still works */
  }
}

function normalise(args: Args): Args {
  const out: Args = {}
  for (const [k, v] of Object.entries(args)) out[k] = typeof v === 'bigint' ? v.toString() : v
  return out
}

async function sync(chainId: number): Promise<ChainState> {
  const dep = deployments[String(chainId)]
  if (!dep?.domix) throw new UnsupportedRequest('DOMIX is not deployed on this network')
  const domix = dep.domix
  let st = states.get(chainId)
  if (!st) {
    st = load(chainId, domix) ?? { events: [], cursor: (dep.deployBlock ?? 1) - 1, labels: {}, syncedAt: 0 }
    states.set(chainId, st)
  }
  if (Date.now() - st.syncedAt < MIN_SYNC_GAP_MS) return st
  const running = inflight.get(chainId)
  if (running) return running
  const state = st

  const job = (async () => {
    const client = getPublicClient(config, { chainId: chainId as never })
    if (!client) throw new UnsupportedRequest('No RPC client')
    const head = Number(await client.getBlockNumber())
    let from = state.cursor + 1
    while (from <= head) {
      const to = Math.min(head, from + CHUNK)
      const logs = await client.getLogs({ address: domix, fromBlock: BigInt(from), toBlock: BigInt(to) })
      const fresh: Ev[] = []
      for (const log of logs) {
        try {
          const d = decodeEventLog({ abi: domixAbi, data: log.data, topics: log.topics }) as { eventName: string; args?: Args }
          fresh.push({ block: Number(log.blockNumber), time: 0, tx: log.transactionHash ?? '', idx: Number(log.logIndex ?? 0), name: d.eventName, args: normalise(d.args ?? {}) })
        } catch {
          /* not a DOMIX event */
        }
      }
      if (fresh.length) {
        const blocks = [...new Set(fresh.map((e) => e.block))]
        const times = new Map<number, number>()
        await Promise.all(blocks.map(async (b) => times.set(b, Number((await client.getBlock({ blockNumber: BigInt(b) })).timestamp))))
        for (const e of fresh) e.time = times.get(e.block) ?? 0
        const pairs = new Map<string, { collection: Address; tokenId: bigint }>()
        for (const e of fresh) {
          if (e.args.collection && e.args.tokenId !== undefined) pairs.set(`${lower(e.args.collection)}:${str(e.args.tokenId)}`, { collection: e.args.collection as Address, tokenId: BigInt(str(e.args.tokenId)) })
        }
        await Promise.all(
          [...pairs.entries()]
            .filter(([k]) => state.labels[k] === undefined)
            .map(async ([k, p]) => {
              state.labels[k] = await client.readContract({ address: p.collection, abi: registrarAbi, functionName: 'labelOf', args: [p.tokenId] }).catch(() => null)
            }),
        )
        state.events.push(...fresh)
      }
      state.cursor = to
      from = to + 1
      save(chainId, domix, state)
    }
    state.syncedAt = Date.now()
    return state
  })().finally(() => inflight.delete(chainId))
  inflight.set(chainId, job)
  return job
}

const labelOf = (st: ChainState, collection: unknown, tokenId: unknown): string | null => st.labels[`${lower(collection)}:${str(tokenId)}`] ?? null
const now = () => Math.floor(Date.now() / 1000)
const sorted = (events: Ev[]) => [...events].sort((a, b) => a.block - b.block || a.idx - b.idx)

function deriveListings(st: ChainState): ListingRow[] {
  const map = new Map<string, ListingRow>()
  for (const e of sorted(st.events)) {
    const key = `${lower(e.args.collection)}:${str(e.args.tokenId)}`
    if (e.name === 'Listed' || e.name === 'ListingUpdated') {
      map.set(key, {
        collection: lower(e.args.collection),
        token_id: str(e.args.tokenId),
        seller: lower(e.args.seller),
        price: str(e.args.price),
        expires_at: str(e.args.expiresAt),
        listed_block: String(e.block),
        label: labelOf(st, e.args.collection, e.args.tokenId),
        name_expires: null,
      })
    } else if (e.name === 'ListingCancelled' || e.name === 'Sold') {
      map.delete(key)
    }
  }
  return [...map.values()].filter((l) => Number(l.expires_at) > now())
}

function deriveAuctions(st: ChainState): AuctionRow[] {
  const map = new Map<string, AuctionRow>()
  for (const e of sorted(st.events)) {
    const id = str(e.args.id)
    if (e.name === 'AuctionCreated') {
      map.set(id, {
        id,
        collection: lower(e.args.collection),
        token_id: str(e.args.tokenId),
        seller: lower(e.args.seller),
        start_price: str(e.args.startPrice),
        min_increment: str(e.args.minIncrement),
        highest_bid: '0',
        highest_bidder: null,
        end_time: str(e.args.endTime),
        status: 'active',
        label: labelOf(st, e.args.collection, e.args.tokenId),
      })
      continue
    }
    const a = map.get(id)
    if (!a) continue
    if (e.name === 'BidPlaced') {
      a.highest_bid = str(e.args.amount)
      a.highest_bidder = lower(e.args.bidder)
    } else if (e.name === 'AuctionExtended') a.end_time = str(e.args.endTime)
    else if (e.name === 'AuctionSettled') a.status = 'settled'
    else if (e.name === 'AuctionCancelled') a.status = 'cancelled'
    else if (e.name === 'AuctionFailed') a.status = 'failed'
    else if (e.name === 'UndeliveredClaimed') a.status = 'claimed'
  }
  return [...map.values()]
}

function deriveOffers(st: ChainState): (OfferRow & { status: string })[] {
  const map = new Map<string, OfferRow & { status: string }>()
  for (const e of sorted(st.events)) {
    const id = str(e.args.id)
    if (e.name === 'OfferMade') {
      map.set(id, {
        id,
        offerer: lower(e.args.offerer),
        collection: lower(e.args.collection),
        token_id: str(e.args.tokenId),
        price: str(e.args.price),
        expires_at: str(e.args.expiresAt),
        status: 'active',
        label: labelOf(st, e.args.collection, e.args.tokenId),
      })
    } else if (e.name === 'OfferCancelled') {
      const o = map.get(id)
      if (o) o.status = 'cancelled'
    } else if (e.name === 'OfferRejected') {
      const o = map.get(id)
      if (o) o.status = 'rejected'
    } else if (e.name === 'OfferAccepted') {
      const o = map.get(id)
      if (o) o.status = 'accepted'
    }
  }
  return [...map.values()]
}

const num = (v: unknown, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export async function clientGet(path: string, params: Params): Promise<unknown> {
  const chainId = Number(params.chainId ?? 5042)

  if (path.startsWith('/owned/')) {
    // Without the indexer there is no full ownership list. Offer the names we can see (traded on DOMIX or featured);
    // the caller confirms each one against the registrar's ownerOf before showing it.
    const st = await sync(chainId)
    const seen = new Map<string, OwnedRow>()
    for (const e of st.events) {
      if (!e.args.collection || e.args.tokenId === undefined) continue
      const key = `${lower(e.args.collection)}:${str(e.args.tokenId)}`
      seen.set(key, { collection: lower(e.args.collection), token_id: str(e.args.tokenId), label: labelOf(st, e.args.collection, e.args.tokenId), expires: null })
    }
    for (const n of FEATURED_NAMES) {
      const info = tldInfo(chainId, n.tld)
      if (!info) continue
      const tokenId = labelToTokenId(n.label).toString()
      seen.set(`${lower(info.registrar)}:${tokenId}`, { collection: lower(info.registrar), token_id: tokenId, label: n.label, expires: null })
    }
    return { chainId, domains: [...seen.values()] }
  }
  if (path.startsWith('/received-offers/')) return { chainId, offers: [] }
  if (path.startsWith('/notifications/')) return { chainId, notifications: [] }
  if (path === '/health') {
    const st = await sync(chainId)
    return { chainId, head: st.cursor, domixDeployed: true, sources: [], blocksBehind: 0, synced: true, historyProgress: 1 }
  }

  const supported = ['/activity', '/listings', '/auctions', '/offers', '/stats', '/volume', '/trending']
  if (!supported.includes(path)) throw new UnsupportedRequest(`${path} needs the indexer`)
  const st = await sync(chainId)

  if (path === '/listings') {
    const q = lower(params.q)
    const collection = lower(params.collection)
    const seller = lower(params.seller)
    const min = params.min !== undefined && /^\d+$/.test(String(params.min)) ? BigInt(params.min) : undefined
    const max = params.max !== undefined && /^\d+$/.test(String(params.max)) ? BigInt(params.max) : undefined
    const sort = str(params.sort || 'recent')
    let rows = deriveListings(st).filter(
      (l) =>
        (!q || lower(l.label).includes(q)) &&
        (!collection || l.collection === collection) &&
        (!seller || l.seller === seller) &&
        (min === undefined || BigInt(l.price) >= min) &&
        (max === undefined || BigInt(l.price) <= max),
    )
    rows = rows.sort((a, b) =>
      sort === 'price_asc' ? Number(BigInt(a.price) - BigInt(b.price)) : sort === 'price_desc' ? Number(BigInt(b.price) - BigInt(a.price)) : sort === 'ending' ? Number(a.expires_at) - Number(b.expires_at) : Number(b.listed_block) - Number(a.listed_block),
    )
    const offset = num(params.offset, 0)
    return { chainId, listings: rows.slice(offset, offset + Math.min(num(params.limit, 50), 200)) }
  }

  if (path === '/auctions') {
    const state = str(params.status || 'active')
    const seller = lower(params.seller)
    const rows = deriveAuctions(st)
      .filter((a) => (state === 'all' || a.status === state) && (!seller || a.seller === seller))
      .sort((a, b) => Number(a.end_time) - Number(b.end_time))
    return { chainId, auctions: rows.slice(0, 100) }
  }

  if (path === '/offers') {
    const collection = lower(params.collection)
    const tokenId = str(params.tokenId)
    const offerer = lower(params.offerer)
    const rows = deriveOffers(st)
      .filter((o) => o.status === 'active' && Number(o.expires_at) > now() && (!collection || o.collection === collection) && (!tokenId || o.token_id === tokenId) && (!offerer || o.offerer === offerer))
      .sort((a, b) => Number(BigInt(b.price) - BigInt(a.price)))
    return { chainId, offers: rows.slice(0, 200) }
  }

  if (path === '/stats') {
    return {
      chainId,
      active_listings: deriveListings(st).length,
      active_auctions: deriveAuctions(st).filter((a) => a.status === 'active' && Number(a.end_time) > now()).length,
      active_offers: deriveOffers(st).filter((o) => o.status === 'active' && Number(o.expires_at) > now()).length,
      direct_sales: st.events.filter((e) => e.name === 'Sold').length,
    }
  }

  if (path === '/volume') {
    const part = (name: string) => {
      const rows = st.events.filter((e) => e.name === name)
      return {
        sales: rows.length,
        volume: rows.reduce((n, e) => n + BigInt(str(e.args.price) || '0'), 0n).toString(),
        fees: rows.reduce((n, e) => n + BigInt(str(e.args.fee) || '0'), 0n).toString(),
      }
    }
    const direct = part('Sold')
    const offers = part('OfferAccepted')
    const auctions = part('AuctionSettled')
    const day = now() - 86_400
    const volume24h = st.events.filter((e) => ['Sold', 'OfferAccepted', 'AuctionSettled'].includes(e.name) && e.time > day).reduce((n, e) => n + BigInt(str(e.args.price) || '0'), 0n)
    return {
      chainId,
      volume: (BigInt(direct.volume) + BigInt(offers.volume) + BigInt(auctions.volume)).toString(),
      fees: (BigInt(direct.fees) + BigInt(offers.fees) + BigInt(auctions.fees)).toString(),
      sales: direct.sales + offers.sales + auctions.sales,
      volume24h: volume24h.toString(),
      breakdown: { direct, offers, auctions },
      synced: true,
      blocksBehind: 0,
    }
  }

  if (path === '/trending') {
    const week = now() - 7 * 86_400
    const counts = new Map<string, { collection: string; token_id: string; actions: number }>()
    for (const e of st.events) {
      if (e.time < week || !e.args.collection || e.args.tokenId === undefined) continue
      const key = `${lower(e.args.collection)}:${str(e.args.tokenId)}`
      const c = counts.get(key) ?? { collection: lower(e.args.collection), token_id: str(e.args.tokenId), actions: 0 }
      c.actions++
      counts.set(key, c)
    }
    const trending = [...counts.values()].sort((a, b) => b.actions - a.actions).slice(0, 12).map((c) => ({ ...c, label: labelOf(st, c.collection, c.token_id) }))
    return { chainId, trending }
  }

  // /activity
  const names = str(params.names).split(',').filter(Boolean)
  const address = lower(params.address)
  const tokenId = str(params.tokenId)
  const collection = lower(params.collection)
  const before = params.before !== undefined && /^\d+$/.test(String(params.before)) ? Number(params.before) : undefined
  const events = [...st.events]
    .filter(
      (e) =>
        (!names.length || names.includes(e.name)) &&
        (!address || Object.values(e.args).some((v) => lower(v) === address)) &&
        (!tokenId || str(e.args.tokenId) === tokenId) &&
        (!collection || lower(e.args.collection) === collection) &&
        (before === undefined || e.block < before),
    )
    .sort((a, b) => b.block - a.block || b.idx - a.idx)
    .slice(0, Math.min(num(params.limit, 30), 200))
    .map(
      (e): ActivityRow => ({
        block_number: String(e.block),
        block_time: String(e.time),
        tx_hash: e.tx,
        log_index: e.idx,
        source: 'domix',
        name: e.name,
        args: e.args as Record<string, string>,
        label: e.args.collection ? labelOf(st, e.args.collection, e.args.tokenId) : null,
      }),
    )
  return { chainId, events }
}

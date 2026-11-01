import { isAddress } from 'viem'
import { ARCNS } from '../src/lib/protocol'
import { API_PORT, clientFor, domixFor, indexedChains, isDomixDeployed } from './config'
import { sql } from './db'
import { HttpError, issueNonce, requireMarketplaceOwner, verifySigned, type SignedRequest } from './auth'
import { resetChain, status } from './indexer'

const ZERO = '0x0000000000000000000000000000000000000000'

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), {
    ...init,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(init.headers ?? {}) },
  })
}

function chainParam(url: URL): number {
  const id = Number(url.searchParams.get('chainId') ?? indexedChains()[0] ?? 5042002)
  if (!indexedChains().includes(id)) throw new HttpError(400, 'Unsupported chain')
  return id
}

function addr(value: string): string {
  if (!isAddress(value)) throw new HttpError(400, 'Invalid address')
  return value.toLowerCase()
}

function clampInt(value: string | null, fallback: number, max: number): number {
  const n = Number(value ?? fallback)
  return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.floor(n))) : fallback
}

async function health(chainId: number) {
  const client = clientFor(chainId)
  const head = Number(await client.getBlockNumber())
  const sources = [...status.values()].filter((s) => s.chainId === chainId)
  const live = sources.filter((s) => s.phase === 'live')
  const history = sources.filter((s) => s.phase === 'history')
  const behind = live.length ? Math.max(...live.map((s) => head - s.cursor)) : null
  // History progress: how much of the older ArcNS range has been read so far.
  const total = history.reduce((n, s) => n + Math.max(1, s.head - s.start), 0)
  const done = history.reduce((n, s) => n + Math.min(Math.max(1, s.head - s.start), Math.max(0, s.cursor - s.start)), 0)
  return {
    chainId,
    head,
    domixDeployed: isDomixDeployed(domixFor(chainId)),
    sources: sources.map((s) => ({
      kind: s.kind,
      phase: s.phase,
      address: s.address,
      cursor: s.cursor,
      blocksRemaining: Math.max(0, (s.phase === 'live' ? head : s.head) - s.cursor),
      lastError: s.lastError ?? null,
    })),
    blocksBehind: behind,
    synced: behind !== null && behind <= 120,
    historyProgress: history.length ? Math.min(1, done / total) : ARCNS[chainId] ? 0 : 1,
  }
}

async function listings(url: URL) {
  const chainId = chainParam(url)
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 64)
  const collection = (url.searchParams.get('collection') ?? '').toLowerCase()
  const seller = url.searchParams.get('seller')
  const min = url.searchParams.get('min')
  const max = url.searchParams.get('max')
  const sort = url.searchParams.get('sort') ?? 'recent'
  const limit = clampInt(url.searchParams.get('limit'), 50, 200)
  const offset = clampInt(url.searchParams.get('offset'), 0, 100_000)
  const order =
    sort === 'price_asc'
      ? sql`l.price ASC`
      : sort === 'price_desc'
        ? sql`l.price DESC`
        : sort === 'ending'
          ? sql`l.expires_at ASC`
          : sql`l.listed_block DESC`
  const rows = await sql`
    SELECT l.collection, l.token_id::text AS token_id, l.seller, l.price::text AS price, l.expires_at::text AS expires_at,
           l.listed_block::text AS listed_block, d.label, d.expires::text AS name_expires
    FROM listings l
    LEFT JOIN domains d ON d.chain_id = l.chain_id AND d.collection = l.collection AND d.token_id = l.token_id
    WHERE l.chain_id = ${chainId} AND l.status = 'active' AND l.expires_at > extract(epoch from now())
      AND (${q} = '' OR d.label ILIKE ${'%' + q.replace(/[%_]/g, '') + '%'})
      AND (${collection} = '' OR l.collection = ${collection})
      AND (${seller ?? ''} = '' OR l.seller = ${(seller ?? '').toLowerCase()})
      AND (${min ?? ''} = '' OR l.price >= ${min && /^\d+$/.test(min) ? min : '0'}::numeric)
      AND (${max ?? ''} = '' OR l.price <= ${max && /^\d+$/.test(max) ? max : '0'}::numeric)
    ORDER BY ${order}
    LIMIT ${limit} OFFSET ${offset}`
  return json({ chainId, listings: rows })
}

async function auctions(url: URL) {
  const chainId = chainParam(url)
  const state = url.searchParams.get('status') ?? 'active'
  const seller = url.searchParams.get('seller') ?? ''
  const rows = await sql`
    SELECT a.id::text AS id, a.collection, a.token_id::text AS token_id, a.seller, a.start_price::text AS start_price,
           a.min_increment::text AS min_increment, a.highest_bid::text AS highest_bid, a.highest_bidder,
           a.end_time::text AS end_time, a.status, d.label
    FROM auctions a
    LEFT JOIN domains d ON d.chain_id = a.chain_id AND d.collection = a.collection AND d.token_id = a.token_id
    WHERE a.chain_id = ${chainId} AND (${state} = 'all' OR a.status = ${state}) AND (${seller} = '' OR a.seller = ${seller.toLowerCase()})
    ORDER BY a.end_time ASC LIMIT 100`
  return json({ chainId, auctions: rows })
}

async function offers(url: URL) {
  const chainId = chainParam(url)
  const collection = (url.searchParams.get('collection') ?? '').toLowerCase()
  const tokenId = url.searchParams.get('tokenId') ?? ''
  const offerer = (url.searchParams.get('offerer') ?? '').toLowerCase()
  const rows = await sql`
    SELECT o.id::text AS id, o.offerer, o.collection, o.token_id::text AS token_id, o.price::text AS price,
           o.expires_at::text AS expires_at, o.status, d.label, d.owner
    FROM offers o
    LEFT JOIN domains d ON d.chain_id = o.chain_id AND d.collection = o.collection AND d.token_id = o.token_id
    WHERE o.chain_id = ${chainId} AND o.status = 'active' AND o.expires_at > extract(epoch from now())
      AND (${collection} = '' OR o.collection = ${collection})
      AND (${tokenId} = '' OR o.token_id = ${/^\d+$/.test(tokenId) ? tokenId : '0'}::numeric)
      AND (${offerer} = '' OR o.offerer = ${offerer})
    ORDER BY o.price DESC LIMIT 200`
  return json({ chainId, offers: rows })
}

async function receivedOffers(url: URL, owner: string) {
  const chainId = chainParam(url)
  const rows = await sql`
    SELECT o.id::text AS id, o.offerer, o.collection, o.token_id::text AS token_id, o.price::text AS price,
           o.expires_at::text AS expires_at, d.label
    FROM offers o
    JOIN domains d ON d.chain_id = o.chain_id AND d.collection = o.collection AND d.token_id = o.token_id
    WHERE o.chain_id = ${chainId} AND o.status = 'active' AND o.expires_at > extract(epoch from now()) AND d.owner = ${owner}
    ORDER BY o.price DESC LIMIT 200`
  return json({ chainId, offers: rows })
}

async function owned(url: URL, owner: string) {
  const chainId = chainParam(url)
  const rows = await sql`
    SELECT d.collection, d.token_id::text AS token_id, d.label, d.expires::text AS expires
    FROM domains d
    WHERE d.chain_id = ${chainId} AND d.owner = ${owner} AND d.owner <> ${ZERO}
    ORDER BY d.label NULLS LAST LIMIT 500`
  return json({ chainId, domains: rows })
}

async function allDomains(url: URL) {
  const chainId = chainParam(url)
  const q = (url.searchParams.get('q') ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '')
  const limit = clampInt(url.searchParams.get('limit'), 24, 60)
  const offset = clampInt(url.searchParams.get('offset'), 0, 100000)
  const rows = await sql`
    SELECT d.collection, d.token_id::text AS token_id, d.label, d.owner, d.expires::text AS expires
    FROM domains d
    WHERE d.chain_id = ${chainId} AND d.owner <> ${ZERO} AND d.label IS NOT NULL
      AND (${q} = '' OR d.label LIKE ${q + '%'})
    ORDER BY d.updated_block DESC, d.label LIMIT ${limit} OFFSET ${offset}`
  const [{ total }] = (await sql`
    SELECT count(*)::int AS total FROM domains d
    WHERE d.chain_id = ${chainId} AND d.owner <> ${ZERO} AND d.label IS NOT NULL AND (${q} = '' OR d.label LIKE ${q + '%'})`) as { total: number }[]
  return json({ chainId, total, domains: rows })
}

async function activity(url: URL) {
  const chainId = chainParam(url)
  const address = (url.searchParams.get('address') ?? '').toLowerCase()
  const tokenId = url.searchParams.get('tokenId') ?? ''
  const collection = (url.searchParams.get('collection') ?? '').toLowerCase()
  const limit = clampInt(url.searchParams.get('limit'), 50, 200)
  const before = url.searchParams.get('before')
  const names = (url.searchParams.get('names') ?? '').split(',').filter((n) => /^[A-Za-z]{1,40}$/.test(n))
  const namesArray = '{' + names.join(',') + '}'
  const tokenHex = /^\d+$/.test(tokenId) ? '0x' + BigInt(tokenId).toString(16).padStart(64, '0') : ''
  const rows = await sql`
    SELECT e.block_number::text AS block_number, e.block_time::text AS block_time, e.tx_hash, e.log_index, e.source, e.name,
           e.args, COALESCE(d.label, e.args->>'name') AS label
    FROM events e
    LEFT JOIN domains d ON d.chain_id = e.chain_id
      AND d.collection = lower(COALESCE(NULLIF(e.args->>'collection', ''), e.contract))
      AND d.token_id = CASE WHEN e.args ? 'tokenId' THEN (e.args->>'tokenId')::numeric END
    WHERE e.chain_id = ${chainId}
      AND e.name NOT IN ('OwnershipTransferStarted', 'OwnershipTransferred', 'RefundCredited', 'PaymentSent', 'RecordSet', 'Paused', 'Unpaused')
      AND (${address} = '' OR e.actors @> ${'{' + address + '}'}::text[])
      AND (${names.length} = 0 OR e.name = ANY(${namesArray}::text[]))
      AND (${tokenId} = '' OR e.args->>'tokenId' = ${tokenId} OR e.args->>'label' = ${tokenHex})
      AND (${collection} = '' OR lower(COALESCE(NULLIF(e.args->>'collection', ''), e.contract)) = ${collection})
      AND (${before ?? ''} = '' OR e.block_number < ${before && /^\d+$/.test(before) ? before : '0'}::bigint)
    ORDER BY e.block_number DESC, e.log_index DESC LIMIT ${limit}`
  return json({ chainId, events: rows })
}

async function trending(url: URL) {
  const chainId = chainParam(url)
  const rows = await sql`
    SELECT lower(e.args->>'collection') AS collection, e.args->>'tokenId' AS token_id, count(*)::int AS actions, d.label
    FROM events e
    LEFT JOIN domains d ON d.chain_id = e.chain_id AND d.collection = lower(e.args->>'collection')
      AND d.token_id = (e.args->>'tokenId')::numeric
    WHERE e.chain_id = ${chainId} AND e.source = 'domix'
      AND e.args ? 'tokenId' AND e.args ? 'collection'
      AND e.block_time > extract(epoch from now() - interval '7 days')
    GROUP BY 1, 2, 4 ORDER BY actions DESC LIMIT 12`
  return json({ chainId, trending: rows })
}

async function volume(url: URL) {
  const chainId = chainParam(url)
  const rows = (await sql`
    SELECT name,
           count(*)::int AS sales,
           coalesce(sum((args->>'price')::numeric), 0)::text AS volume,
           coalesce(sum((args->>'fee')::numeric), 0)::text AS fees,
           coalesce(sum((args->>'price')::numeric) FILTER (WHERE block_time > extract(epoch from now() - interval '24 hours')), 0)::text AS volume_24h
    FROM events
    WHERE chain_id = ${chainId} AND name IN ('Sold', 'OfferAccepted', 'AuctionSettled')
    GROUP BY name`) as { name: string; sales: number; volume: string; fees: string; volume_24h: string }[]
  const by = (name: string) => rows.find((r) => r.name === name)
  const part = (name: string) => ({ sales: Number(by(name)?.sales ?? 0), volume: String(by(name)?.volume ?? '0'), fees: String(by(name)?.fees ?? '0') })
  const direct = part('Sold')
  const offers = part('OfferAccepted')
  const auctions = part('AuctionSettled')
  const sum = (k: 'volume' | 'fees') => (BigInt(direct[k]) + BigInt(offers[k]) + BigInt(auctions[k])).toString()
  const domix = [...status.values()].filter((x) => x.chainId === chainId && x.kind === 'domix')
  const head = Number(await clientFor(chainId).getBlockNumber())
  const remaining = domix.length ? Math.max(...domix.map((x) => head - x.cursor)) : null
  return json({
    chainId,
    volume: sum('volume'),
    fees: sum('fees'),
    sales: direct.sales + offers.sales + auctions.sales,
    volume24h: rows.reduce((acc, r) => acc + BigInt(String(r.volume_24h)), 0n).toString(),
    breakdown: { direct, offers, auctions },
    synced: remaining !== null && remaining <= 60,
    blocksBehind: remaining,
  })
}

async function stats(url: URL) {
  const chainId = chainParam(url)
  const [row] = await sql`
    SELECT
      (SELECT count(*)::int FROM listings WHERE chain_id = ${chainId} AND status = 'active' AND expires_at > extract(epoch from now())) AS active_listings,
      (SELECT count(*)::int FROM auctions WHERE chain_id = ${chainId} AND status = 'active' AND end_time > extract(epoch from now())) AS active_auctions,
      (SELECT count(*)::int FROM offers WHERE chain_id = ${chainId} AND status = 'active' AND expires_at > extract(epoch from now())) AS active_offers,
      (SELECT count(*)::int FROM domains WHERE chain_id = ${chainId} AND owner <> ${ZERO}) AS indexed_domains,
      (SELECT count(*)::int FROM events WHERE chain_id = ${chainId} AND name = 'Sold') AS direct_sales`
  return json({ chainId, ...row })
}

async function names(url: URL) {
  const chainId = chainParam(url)
  const collection = (url.searchParams.get('collection') ?? '').toLowerCase()
  const label = (url.searchParams.get('label') ?? '').toLowerCase()
  if (!label) return json({ chainId, domains: [] })
  const rows = await sql`
    SELECT collection, token_id::text AS token_id, label, owner, expires::text AS expires FROM domains
    WHERE chain_id = ${chainId} AND label = ${label} AND (${collection} = '' OR collection = ${collection})`
  return json({ chainId, domains: rows })
}

async function profile(address: string) {
  const rows = await sql`SELECT address, display_name, bio, updated_at FROM profiles WHERE address = ${address}`
  return json({ profile: rows[0] ?? null })
}

async function saveProfile(req: Request) {
  const body = (await req.json()) as SignedRequest & { displayName?: string; bio?: string }
  const signer = await verifySigned(body, 'profile update')
  const name = (body.displayName ?? '').trim().slice(0, 48)
  const bio = (body.bio ?? '').trim().slice(0, 280)
  // The signed message must commit to the exact content being stored.
  if (!body.message.includes(`Name: ${name}`) || !body.message.includes(`Bio: ${bio.replace(/\n/g, ' ')}`)) {
    throw new HttpError(400, 'Message does not match profile content')
  }
  await sql`
    INSERT INTO profiles (address, display_name, bio, updated_at) VALUES (${signer.toLowerCase()}, ${name}, ${bio}, now())
    ON CONFLICT (address) DO UPDATE SET display_name = EXCLUDED.display_name, bio = EXCLUDED.bio, updated_at = now()`
  return json({ ok: true })
}

async function notifications(url: URL, address: string) {
  const chainId = chainParam(url)
  const rows = await sql`
    SELECT id::text AS id, kind, title, body, tx_hash, extract(epoch from created_at)::bigint::text AS created_at, read
    FROM notifications WHERE chain_id = ${chainId} AND address = ${address} ORDER BY id DESC LIMIT 50`
  return json({ chainId, notifications: rows })
}

async function markRead(req: Request) {
  const body = (await req.json()) as SignedRequest
  const signer = await verifySigned(body, 'mark notifications read')
  await sql`UPDATE notifications SET read = true WHERE address = ${signer.toLowerCase()}`
  return json({ ok: true })
}

async function adminOverview(req: Request) {
  const body = (await req.json()) as SignedRequest & { chainId: number }
  const signer = await verifySigned(body, 'admin overview')
  if (!indexedChains().includes(body.chainId)) throw new HttpError(400, 'Unsupported chain')
  await requireMarketplaceOwner(body.chainId, signer)
  const [counts] = await sql`
    SELECT
      (SELECT count(*)::int FROM events WHERE chain_id = ${body.chainId}) AS events,
      (SELECT count(*)::int FROM notifications WHERE chain_id = ${body.chainId}) AS notifications,
      (SELECT count(*)::int FROM profiles) AS profiles,
      (SELECT count(*)::int FROM listings WHERE chain_id = ${body.chainId} AND status = 'sold') AS indexed_sales`
  return json({ health: await health(body.chainId), counts })
}

async function adminReindex(req: Request) {
  const body = (await req.json()) as SignedRequest & { chainId: number }
  const signer = await verifySigned(body, 'admin reindex')
  if (!indexedChains().includes(body.chainId)) throw new HttpError(400, 'Unsupported chain')
  await requireMarketplaceOwner(body.chainId, signer)
  await resetChain(body.chainId)
  return json({ ok: true })
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const m = req.method

  if (m === 'GET') {
    if (path === '/health') return json(await health(chainParam(url)))
    if (path === '/listings') return listings(url)
    if (path === '/auctions') return auctions(url)
    if (path === '/offers') return offers(url)
    if (path === '/activity') return activity(url)
    if (path === '/trending') return trending(url)
    if (path === '/stats') return stats(url)
    if (path === '/volume') return volume(url)
    if (path === '/names') return names(url)
    if (path === '/domains') return allDomains(url)
    if (path === '/auth/nonce') return json(await issueNonce(addr(url.searchParams.get('address') ?? '')))
    let match = /^\/owned\/(0x[0-9a-fA-F]{40})$/.exec(path)
    if (match) return owned(url, addr(match[1]))
    match = /^\/received-offers\/(0x[0-9a-fA-F]{40})$/.exec(path)
    if (match) return receivedOffers(url, addr(match[1]))
    match = /^\/profile\/(0x[0-9a-fA-F]{40})$/.exec(path)
    if (match) return profile(addr(match[1]))
    match = /^\/notifications\/(0x[0-9a-fA-F]{40})$/.exec(path)
    if (match) return notifications(url, addr(match[1]))
  }
  if (m === 'POST' || m === 'PUT') {
    if (path === '/profile') return saveProfile(req)
    if (path === '/notifications/read') return markRead(req)
    if (path === '/admin/overview') return adminOverview(req)
    if (path === '/admin/reindex') return adminReindex(req)
  }
  throw new HttpError(404, 'Not found')
}

export function startApi() {
  const server = Bun.serve({
    port: API_PORT,
    hostname: process.env.API_HOST ?? '127.0.0.1',
    async fetch(req) {
      // Read endpoints are public chain data and every write is signature-checked, so cross-origin access is safe.
      const cors = { 'access-control-allow-origin': process.env.CORS_ORIGIN ?? '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' }
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
      let res: Response
      try {
        res = await route(req)
      } catch (error) {
        if (error instanceof HttpError) res = json({ error: error.message }, { status: error.status })
        else {
          console.error('[api]', error)
          res = json({ error: 'Internal error' }, { status: 500 })
        }
      }
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
      return res
    },
  })
  console.log(`[api] listening on http://127.0.0.1:${server.port}`)
}

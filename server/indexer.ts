import { decodeEventLog, type Abi, type Address, type Log, type PublicClient } from 'viem'
import { domixAbi } from '../src/contracts/abis'
import { ARCNS, controllerAbi, registrarAbi } from '../src/lib/protocol'
import { clientFor, domixFor, indexedChains, isDomixDeployed } from './config'
import { sql } from './db'
import { applyEvent, type IndexedEvent } from './handlers'

export type SourceKind = 'domix' | 'registrar' | 'controller'

interface Source {
  chainId: number
  address: Address
  kind: SourceKind
  abi: Abi
  /** Block to start from when no cursor is stored (deployment block). */
  startBlock?: number
  /** Tail pass: index only the most recent N blocks first so fresh activity shows up while history backfills. */
  recent?: number
}

export interface SourceStatus {
  chainId: number
  kind: SourceKind
  address: string
  cursor: number
  head: number
  /** 'live' sources follow the chain tip; 'history' sources backfill older ArcNS activity and stop where the live window begins. */
  phase: 'live' | 'history'
  /** First block of this source's range, for progress reporting. */
  start: number
  lastError?: string
  updatedAt: number
}

export const status = new Map<string, SourceStatus>()

const INITIAL_BATCH = 10000n
const MAX_BATCH = 500000n
const MIN_BATCH = 50n
const POLL_MS = 3000

/** Chain head shared by every source for a couple of seconds, so idle sources cost no RPC calls. */
const heads = new Map<number, { value: bigint; at: number }>()
async function headOf(client: PublicClient, chainId: number): Promise<bigint> {
  const cached = heads.get(chainId)
  if (cached && Date.now() - cached.at < 2000) return cached.value
  const value = await client.getBlockNumber()
  heads.set(chainId, { value, at: Date.now() })
  return value
}

function sourcesFor(chainId: number): Source[] {
  const list: Source[] = []
  const d = domixFor(chainId)
  if (isDomixDeployed(d)) {
    list.push({ chainId, address: d.domix!, kind: 'domix', abi: domixAbi as Abi, startBlock: d.deployBlock })
  }
  const protocol = ARCNS[chainId]
  if (protocol) {
    for (const t of protocol.tlds) {
      list.push(
        { chainId, address: t.registrar, kind: 'registrar', abi: registrarAbi as unknown as Abi },
        { chainId, address: t.controller, kind: 'controller', abi: controllerAbi as unknown as Abi },
        { chainId, address: t.registrar, kind: 'registrar', abi: registrarAbi as unknown as Abi, recent: 300_000 },
        { chainId, address: t.controller, kind: 'controller', abi: controllerAbi as unknown as Abi, recent: 300_000 },
      )
    }
  }
  return list
}

async function getState(chainId: number, key: string): Promise<bigint | undefined> {
  const rows = await sql`SELECT value::text AS value FROM sync_state WHERE chain_id = ${chainId} AND key = ${key}`
  return rows.length ? BigInt(rows[0].value) : undefined
}

async function setState(chainId: number, key: string, value: bigint): Promise<void> {
  await sql`
    INSERT INTO sync_state (chain_id, key, value) VALUES (${chainId}, ${key}, ${value.toString()}::numeric)
    ON CONFLICT (chain_id, key) DO UPDATE SET value = EXCLUDED.value`
}

/** Earliest block at which `address` has code, found by binary search on eth_getCode. */
async function findDeployBlock(client: PublicClient, address: Address, head: bigint): Promise<bigint> {
  let lo = 0n
  let hi = head
  while (lo < hi) {
    const mid = (lo + hi) / 2n
    const code = await client.getCode({ address, blockNumber: mid })
    if (code && code !== '0x') hi = mid
    else lo = mid + 1n
  }
  return lo
}

async function startBlockFor(client: PublicClient, src: Source, head: bigint): Promise<bigint> {
  const key = `start:${src.address.toLowerCase()}${src.recent ? ':tail' : ''}`
  const stored = await getState(src.chainId, key)
  if (stored !== undefined) return stored
  let start: bigint
  if (src.recent) {
    start = head > BigInt(src.recent) ? head - BigInt(src.recent) : 0n
  } else if (src.startBlock !== undefined) {
    start = BigInt(src.startBlock)
  } else {
    try {
      start = await findDeployBlock(client, src.address, head)
    } catch (error) {
      // The RPC does not serve historical state. Never fall back to block 0: use a bounded recent window.
      console.warn(`[indexer] deploy block search failed for ${src.address}; scanning the most recent 200000 blocks only`, error)
      start = head > 200_000n ? head - 200_000n : 0n
    }
  }
  await setState(src.chainId, key, start)
  return start
}

function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
}

async function blockTimes(client: PublicClient, blocks: bigint[]): Promise<Map<bigint, bigint>> {
  const unique = [...new Set(blocks)]
  const result = new Map<bigint, bigint>()
  for (let i = 0; i < unique.length; i += 10) {
    const chunk = unique.slice(i, i + 10)
    const fetched = await Promise.all(chunk.map((blockNumber) => client.getBlock({ blockNumber })))
    fetched.forEach((b, idx) => result.set(chunk[idx], b.timestamp))
  }
  return result
}

function collectActors(args: Record<string, unknown>): string[] {
  const out = new Set<string>()
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)) out.add(v.toLowerCase())
  }
  return [...out]
}

async function processBatch(client: PublicClient, src: Source, from: bigint, to: bigint): Promise<number> {
  const logs = (await client.getLogs({ address: src.address, fromBlock: from, toBlock: to })) as Log[]
  if (logs.length === 0) return 0
  const times = await blockTimes(
    client,
    logs.map((l) => l.blockNumber!),
  )
  let handled = 0
  for (const log of logs) {
    if (log.blockNumber == null || log.transactionHash == null || log.logIndex == null) continue
    let decoded: { eventName?: string; args?: unknown }
    try {
      decoded = decodeEventLog({ abi: src.abi, data: log.data, topics: log.topics, strict: false }) as typeof decoded
    } catch {
      continue
    }
    if (!decoded.eventName) continue
    const args = (decoded.args ?? {}) as Record<string, unknown>
    const ev: IndexedEvent = {
      chainId: src.chainId,
      blockNumber: log.blockNumber,
      blockTime: times.get(log.blockNumber) ?? 0n,
      txHash: log.transactionHash,
      logIndex: log.logIndex,
      contract: src.address.toLowerCase(),
      source: src.kind,
      name: decoded.eventName,
      args,
    }
    // Commitments are protocol noise; everything else feeds the activity log.
    if (decoded.eventName !== 'CommitmentMade') {
      await sql`
        INSERT INTO events (chain_id, block_number, block_time, tx_hash, log_index, contract, source, name, args, actors)
        VALUES (${ev.chainId}, ${ev.blockNumber.toString()}, ${ev.blockTime.toString()}, ${ev.txHash}, ${ev.logIndex},
                ${ev.contract}, ${ev.source}, ${ev.name}, ${toJson(args)}::text::jsonb, ${'{' + collectActors(args).join(',') + '}'}::text[])
        ON CONFLICT DO NOTHING`
    }
    await applyEvent(ev)
    handled++
  }
  return handled
}

const batchCeiling = new Map<string, bigint>()

async function syncSource(src: Source, batchSize: Map<string, bigint>): Promise<boolean> {
  const client = clientFor(src.chainId)
  const id = `${src.chainId}:${src.address.toLowerCase()}${src.recent ? ':tail' : ''}`
  let head = await headOf(client, src.chainId)
  const cursorKey = `cursor:${src.address.toLowerCase()}${src.recent ? ':tail' : ''}`
  // The history pass stops where the tail pass begins, so no block range is scanned twice.
  if (!src.recent) {
    const tailStart = await getState(src.chainId, `start:${src.address.toLowerCase()}:tail`)
    if (tailStart !== undefined && tailStart - 1n < head) head = tailStart - 1n
  }
  let cursor = await getState(src.chainId, cursorKey)
  if (cursor === undefined) cursor = (await startBlockFor(client, src, head)) - 1n

  const entry: SourceStatus = status.get(id) ?? {
    chainId: src.chainId,
    kind: src.kind,
    address: src.address,
    phase: src.kind === 'domix' || src.recent ? 'live' : 'history',
    start: Number((await getState(src.chainId, `start:${src.address.toLowerCase()}${src.recent ? ':tail' : ''}`)) ?? cursor),
    cursor: Number(cursor),
    head: Number(head),
    updatedAt: Date.now(),
  }
  entry.head = Number(head)
  entry.cursor = Number(cursor)
  status.set(id, entry)

  if (cursor >= head) return false
  let size = batchSize.get(id) ?? INITIAL_BATCH
  const from = cursor + 1n
  const to = from + size - 1n > head ? head : from + size - 1n
  try {
    await processBatch(client, src, from, to)
    await setState(src.chainId, cursorKey, to)
    entry.cursor = Number(to)
    entry.lastError = undefined
    entry.updatedAt = Date.now()
    const ceiling = batchCeiling.get(id) ?? MAX_BATCH
    if (size < ceiling) size = size * 2n > ceiling ? ceiling : size * 2n
    batchSize.set(id, size)
  } catch (error) {
    // Range too large or transient RPC failure: shrink the window and retry on the next pass.
    const next = size / 2n < MIN_BATCH ? MIN_BATCH : size / 2n
    batchSize.set(id, next)
    const message = error instanceof Error ? error.message : String(error)
    // The node's block-range limit is a fixed ceiling: remember it instead of probing above it again.
    if (/range too large|block range|exceeds.*range/i.test(message)) batchCeiling.set(id, next)
    entry.lastError = message.split('\n')[0].slice(0, 200)
    entry.updatedAt = Date.now()
    console.warn(`[indexer] ${src.kind} ${src.address} ${from}-${to} failed (batch ${size} -> ${next}): ${entry.lastError}`)
    await Bun.sleep(1000)
  }
  return to < head
}

const CONCURRENCY_LIMIT = 3

async function runGroup(sources: Source[], batchSize: Map<string, bigint>): Promise<Map<number, boolean>> {
  const behind = new Map<number, boolean>()
  for (let i = 0; i < sources.length; i += CONCURRENCY_LIMIT) {
    const group = sources.slice(i, i + CONCURRENCY_LIMIT)
    const done = await Promise.all(
      group.map(async (src) => {
        try {
          return await syncSource(src, batchSize)
        } catch (error) {
          console.warn(`[indexer] ${src.kind} ${src.address}:`, error instanceof Error ? error.message.split('\n')[0] : error)
          await Bun.sleep(1000)
          return true
        }
      }),
    )
    group.forEach((src, idx) => behind.set(src.chainId, (behind.get(src.chainId) ?? false) || done[idx]))
    await Bun.sleep(80)
  }
  return behind
}

export async function runIndexer(): Promise<void> {
  const batchSize = new Map<string, bigint>()
  const chains = indexedChains()
  const all = chains.flatMap(sourcesFor)
  console.log(`[indexer] following ${all.length} contracts on chains ${chains.join(', ')}`)
  // Light sources (DOMIX events and the recent ArcNS window) run every round on every chain, so new activity shows up
  // within seconds. The long ArcNS history backfill runs for one chain at a time, in the order of INDEX_CHAINS.
  const light = all.filter((s) => s.kind === 'domix' || s.recent)
  const heavy = all.filter((s) => !(s.kind === 'domix' || s.recent))
  const heavyBehind = new Map<number, boolean>(chains.map((c) => [c, true]))
  // Two loops: the live tail never waits for the history backfill.
  const liveLoop = async () => {
    for (;;) {
      const behind = await runGroup(light, batchSize)
      if (![...behind.values()].some(Boolean)) await Bun.sleep(POLL_MS)
    }
  }
  const historyLoop = async () => {
    for (;;) {
      let anyBehind = false
      for (const chainId of chains) {
        if (!heavyBehind.get(chainId)) continue
        const result = await runGroup(heavy.filter((s) => s.chainId === chainId), batchSize)
        const stillBehind = result.get(chainId) ?? false
        heavyBehind.set(chainId, stillBehind)
        anyBehind = anyBehind || stillBehind
        if (stillBehind) break
      }
      if (!anyBehind) await Bun.sleep(30_000)
    }
  }
  await Promise.all([liveLoop(), historyLoop()])
}

/** Clears the index for a chain so it is rebuilt from the deployment blocks. */
export async function resetChain(chainId: number): Promise<void> {
  for (const table of ['events', 'domains', 'listings', 'offers', 'auctions', 'notifications']) {
    await sql.unsafe(`DELETE FROM ${table} WHERE chain_id = ${Number(chainId)}`)
  }
  await sql`DELETE FROM sync_state WHERE chain_id = ${chainId} AND key LIKE 'cursor:%'`
}

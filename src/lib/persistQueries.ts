import type { QueryClient } from '@tanstack/react-query'

/**
 * Keeps the last good answer of the dashboard's read queries in localStorage, so a repeat visit paints real numbers
 * on the first frame and refreshes them in the background. Chain state is always re-read before any transaction.
 */
const STORAGE_KEY = 'domix.queries.v1'
const KEYS = new Set(['listings', 'volume', 'auctions', 'home-index-stats', 'featured-rent', 'domain', 'owner-info', 'owned-count', 'activity', 'trending'])
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const MAX_ENTRY_CHARS = 60_000

interface Stored {
  key: unknown[]
  data: string
  at: number
}

const encode = (data: unknown): string => JSON.stringify(data, (_k, v: unknown) => (typeof v === 'bigint' ? { __big: v.toString() } : v))
const decode = (text: string): unknown =>
  JSON.parse(text, (_k, v: unknown) => (v !== null && typeof v === 'object' && '__big' in v ? BigInt((v as { __big: string }).__big) : v)) as unknown

export function persistQueries(client: QueryClient): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const entries: Stored[] = raw ? (JSON.parse(raw) as Stored[]) : []
    for (const entry of entries) {
      if (Date.now() - entry.at > MAX_AGE_MS) continue
      client.setQueryData(entry.key, decode(entry.data), { updatedAt: entry.at })
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY)
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const write = () => {
    timer = undefined
    try {
      const out: Stored[] = []
      for (const query of client.getQueryCache().getAll()) {
        const head = String(query.queryKey[0])
        if (!KEYS.has(head) || query.state.status !== 'success') continue
        const data = encode(query.state.data)
        if (data.length > MAX_ENTRY_CHARS) continue
        out.push({ key: query.queryKey as unknown[], data, at: query.state.dataUpdatedAt })
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out.slice(-60)))
    } catch {
      /* storage full or unavailable: skip this write */
    }
  }
  client.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success' && KEYS.has(String((event.query.queryKey as unknown[])[0])) && timer === undefined) {
      timer = setTimeout(write, 1500)
    }
  })
}

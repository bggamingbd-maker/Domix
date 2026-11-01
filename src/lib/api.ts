import { clientGet, UnsupportedRequest } from '@/lib/chainApi'

/** Thin client for the DOMIX backend (indexer + profiles). Chain state is always re-verified onchain by callers. */
/** Backend root. Empty in the Arc Studio preview (Vite proxies /api); set VITE_API_BASE_URL when the backend is hosted elsewhere. */
const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/$/, '')
/** A built app (Vercel, Netlify) has no /api unless VITE_API_BASE_URL points at a hosted backend: skip the doomed requests. */
export const backendAvailable = import.meta.env.DEV || API_BASE !== ''
const apiUrl = (path: string) => (API_BASE ? `${API_BASE}${path}` : `/api${path}`)

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function apiGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  if (!backendAvailable) {
    // No hosted indexer: answer from the chain directly where possible (see chainApi.ts).
    try {
      return (await clientGet(path, params)) as T
    } catch (error) {
      if (error instanceof UnsupportedRequest) throw new ApiError(503, 'Needs the indexer')
      throw error
    }
  }
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
  const res = await fetch(apiUrl(`${path}${qs.size ? `?${qs}` : ''}`))
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`)
  return body as T
}

export async function apiPost<T>(path: string, payload: unknown): Promise<T> {
  if (!backendAvailable) throw new ApiError(503, 'Backend not connected')
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`)
  return body as T
}

export interface ListingRow {
  collection: string
  token_id: string
  seller: string
  price: string
  expires_at: string
  listed_block: string
  label: string | null
  name_expires: string | null
}

export interface AuctionRow {
  id: string
  collection: string
  token_id: string
  seller: string
  start_price: string
  min_increment: string
  highest_bid: string
  highest_bidder: string | null
  end_time: string
  status: string
  label: string | null
}

export interface OfferRow {
  id: string
  offerer: string
  collection: string
  token_id: string
  price: string
  expires_at: string
  label: string | null
  owner?: string | null
}

export interface ActivityRow {
  block_number: string
  block_time: string
  tx_hash: string
  log_index: number
  source: string
  name: string
  args: Record<string, string>
  label: string | null
}

export interface OwnedRow {
  collection: string
  token_id: string
  label: string | null
  expires: string | null
}

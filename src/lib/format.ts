import { USDC_DECIMALS } from '@/onchain-facts'
import { formatUnitsFixed } from '@/onchain-money'

export const fmtUsdc = (raw: bigint | string, digits = 2): string => {
  const n = typeof raw === 'bigint' ? raw : BigInt(raw)
  const text = formatUnitsFixed(n, USDC_DECIMALS, digits)
  const [whole, frac] = text.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac ? `${grouped}.${frac}` : grouped
}

export function fmtDate(seconds: bigint | number | string): string {
  const n = Number(seconds)
  if (!Number.isFinite(n) || n <= 0) return 'n/a'
  return new Date(n * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function fmtDateTime(seconds: bigint | number | string): string {
  const n = Number(seconds)
  if (!Number.isFinite(n) || n <= 0) return 'n/a'
  return new Date(n * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function countdown(endSeconds: number, nowMs: number): string {
  const diff = endSeconds - Math.floor(nowMs / 1000)
  if (diff <= 0) return 'Ended'
  const d = Math.floor(diff / 86400)
  const h = Math.floor((diff % 86400) / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  return `${m}m ${s}s`
}

export function relativeTime(seconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - seconds
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

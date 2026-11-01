import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, X } from 'lucide-react'
import clsx from 'clsx'
import { buildTxExplorerUrl } from '@/onchain-facts'
import type { TxState } from '@/hooks/useTx'
import { useNetwork } from '@/lib/network'
import { Skeleton } from './fx/Ambient'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  disabled,
  onClick,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  variant?: Variant
  loading?: boolean
  onClick?: (e: MouseEvent<HTMLButtonElement>) => unknown
}) {
  const styles: Record<Variant, string> = {
    primary: 'btn-grad font-semibold',
    secondary: 'bg-[var(--surface-strong)] text-[var(--ink)] border border-[var(--border)] hover:border-[var(--border-strong)]',
    ghost: 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]',
    danger: 'bg-[rgba(255,122,138,0.14)] text-[var(--danger)] border border-[rgba(255,122,138,0.35)] hover:bg-[rgba(255,122,138,0.22)]',
  }
  return (
    <button
      {...rest}
      onClick={(e) => {
        void onClick?.(e)
      }}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className,
      )}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('glass rounded-2xl p-5', className)}>{children}</div>
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-[var(--surface-strong)] text-[var(--muted)]',
    good: 'bg-[rgba(111,220,154,0.14)] text-[var(--success)]',
    warn: 'bg-[rgba(245,199,107,0.14)] text-[var(--warn)]',
    bad: 'bg-[rgba(255,122,138,0.14)] text-[var(--danger)]',
    accent: 'bg-[rgba(77,141,255,0.18)] text-[var(--accent-hover)]',
  }
  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium', tones[tone])}>{children}</span>
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label-caps mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-[var(--subtle)]">{hint}</span>}
    </label>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={clsx(
        'min-h-11 w-full rounded-xl border border-[var(--border)] bg-[rgba(4,12,28,0.6)] px-3.5 text-sm text-[var(--ink)] transition-colors focus:border-[var(--accent)]',
        className,
      )}
    />
  )
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(1,3,10,0.78)] p-0 backdrop-blur-sm sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-[var(--border-strong)] bg-[#060d24] p-6 shadow-2xl sm:rounded-3xl"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="display text-xl font-semibold">{title}</h2>
              <button onClick={onClose} aria-label="Close" className="flex size-11 items-center justify-center rounded-xl text-[var(--muted)] hover:bg-[var(--surface)]">
                <X size={18} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function TxBanner({ state }: { state: TxState }) {
  const { chainId } = useNetwork()
  if (state.status === 'idle') return null
  const link = state.hash ? (
    <a href={buildTxExplorerUrl(chainId, state.hash)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 underline">
      {state.hash.slice(0, 10)}…{state.hash.slice(-6)} <ExternalLink size={12} />
    </a>
  ) : null
  if (state.status === 'signing')
    return (
      <div className="flex items-center gap-2 rounded-xl bg-[var(--surface)] p-3 text-sm text-[var(--muted)]">
        <Loader2 size={16} className="animate-spin" /> Confirm in your wallet: {state.label}
      </div>
    )
  if (state.status === 'confirming')
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--surface)] p-3 text-sm text-[var(--muted)]">
        <Loader2 size={16} className="animate-spin" /> Waiting for confirmation {link}
      </div>
    )
  if (state.status === 'success')
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[rgba(111,220,154,0.1)] p-3 text-sm text-[var(--success)]">
        <CheckCircle2 size={16} /> {state.label} confirmed {link}
      </div>
    )
  return (
    <div className="flex items-start gap-2 rounded-xl bg-[rgba(255,122,138,0.1)] p-3 text-sm text-[var(--danger)]">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {state.error}
    </div>
  )
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="glass flex flex-col items-center gap-2 rounded-2xl px-6 py-12 text-center">
      <p className="display text-lg font-semibold">{title}</p>
      {body && <p className="max-w-md text-sm text-[var(--muted)]">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="space-y-3 py-6" role="status">
      <div className="flex items-center justify-center gap-2 text-sm text-[var(--muted)]">
        <Loader2 size={16} className="animate-spin" /> {label ?? 'Loading'}
      </div>
      <Skeleton className="h-16" />
    </div>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Card className="!p-4">
      <p className="label-caps">{label}</p>
      <div className="display num glow-num mt-1.5 text-2xl font-bold">{value}</div>
      {sub && <p className="mt-0.5 text-xs text-[var(--subtle)]">{sub}</p>}
    </Card>
  )
}

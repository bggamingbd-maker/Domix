import { ArrowUpRight } from 'lucide-react'
import { motion } from 'framer-motion'
import { useLite } from '@/hooks/useLite'
import clsx from 'clsx'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from '@/lib/router'

interface DomainTileProps {
  /** Full name such as `pay.arc`. Used for the heading and, unless `to` is given, the link target. */
  name: string
  to?: string
  badge?: ReactNode
  /** One quiet line under the name, for example the seller or expiry. */
  meta?: ReactNode
  /** The main figure, usually a price. */
  value?: ReactNode
  valueLabel?: string
  footer?: ReactNode
  index?: number
  featured?: boolean
  /** Gentle idle bobbing, staggered by index. */
  float?: boolean
  className?: string
}

/**
 * The single minimal tile used for every domain in the app: name, one quiet line, one figure, one badge.
 * Entrance is staggered, hover lifts the tile, sweeps a soft sheen across it and nudges the arrow.
 */
export function DomainTile({ name, to, badge, meta, value, valueLabel, footer, index = 0, featured = false, float = false, className }: DomainTileProps) {
  const reduce = useLite()
  const inner = (
    <div
      className={clsx('tile glass group relative flex h-full min-h-28 flex-col justify-between gap-4 rounded-2xl p-4 sm:p-5', featured && 'glow-border', float && 'tile-float', className)}
      style={float ? ({ animationDelay: `${(index % 10) * -0.65}s`, '--tile-delay': `${(index % 10) * -0.7}s` } as CSSProperties) : undefined}
    >
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="display truncate text-lg font-bold sm:text-xl" title={name}>
            <span className="transition-colors duration-300 group-hover:text-[var(--accent-hover)]">{name}</span>
          </p>
          {meta ? <p className="mono mt-1 truncate text-xs text-[var(--subtle)]">{meta}</p> : null}
        </div>
        <ArrowUpRight size={16} aria-hidden="true" className="mt-1.5 shrink-0 text-[var(--subtle)] transition duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--cyan)]" />
      </div>
      <div className="relative z-10 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {valueLabel ? <p className="label-caps">{valueLabel}</p> : null}
          {value !== undefined && value !== null ? (
            <p className="display num whitespace-nowrap text-base font-bold sm:text-xl">
              {typeof value === 'string' && value.endsWith(' USDC') ? (
                <>
                  {value.slice(0, -5)} <span className="text-[10px] font-medium text-[var(--muted)] sm:text-xs">USDC</span>
                </>
              ) : (
                value
              )}
            </p>
          ) : null}
        </div>
        {badge}
      </div>
      {footer ? <div className="relative z-10">{footer}</div> : null}
    </div>
  )
  return (
    <motion.div
      className="h-full"
      initial={reduce ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-30px' }}
      transition={{ duration: 0.5, delay: Math.min(index, 8) * 0.055, ease: [0.16, 1, 0.3, 1] }}
      whileHover={reduce ? undefined : { y: -5, transition: { duration: 0.2, delay: 0 } }}
      whileTap={reduce ? undefined : { scale: 0.985 }}
    >
      {to ? (
        <Link to={to} className="block h-full rounded-2xl">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </motion.div>
  )
}

interface DomainRowProps {
  name: string
  to: string
  badge?: ReactNode
  meta?: ReactNode
  value?: ReactNode
  index?: number
}

/** One-line list version of the tile: name and quiet detail on the left, price and badge on the right. */
export function DomainRow({ name, to, badge, meta, value, index = 0 }: DomainRowProps) {
  const reduce = useLite()
  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, x: -14 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: '-20px' }}
      transition={{ duration: 0.4, delay: Math.min(index, 10) * 0.035, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link to={to} className="tile glass group flex items-center gap-3 rounded-xl px-4 py-3 sm:gap-5 sm:px-5">
        <div className="relative z-10 min-w-0 flex-1">
          <p className="display truncate text-base font-bold sm:text-lg" title={name}>
            <span className="transition-colors duration-300 group-hover:text-[var(--accent-hover)]">{name}</span>
          </p>
          {meta ? <p className="mono truncate text-xs text-[var(--subtle)]">{meta}</p> : null}
        </div>
        {value ? <p className="display num relative z-10 hidden shrink-0 text-sm font-bold sm:block sm:text-base">{value}</p> : null}
        <div className="relative z-10 flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
          {value ? <p className="display num text-sm font-bold sm:hidden">{value}</p> : null}
          {badge}
        </div>
        <ArrowUpRight size={16} aria-hidden="true" className="relative z-10 shrink-0 text-[var(--subtle)] transition duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--cyan)]" />
      </Link>
    </motion.li>
  )
}

import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ConnectKitButton } from 'connectkit'
import { Activity, Compass, Home, LayoutGrid, Menu, Settings2, Store, Wallet, X } from 'lucide-react'
import { useAccount, useDisconnect } from 'wagmi'
import clsx from 'clsx'
import { Link, useLocation } from '@/lib/router'
import { useNetwork } from '@/lib/network'
import { ARC_MAINNET_ID, ARC_TESTNET_ID } from '@/config'
import { useLite } from '@/hooks/useLite'
import { useUsdcBalance } from '@/hooks/useUsdc'
import { fmtUsdc } from '@/lib/format'
import { shortAddress } from '@/lib/protocol'
import { NetworkNotice } from './NetworkNotice'
import { CursorGlow, FloatingOrbs } from './fx/Ambient'
import { AnimatedText, Magnetic } from './fx/Motion'

export function Logo({ size = 30, animate = false }: { size?: number; animate?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="relative inline-flex" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id="domix-logo" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
              <stop stopColor="#3b82ff" />
              <stop offset="0.55" stopColor="#8b5cf6" />
              <stop offset="1" stopColor="#22d3ee" />
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="9" fill="url(#domix-logo)" />
          <path d="M9 8h7.5a8 8 0 0 1 0 16H9V8Zm4 3.8v8.4h3.3a4.2 4.2 0 0 0 0-8.4H13Z" fill="#02040b" />
        </svg>
        <span className="logo-orbit" aria-hidden="true" />
      </span>
      {animate ? (
        <AnimatedText text="DOMIX" gradient className="display text-xl font-extrabold tracking-tight" stagger={0.06} />
      ) : (
        <span className="display grad-text text-xl font-extrabold tracking-tight">DOMIX</span>
      )}
    </span>
  )
}

const NAV = [
  { to: '/', label: 'Dashboard', icon: Home },
  { to: '/explore', label: 'Explore', icon: Compass },
  { to: '/marketplace', label: 'Marketplace', icon: Store },
  { to: '/my-domains', label: 'My Domains', icon: LayoutGrid },
  { to: '/activity', label: 'Activity', icon: Activity },
]

function NetworkSwitch() {
  const { chainId, setChainId } = useNetwork()
  return (
    <div className="flex rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 text-xs font-medium" role="group" aria-label="Network">
      {[
        { id: ARC_MAINNET_ID, label: 'Mainnet' },
        { id: ARC_TESTNET_ID, label: 'Testnet' },
      ].map((n) => (
        <button
          key={n.id}
          onClick={() => setChainId(n.id)}
          aria-pressed={chainId === n.id}
          className={clsx(
            'min-h-9 rounded-lg px-3 transition-colors',
            chainId === n.id ? 'btn-grad' : 'text-[var(--muted)] hover:text-[var(--ink)]',
          )}
        >
          {n.label}
        </button>
      ))}
    </div>
  )
}

function WalletButton() {
  const { address } = useAccount()
  const { disconnect } = useDisconnect()
  const balance = useUsdcBalance()
  return (
    <ConnectKitButton.Custom>
      {({ isConnected, show }) =>
        isConnected && address ? (
          <div className="flex items-center gap-2">
            <button onClick={show} className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm hover:border-[var(--border-strong)]">
              <Wallet size={16} className="text-[var(--accent-hover)]" />
              <span className="num font-medium">{balance.data !== undefined ? `${fmtUsdc(balance.data)} USDC` : '…'}</span>
              <span className="mono hidden text-xs text-[var(--muted)] sm:inline">{shortAddress(address)}</span>
            </button>
            <button onClick={() => disconnect()} className="hidden min-h-11 rounded-xl px-3 text-xs text-[var(--muted)] hover:text-[var(--ink)] sm:block">
              Disconnect
            </button>
          </div>
        ) : (
          <Magnetic>
            <button onClick={show} className="btn-grad min-h-11 rounded-xl px-5 text-sm font-semibold">
              Connect Wallet
            </button>
          </Magnetic>
        )
      }
    </ConnectKitButton.Custom>
  )
}

export function Layout({ children, isAdmin }: { children: ReactNode; isAdmin: boolean }) {
  const { path } = useLocation()
  const { deployed, chainName, isMainnet } = useNetwork()
  const [open, setOpen] = useState(false)
  const reduce = useLite()
  const items = isAdmin ? [...NAV, { to: '/admin', label: 'Admin', icon: Settings2 }] : NAV
  const active = (to: string) => (to === '/' ? path === '/' : path.startsWith(to))

  return (
    <div className="relative min-h-dvh">
      <FloatingOrbs />
      <CursorGlow />
      <div className="relative z-20 border-b border-[var(--border)] bg-[rgba(2,4,11,0.85)] px-4 py-1.5 text-center text-[11px] text-[var(--subtle)]">
        <a href="https://studio.arc.io/" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-[var(--text)]">
          Built with Arc Studio
        </a>
      </div>
      <NetworkNotice />

      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[rgba(2,4,11,0.72)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-8">
            <Link to="/" aria-label="DOMIX home">
              <Logo animate />
            </Link>
            <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
              {items.map((n) => (
                <Link key={n.to} to={n.to} aria-current={active(n.to) ? 'page' : undefined} className="group relative rounded-xl px-3.5 py-2 text-sm font-medium">
                  {active(n.to) && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-strong)]"
                      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative block h-[1.25em] overflow-hidden leading-[1.25em]">
                    <span className={clsx('block transition-transform duration-300 group-hover:-translate-y-full', active(n.to) ? 'grad-text' : 'text-[var(--muted)]')}>{n.label}</span>
                    <span className="grad-text absolute left-0 top-full block transition-transform duration-300 group-hover:-translate-y-full" aria-hidden="true">
                      {n.label}
                    </span>
                  </span>
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:block">
              <NetworkSwitch />
            </div>
            <WalletButton />
            <button
              className="flex size-11 items-center justify-center rounded-xl border border-[var(--border)] lg:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label="Menu"
              aria-expanded={open}
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {open && (
            <motion.nav
              key="mobile-nav"
              className="border-t border-[var(--border)] px-4 py-3 lg:hidden"
              aria-label="Mobile"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: reduce ? 0 : 0.22 }}
            >
              <div className="mb-3 sm:hidden">
                <NetworkSwitch />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {items.map((n, i) => (
                  <motion.div key={n.to} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduce ? 0 : 0.04 * i, duration: reduce ? 0 : 0.25 }}>
                    <Link
                      to={n.to}
                      onClick={() => setOpen(false)}
                      className={clsx(
                        'flex min-h-12 items-center gap-2 rounded-xl border px-3 text-sm',
                        active(n.to) ? 'border-[var(--border-strong)] bg-[var(--surface-strong)]' : 'border-transparent bg-[var(--surface)] text-[var(--muted)]',
                      )}
                    >
                      <n.icon size={16} /> {n.label}
                    </Link>
                  </motion.div>
                ))}
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      {!deployed && (
        <div className="border-b border-[rgba(245,199,107,0.3)] bg-[rgba(245,199,107,0.08)] px-4 py-2.5 text-center text-sm text-[var(--warn)]">
          The DOMIX contract is not deployed on {chainName} yet. Domain search and registration work; listings, offers and auctions are disabled.
          {isMainnet ? ' Mainnet is deployed by you, outside Arc Studio (see README).' : ''}
        </div>
      )}

      <main className="relative z-10 mx-auto max-w-6xl px-4 pb-24 pt-8">{children}</main>

      <footer className="relative z-10 border-t border-[var(--border)] px-4 py-8 text-center text-xs text-[var(--subtle)]">
        DOMIX trades names from the ArcNS registry. Ownership, payment and settlement are enforced by contracts on {chainName}.
        <div className="mt-2">
          <Link to="/admin" className="underline-offset-2 hover:text-[var(--text)] hover:underline">Owner admin</Link>
        </div>
      </footer>
    </div>
  )
}

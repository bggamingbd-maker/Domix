import { useState } from 'react'
import { useAccount } from 'wagmi'
import clsx from 'clsx'
import { ActivityFeed } from '@/components/ActivityFeed'
import { AnimatedText } from '@/components/fx/Motion'
import { useNetwork } from '@/lib/network'

export function ActivityPage() {
  const { address } = useAccount()
  const { chainName } = useNetwork()
  const [scope, setScope] = useState<'all' | 'mine'>('all')
  return (
    <div className="space-y-6">
      <div>
        <AnimatedText as="h1" text="Activity" gradient className="display text-4xl font-extrabold" />
        <p className="mt-2 text-[var(--muted)]">Registrations, listings, sales, offers, auctions and transfers on {chainName}, indexed from contract events. Each row links to its transaction.</p>
      </div>
      <div className="flex gap-2" role="tablist">
        {(['all', 'mine'] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={scope === s}
            disabled={s === 'mine' && !address}
            onClick={() => setScope(s)}
            className={clsx(
              'min-h-11 rounded-xl px-5 text-sm font-medium disabled:opacity-40',
              scope === s ? 'bg-[var(--surface-strong)] text-[var(--ink)]' : 'text-[var(--muted)] hover:text-[var(--ink)]',
            )}
          >
            {s === 'all' ? 'Everyone' : 'My wallet'}
          </button>
        ))}
      </div>
      <ActivityFeed address={scope === 'mine' ? address : undefined} limit={60} />
    </div>
  )
}

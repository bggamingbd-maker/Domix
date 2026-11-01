import { Handshake, Search, Tag } from 'lucide-react'
import { Card } from '@/components/ui'
import { Link } from '@/lib/router'

/** First steps shown while the marketplace has no listings yet. */
export function GetStarted({ onList }: { onList: () => void }) {
  const steps = [
    {
      icon: Search,
      title: 'Register a name',
      body: 'Search a .arc or .circle name and register it with USDC.',
      action: (
        <Link to="/explore" className="btn-grad inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold">
          Find a name
        </Link>
      ),
    },
    {
      icon: Tag,
      title: 'List a name you own',
      body: 'Set a USDC price. Your name stays in your wallet until someone pays.',
      action: (
        <button onClick={onList} className="glass inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold">
          List a domain
        </button>
      ),
    },
    {
      icon: Handshake,
      title: 'Make the first offer',
      body: 'Offer on any name. Your USDC stays in your wallet until the owner accepts.',
      action: (
        <Link to="/marketplace" className="glass inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold">
          Browse marketplace
        </Link>
      ),
    },
  ]
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]">Nothing is listed for sale yet. Be the first:</p>
      <div className="grid gap-4 md:grid-cols-3">
        {steps.map((s) => (
          <Card key={s.title} className="flex h-full flex-col gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[rgba(99,102,241,0.2)] text-[var(--cyan)]">
              <s.icon size={18} aria-hidden="true" />
            </span>
            <div className="flex-1">
              <p className="display text-lg font-bold">{s.title}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{s.body}</p>
            </div>
            <div>{s.action}</div>
          </Card>
        ))}
      </div>
    </div>
  )
}

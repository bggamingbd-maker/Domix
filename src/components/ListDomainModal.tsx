import { useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useAccount } from 'wagmi'
import { ListPanel } from '@/components/actions/Trading'
import { useDomain } from '@/hooks/useDomain'
import { useOwned } from '@/hooks/useOwned'
import { fmtDate, fmtUsdc } from '@/lib/format'
import { useNetwork } from '@/lib/network'
import { parseDomainInput } from '@/lib/protocol'
import { Skeleton } from './fx/Ambient'
import { Badge, Button, EmptyState, Input, Modal } from './ui'

export interface ListTarget {
  label: string
  tld: 'arc' | 'circle'
}

function Selected({ target, onBack, onDone }: { target: ListTarget; onBack?: () => void; onDone: () => void }) {
  const q = useDomain(target.label, target.tld)
  return (
    <div className="space-y-4">
      {onBack && (
        <button onClick={onBack} className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
          <ArrowLeft size={16} /> Choose another domain
        </button>
      )}
      <div className="rounded-xl bg-[var(--surface)] p-4">
        <p className="label-caps">Domain</p>
        <p className="display text-2xl font-bold">
          {target.label}.{target.tld}
        </p>
      </div>
      {q.isLoading || !q.data ? <Skeleton className="h-40" /> : <ListPanel key={`${q.data.full}-${q.data.listing?.price ?? 'new'}`} info={q.data} onDone={onDone} />}
    </div>
  )
}

function Chooser({ onPick }: { onPick: (t: ListTarget) => void }) {
  const { address } = useAccount()
  const owned = useOwned(address)
  const [manual, setManual] = useState('')
  const parsed = manual.trim() ? parseDomainInput(manual) : null

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="label-caps">Your domains</p>
        {owned.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : !owned.data?.length ? (
          <EmptyState title="No domains found yet" body="Your registrations appear here once indexed. If you own a name that is not shown, enter it below and DOMIX will verify ownership onchain." />
        ) : (
          <ul className="space-y-2">
            {owned.data.map((d) => (
              <li key={`${d.collection}-${d.tokenId}`}>
                <button
                  disabled={!d.label || !d.tld}
                  onClick={() => d.label && d.tld && onPick({ label: d.label, tld: d.tld as 'arc' | 'circle' })}
                  className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-left transition-colors hover:border-[var(--border-strong)] disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="display block truncate text-base font-semibold">{d.label && d.tld ? `${d.label}.${d.tld}` : 'Name not indexed yet'}</span>
                    <span className="block text-xs text-[var(--subtle)]">{d.expires && d.expires > 0n ? `Expires ${fmtDate(d.expires)}` : 'No expiry'}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {d.listingPrice !== null ? <Badge tone="accent">Listed {fmtUsdc(d.listingPrice)} USDC</Badge> : <Badge>Not listed</Badge>}
                    <ChevronRight size={16} className="text-[var(--subtle)]" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-2">
        <p className="label-caps">Or enter a name you own</p>
        <div className="flex gap-2">
          <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="yourname.arc" spellCheck={false} autoCapitalize="none" />
          <Button variant="secondary" disabled={!parsed || typeof parsed === 'string'} onClick={() => parsed && typeof parsed !== 'string' && onPick({ label: parsed.label, tld: parsed.tld })}>
            Continue
          </Button>
        </div>
        {typeof parsed === 'string' && <p className="text-sm text-[var(--danger)]">{parsed}</p>}
      </div>
    </div>
  )
}

/** List a domain for sale: pick one you own (or type its name), set a USDC price, approve and list. */
export function ListDomainModal({ open, onClose, preset }: { open: boolean; onClose: () => void; preset?: ListTarget | null }) {
  const { address } = useAccount()
  const { deployed, chainName } = useNetwork()
  const [picked, setPicked] = useState<ListTarget | null>(null)
  const target = preset ?? picked
  const close = () => {
    setPicked(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={close} title="List a domain for sale">
      {!deployed ? (
        <EmptyState title={`DOMIX is not deployed on ${chainName}`} body="Switch to a network where the marketplace is live to list a domain." />
      ) : !address ? (
        <div className="space-y-4 text-center">
          <p className="text-sm text-[var(--muted)]">Connect the wallet that owns the domain you want to sell.</p>
          <ConnectKitButton.Custom>
            {({ show }) => (
              <Button onClick={show} className="w-full">
                Connect Wallet
              </Button>
            )}
          </ConnectKitButton.Custom>
        </div>
      ) : target ? (
        <Selected target={target} onBack={preset ? undefined : () => setPicked(null)} onDone={close} />
      ) : (
        <Chooser onPick={setPicked} />
      )}
    </Modal>
  )
}

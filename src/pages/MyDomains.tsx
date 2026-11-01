import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { type Address } from 'viem'
import { useAccount, usePublicClient, useSignMessage } from 'wagmi'
import { toast } from 'sonner'
import { ActivityFeed } from '@/components/ActivityFeed'
import { DomainCard } from '@/components/DomainCard'
import { AnimatedText } from '@/components/fx/Motion'
import { Badge, Button, Card, EmptyState, Modal, Spinner, Stat, TxBanner } from '@/components/ui'
import { domixAbi } from '@/contracts/abis'
import { SetWalletPanel } from '@/components/actions/Manage'
import { ListDomainModal } from '@/components/ListDomainModal'
import { useDomain } from '@/hooks/useDomain'
import { useOwned, type OwnedDomain } from '@/hooks/useOwned'
import { useOwnedCount } from '@/hooks/useOwnedCount'
import { useTx } from '@/hooks/useTx'
import { apiGet, apiPost, backendAvailable } from '@/lib/api'
import { fmtDate, fmtUsdc, relativeTime } from '@/lib/format'
import { useNetwork } from '@/lib/network'
import { getProtocol } from '@/lib/protocol'
import { Link } from '@/lib/router'

function Refunds({ address }: { address: Address }) {
  const { chainId, deployment } = useNetwork()
  const client = usePublicClient({ chainId })
  const tx = useTx()
  const pending = useQuery({
    queryKey: ['pending-returns', chainId, address, deployment.domix],
    enabled: Boolean(client && deployment.domix),
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!client || !deployment.domix) return 0n
      return client.readContract({ address: deployment.domix, abi: domixAbi, functionName: 'pendingReturns', args: [address] })
    },
  })
  if (!deployment.domix || !pending.data || pending.data === 0n) return null
  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 !border-[rgba(111,220,154,0.3)]">
      <div>
        <p className="label-caps">Auction funds ready to claim</p>
        <p className="display num text-2xl font-semibold">{fmtUsdc(pending.data)} USDC</p>
        <p className="text-xs text-[var(--subtle)]">Refunds and sale proceeds that could not be sent automatically.</p>
      </div>
      <Button onClick={() => deployment.domix && tx.run('Claim auction funds', { to: deployment.domix, abi: domixAbi, functionName: 'withdrawRefund' })} disabled={tx.busy} loading={tx.busy}>
        Claim
      </Button>
      <div className="w-full">
        <TxBanner state={tx.state} />
      </div>
    </Card>
  )
}

interface NotificationRow {
  id: string
  kind: string
  title: string
  body: string
  tx_hash: string
  created_at: string
  read: boolean
}

function Notifications({ address }: { address: Address }) {
  const { chainId } = useNetwork()
  const qc = useQueryClient()
  const { signMessageAsync } = useSignMessage()
  const list = useQuery({
    queryKey: ['notifications', chainId, address],
    refetchInterval: 20_000,
    queryFn: () => apiGet<{ notifications: NotificationRow[] }>(`/notifications/${address}`, { chainId }),
  })
  const unread = (list.data?.notifications ?? []).filter((n) => !n.read).length

  const markRead = async () => {
    try {
      const { nonce } = await apiGet<{ nonce: string }>('/auth/nonce', { address })
      const message = `DOMIX mark notifications read\nAddress: ${address}\nNonce: ${nonce}`
      const signature = await signMessageAsync({ message })
      await apiPost('/notifications/read', { address, message, signature })
      await qc.invalidateQueries({ queryKey: ['notifications'] })
    } catch (error) {
      const msg = (error as { shortMessage?: string }).shortMessage ?? ''
      if (!/rejected|denied/i.test(msg)) toast.error('Could not mark notifications as read.')
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="label-caps flex items-center gap-2">
          <Bell size={14} /> Notifications {unread > 0 && <Badge tone="accent">{unread} new</Badge>}
        </p>
        {unread > 0 && (
          <Button variant="ghost" onClick={markRead}>
            Mark read
          </Button>
        )}
      </div>
      {list.isLoading ? (
        <Spinner />
      ) : !list.data?.notifications.length ? (
        <p className="text-sm text-[var(--muted)]">Sales, offers, bids and auction results appear here.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {list.data.notifications.slice(0, 8).map((n) => (
            <li key={n.id} className="py-2.5">
              <p className={n.read ? 'text-sm text-[var(--muted)]' : 'text-sm font-medium'}>{n.title}</p>
              <p className="text-xs text-[var(--subtle)]">
                {n.body} · {relativeTime(Number(n.created_at))}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function WalletModal({ domain, onClose }: { domain: OwnedDomain | null; onClose: () => void }) {
  const q = useDomain(domain?.label ?? undefined, (domain?.tld as 'arc' | 'circle' | null) ?? undefined)
  return (
    <Modal open={domain !== null} onClose={onClose} title={domain?.label ? `Link ${domain.label}.${domain.tld} to a wallet` : 'Link to a wallet'}>
      {q.isLoading || !q.data ? <Spinner label="Reading the registry" /> : <SetWalletPanel key={q.data.full} info={q.data} />}
    </Modal>
  )
}

export function MyDomainsPage() {
  const [walletFor, setWalletFor] = useState<OwnedDomain | null>(null)
  const [listFor, setListFor] = useState<OwnedDomain | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const { address } = useAccount()
  const { chainName, deployed } = useNetwork()
  const owned = useOwned(address)
  const heldCount = useOwnedCount(backendAvailable ? undefined : address)
  const protocol = getProtocol(useNetwork().chainId)

  if (!address) return <EmptyState title="Connect your wallet" body={`Connect a wallet on ${chainName} to see the domains you own.`} />

  const domains = owned.data ?? []
  const listed = domains.filter((d) => d.listingPrice !== null)
  const valued = domains.reduce((sum, d) => sum + (d.listingPrice ?? d.topOffer ?? 0n), 0n)
  const unpriced = domains.filter((d) => d.listingPrice === null && d.topOffer === null).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <AnimatedText as="h1" text="My Domains" gradient className="display text-4xl font-extrabold" />
          <p className="mt-2 text-[var(--muted)]">Ownership shown here is confirmed against the registry contract, not the index.</p>
        </div>
        <Button onClick={() => setListOpen(true)}>List a domain</Button>
      </div>
      {!backendAvailable && (
        <p className="glass rounded-2xl p-4 text-sm text-[var(--muted)]">
          {heldCount.data !== undefined ? `Your wallet holds ${heldCount.data} ArcNS ${heldCount.data === 1 ? 'name' : 'names'}. ` : ''}
          This version has no indexer, so only names found through DOMIX activity and the featured list are shown below. Open any other name from Explore to manage it.
        </p>
      )}
      <Refunds address={address} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Domains owned" value={owned.isLoading ? '…' : domains.length} />
        <Stat label="Listed for sale" value={owned.isLoading ? '…' : deployed ? listed.length : 'n/a'} />
        <Stat
          label="Portfolio value"
          value={owned.isLoading ? '…' : `${fmtUsdc(valued)} USDC`}
          sub={unpriced > 0 ? `Based on listings and open offers. ${unpriced} without a price.` : 'Based on listings and open offers.'}
        />
      </div>

      {owned.isLoading ? (
        <Spinner label="Reading your domains" />
      ) : owned.isError ? (
        <EmptyState title="Could not load your domains" body="The indexer could not be reached. You can still open any domain you own from Explore." />
      ) : domains.length === 0 ? (
        <EmptyState
          title="No domains yet"
          body={`You do not own any ${protocol?.tlds.map((t) => `.${t.tld}`).join(' or ')} names on this network.`}
          action={
            <Link to="/explore" className="inline-flex min-h-11 items-center rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--accent-ink)]">
              Find a domain
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {domains.map((d, i) => (
            <div key={`${d.collection}-${d.tokenId}`} className="flex flex-col gap-2">
            <DomainCard
              index={i}
              label={d.label}
              tld={d.tld}
              tokenId={d.tokenId}
              price={d.listingPrice ?? undefined}
              priceLabel="Listed at"
              expires={d.expires}
              badge={d.listingPrice !== null ? <Badge tone="accent">Listed</Badge> : d.topOffer !== null ? <Badge tone="good">Offer {fmtUsdc(d.topOffer)} USDC</Badge> : <Badge>Not listed</Badge>}
              footer={d.expires && d.expires > 0n ? <p className="text-xs text-[var(--subtle)]">Renews by {fmtDate(d.expires)}</p> : undefined}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => setListFor(d)} disabled={!d.label || !d.tld}>
                {d.listingPrice !== null ? 'Edit listing' : 'List for sale'}
              </Button>
              <Button variant="secondary" onClick={() => setWalletFor(d)} disabled={!d.label || !d.tld}>
                Set wallet
              </Button>
            </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <h2 className="display mb-3 text-xl font-semibold">My activity</h2>
          <ActivityFeed address={address} limit={20} empty="No activity for this wallet yet." />
        </div>
        <Notifications address={address} />
      </div>
      <WalletModal domain={walletFor} onClose={() => setWalletFor(null)} />
      <ListDomainModal
        open={listOpen || listFor !== null}
        preset={listFor?.label && listFor.tld ? { label: listFor.label, tld: listFor.tld as 'arc' | 'circle' } : null}
        onClose={() => {
          setListFor(null)
          setListOpen(false)
        }}
      />
    </div>
  )
}

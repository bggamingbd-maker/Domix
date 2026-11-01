import { useState } from 'react'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { useAccount } from 'wagmi'
import { ActivityFeed } from '@/components/ActivityFeed'
import { AuctionPanel, OffersList } from '@/components/actions/Auctions'
import { IdentityPanel, ReclaimNotice, SetWalletPanel, TransferPanel, useProfileRecords } from '@/components/actions/Manage'
import { RegisterPanel, RenewPanel } from '@/components/actions/Registration'
import { BuyPanel, ListPanel, OfferPanel } from '@/components/actions/Trading'
import { Badge, Button, Card, Modal, Spinner } from '@/components/ui'
import { isExpired, useDomain, type DomainInfo } from '@/hooks/useDomain'
import { fmtDate } from '@/lib/format'
import { useNetwork } from '@/lib/network'
import { parseDomainInput, shortAddress } from '@/lib/protocol'
import { Link } from '@/lib/router'
import { buildAddressExplorerUrl } from '@/onchain-facts'

type PanelKey = 'list' | 'auction' | 'transfer' | 'renew' | 'identity' | 'wallet'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-sm text-[var(--muted)]">{label}</dt>
      <dd className="text-right text-sm">{children}</dd>
    </div>
  )
}

function AddressLink({ address, chainId }: { address: string; chainId: number }) {
  return (
    <a href={buildAddressExplorerUrl(chainId, address)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 hover:underline">
      {shortAddress(address)} <ExternalLink size={12} />
    </a>
  )
}

function PublicProfile({ info }: { info: DomainInfo }) {
  const records = useProfileRecords(info)
  const r = records.data ?? {}
  const entries = Object.entries(r).filter(([, v]) => v)
  if (entries.length === 0) return null
  return (
    <Card className="space-y-2">
      <p className="label-caps">Public profile</p>
      {r.display && <p className="display text-lg font-semibold">{r.display}</p>}
      {r.description && <p className="text-sm text-[var(--muted)]">{r.description}</p>}
      <dl className="divide-y divide-[var(--border)]">
        {entries
          .filter(([k]) => k !== 'display' && k !== 'description')
          .map(([k, v]) => (
            <Row key={k} label={k}>
              {k === 'url' && /^https?:\/\//.test(v) ? (
                <a href={v} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-hover)] hover:underline">
                  {v}
                </a>
              ) : (
                <span className="break-all">{v}</span>
              )}
            </Row>
          ))}
      </dl>
    </Card>
  )
}

export function DomainPage({ name }: { name: string }) {
  const parsed = parseDomainInput(name)
  const valid = typeof parsed !== 'string'
  const { address } = useAccount()
  const { chainId, deployed } = useNetwork()
  const query = useDomain(valid ? parsed.label : undefined, valid ? parsed.tld : undefined)
  const [panel, setPanel] = useState<PanelKey | null>(null)
  const info = query.data

  if (!valid) return <Card>{parsed}</Card>
  if (query.isLoading) return <Spinner label={`Checking ${parsed.full} onchain`} />
  if (query.isError || !info) return <Card>Could not read {parsed.full} from the chain. Check your connection and retry.</Card>

  const me = address?.toLowerCase()
  const isOwner = Boolean(me && info.owner?.toLowerCase() === me)
  const expired = isExpired(info)
  const listed = info.listing?.valid ? info.listing : undefined

  return (
    <div className="space-y-6">
      <Link to="/explore" className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
        <ArrowLeft size={16} /> Back to Explore
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display break-all text-4xl font-bold sm:text-5xl">{info.full}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            {info.available ? <Badge tone="good">Available to register</Badge> : <Badge tone="neutral">Registered</Badge>}
            {listed && <Badge tone="accent">Listed for sale</Badge>}
            {isOwner && <Badge tone="good">You own this</Badge>}
            {expired && !info.available && <Badge tone="warn">Expired, in grace period</Badge>}
          </div>
        </div>
        {isOwner && (
          <div className="flex flex-wrap gap-2">
            {deployed && <Button onClick={() => setPanel('list')}>{listed ? 'Edit listing' : 'List for sale'}</Button>}
            {deployed && (
              <Button variant="secondary" onClick={() => setPanel('auction')}>
                Auction
              </Button>
            )}
            <Button variant="secondary" onClick={() => setPanel('renew')}>
              Renew
            </Button>
            <Button variant="secondary" onClick={() => setPanel('transfer')}>
              Transfer
            </Button>
            <Button variant="secondary" onClick={() => setPanel('wallet')}>
              Set wallet address
            </Button>
            <Button variant="secondary" onClick={() => setPanel('identity')}>
              Identity
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <p className="label-caps mb-1">Onchain details</p>
            <dl className="divide-y divide-[var(--border)]">
              <Row label="Owner (ERC-721)">{info.owner ? <AddressLink address={info.owner} chainId={chainId} /> : 'None'}</Row>
              <Row label="Registry controller">{info.registryOwner ? <AddressLink address={info.registryOwner} chainId={chainId} /> : 'None'}</Row>
              <Row label="Expires">{info.expires && info.expires > 0n ? fmtDate(info.expires) : 'n/a'}</Row>
              <Row label="Resolves to">{info.resolvedAddr ? <AddressLink address={info.resolvedAddr} chainId={chainId} /> : 'No wallet address set'}</Row>
              <Row label="Registry">
                <AddressLink address={info.collection} chainId={chainId} />
              </Row>
              <Row label="Token ID">
                <span className="mono break-all text-xs">{info.tokenId.toString()}</span>
              </Row>
            </dl>
          </Card>
          {info.owner && <ReclaimNotice info={info} />}
          {info.owner && <PublicProfile info={info} />}
          {info.owner && deployed && <OffersList info={info} />}
          <div>
            <h2 className="display mb-3 text-xl font-semibold">History</h2>
            <ActivityFeed tokenId={info.tokenId} collection={info.collection} limit={20} empty="No indexed activity for this name yet." />
          </div>
        </div>

        <div className="space-y-6">
          {info.available && <RegisterPanel key={`${address}-${info.full}`} info={info} />}
          {!info.available && !isOwner && deployed && (
            <>
              {listed && <BuyPanel info={info} />}
              <AuctionPanel info={info} inline />
              {info.owner && <OfferPanel info={info} />}
            </>
          )}
          {!info.available && !isOwner && !deployed && (
            <Card>
              <p className="text-sm text-[var(--muted)]">Buying, offers and auctions need the DOMIX contract on this network.</p>
            </Card>
          )}
          {isOwner && deployed && <AuctionPanel info={info} inline />}
          {isOwner && listed && <BuyPanelOwnerNote />}
        </div>
      </div>

      <Modal open={panel === 'list'} onClose={() => setPanel(null)} title={listed ? 'Edit listing' : `List ${info.full}`}>
        <ListPanel info={info} onDone={() => setPanel(null)} />
      </Modal>
      <Modal open={panel === 'auction'} onClose={() => setPanel(null)} title="Auction">
        <AuctionPanel info={info} />
      </Modal>
      <Modal open={panel === 'transfer'} onClose={() => setPanel(null)} title="Transfer ownership">
        <TransferPanel info={info} />
      </Modal>
      <Modal open={panel === 'renew'} onClose={() => setPanel(null)} title={`Renew ${info.full}`}>
        <RenewPanel info={info} />
      </Modal>
      <Modal open={panel === 'wallet'} onClose={() => setPanel(null)} title={`Link ${info.full} to a wallet`}>
        <SetWalletPanel info={info} />
      </Modal>
      <Modal open={panel === 'identity'} onClose={() => setPanel(null)} title="Web3 identity">
        <IdentityPanel info={info} />
      </Modal>
    </div>
  )
}

function BuyPanelOwnerNote() {
  return (
    <Card>
      <p className="text-sm text-[var(--muted)]">Your listing is live. Your domain stays in your wallet until a buyer pays your price.</p>
    </Card>
  )
}

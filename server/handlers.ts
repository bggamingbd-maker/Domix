import { ARCNS } from '../src/lib/protocol'
import { sql } from './db'

export interface IndexedEvent {
  chainId: number
  blockNumber: bigint
  blockTime: bigint
  txHash: string
  logIndex: number
  contract: string
  source: string
  name: string
  args: Record<string, unknown>
}

const ZERO = '0x0000000000000000000000000000000000000000'
const lower = (v: unknown): string => String(v).toLowerCase()
const str = (v: unknown): string => (typeof v === 'bigint' ? v.toString() : String(v))
const usdc = (v: unknown): string => (Number(BigInt(str(v))) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })

async function notify(ev: IndexedEvent, address: string, kind: string, title: string, body: string) {
  if (!address || lower(address) === ZERO) return
  await sql`
    INSERT INTO notifications (chain_id, address, kind, title, body, tx_hash, log_index)
    VALUES (${ev.chainId}, ${lower(address)}, ${kind}, ${title}, ${body}, ${ev.txHash}, ${ev.logIndex})
    ON CONFLICT DO NOTHING`
}

async function labelOf(chainId: number, collection: string, tokenId: string): Promise<string> {
  const rows = await sql`
    SELECT label FROM domains WHERE chain_id = ${chainId} AND collection = ${collection} AND token_id = ${tokenId}::numeric`
  return rows[0]?.label ? String(rows[0].label) : `token ${tokenId.slice(0, 8)}…`
}

async function ownerOfDomain(chainId: number, collection: string, tokenId: string): Promise<string | undefined> {
  const rows = await sql`
    SELECT owner FROM domains WHERE chain_id = ${chainId} AND collection = ${collection} AND token_id = ${tokenId}::numeric`
  return rows[0]?.owner as string | undefined
}

/** The one DOMIX contract emits marketplace, offer and auction events; route each to its handler. */
function domixGroup(name: string): 'marketplace' | 'offers' | 'auction' | undefined {
  if (name.startsWith('Offer')) return 'offers'
  if (name.startsWith('Auction') || name === 'BidPlaced' || name === 'UndeliveredClaimed') return 'auction'
  if (name === 'Listed' || name === 'ListingUpdated' || name === 'ListingCancelled' || name === 'Sold') return 'marketplace'
  return undefined
}

export async function applyEvent(ev: IndexedEvent): Promise<void> {
  const a = ev.args
  const block = ev.blockNumber.toString()
  const group = ev.source === 'domix' ? domixGroup(ev.name) : ev.source
  switch (group) {
    case 'registrar':
      return applyRegistrar(ev)
    case 'controller':
      return applyController(ev)
    case 'marketplace': {
      switch (ev.name) {
        case 'Listed':
        case 'ListingUpdated': {
          const collection = lower(a.collection)
          const tokenId = str(a.tokenId)
          await sql`
            INSERT INTO listings (chain_id, collection, token_id, seller, price, expires_at, status, listed_block, updated_block)
            VALUES (${ev.chainId}, ${collection}, ${tokenId}::numeric, ${lower(a.seller)}, ${str(a.price)}::numeric,
                    ${str(a.expiresAt)}::numeric, 'active', ${block}, ${block})
            ON CONFLICT (chain_id, collection, token_id) DO UPDATE SET
              seller = EXCLUDED.seller, price = EXCLUDED.price, expires_at = EXCLUDED.expires_at,
              status = 'active', updated_block = EXCLUDED.updated_block
            WHERE listings.updated_block <= EXCLUDED.updated_block`
          return
        }
        case 'ListingCancelled':
        case 'ExternalSaleRecorded': {
          await sql`
            UPDATE listings SET status = 'cancelled', updated_block = ${block}
            WHERE chain_id = ${ev.chainId} AND collection = ${lower(a.collection)} AND token_id = ${str(a.tokenId)}::numeric
              AND status = 'active' AND updated_block <= ${block}`
          return
        }
        case 'Sold': {
          const collection = lower(a.collection)
          const tokenId = str(a.tokenId)
          await sql`
            UPDATE listings SET status = 'sold', updated_block = ${block}
            WHERE chain_id = ${ev.chainId} AND collection = ${collection} AND token_id = ${tokenId}::numeric
              AND updated_block <= ${block}`
          const label = await labelOf(ev.chainId, collection, tokenId)
          await notify(ev, lower(a.seller), 'sale', 'Domain sold', `${label} sold for ${usdc(a.price)} USDC.`)
          await notify(ev, lower(a.buyer), 'purchase', 'Purchase complete', `You now own ${label}.`)
          return
        }
        default:
          return
      }
    }
    case 'offers': {
      switch (ev.name) {
        case 'OfferMade': {
          const collection = lower(a.collection)
          const tokenId = str(a.tokenId)
          await sql`
            INSERT INTO offers (chain_id, id, offerer, collection, token_id, price, expires_at, status, updated_block)
            VALUES (${ev.chainId}, ${str(a.id)}::numeric, ${lower(a.offerer)}, ${collection}, ${tokenId}::numeric,
                    ${str(a.price)}::numeric, ${str(a.expiresAt)}::numeric, 'active', ${block})
            ON CONFLICT (chain_id, id) DO NOTHING`
          const owner = await ownerOfDomain(ev.chainId, collection, tokenId)
          if (owner) {
            const label = await labelOf(ev.chainId, collection, tokenId)
            await notify(ev, owner, 'offer', 'New offer', `${usdc(a.price)} USDC offered for ${label}.`)
          }
          return
        }
        case 'OfferAccepted':
        case 'OfferRejected':
        case 'OfferCancelled': {
          const next = ev.name === 'OfferAccepted' ? 'accepted' : ev.name === 'OfferRejected' ? 'rejected' : 'cancelled'
          await sql`
            UPDATE offers SET status = ${next}, updated_block = ${block}
            WHERE chain_id = ${ev.chainId} AND id = ${str(a.id)}::numeric`
          if (next !== 'cancelled') {
            const rows = await sql`SELECT offerer FROM offers WHERE chain_id = ${ev.chainId} AND id = ${str(a.id)}::numeric`
            if (rows[0]) {
              await notify(ev, rows[0].offerer as string, `offer_${next}`, `Offer ${next}`, `Your offer #${str(a.id)} was ${next}.`)
            }
          }
          return
        }
        default:
          return
      }
    }
    case 'auction': {
      switch (ev.name) {
        case 'AuctionCreated': {
          await sql`
            INSERT INTO auctions (chain_id, id, collection, token_id, seller, start_price, min_increment, end_time, hard_end, status, updated_block)
            VALUES (${ev.chainId}, ${str(a.id)}::numeric, ${lower(a.collection)}, ${str(a.tokenId)}::numeric, ${lower(a.seller)},
                    ${str(a.startPrice)}::numeric, ${str(a.minIncrement)}::numeric, ${str(a.endTime)}::numeric,
                    ${str(a.hardEnd)}::numeric, 'active', ${block})
            ON CONFLICT (chain_id, id) DO NOTHING`
          return
        }
        case 'BidPlaced': {
          const rows = await sql`
            SELECT seller, highest_bidder, collection, token_id::text AS token_id FROM auctions
            WHERE chain_id = ${ev.chainId} AND id = ${str(a.id)}::numeric`
          await sql`
            UPDATE auctions SET highest_bid = ${str(a.amount)}::numeric, highest_bidder = ${lower(a.bidder)}, updated_block = ${block}
            WHERE chain_id = ${ev.chainId} AND id = ${str(a.id)}::numeric AND updated_block <= ${block}`
          const row = rows[0]
          if (row) {
            const label = await labelOf(ev.chainId, row.collection as string, row.token_id as string)
            await notify(ev, row.seller as string, 'bid', 'New bid', `${usdc(a.amount)} USDC bid on ${label}.`)
            const prev = row.highest_bidder as string | null
            if (prev && prev !== lower(a.bidder)) {
              await notify(ev, prev, 'outbid', 'You were outbid', `Someone bid ${usdc(a.amount)} USDC on ${label}. Your bid was refunded.`)
            }
          }
          return
        }
        case 'AuctionExtended':
          await sql`
            UPDATE auctions SET end_time = ${str(a.endTime)}::numeric, updated_block = ${block}
            WHERE chain_id = ${ev.chainId} AND id = ${str(a.id)}::numeric`
          return
        case 'AuctionSettled':
        case 'AuctionCancelled':
        case 'AuctionFailed':
        case 'UndeliveredClaimed': {
          const next =
            ev.name === 'AuctionSettled' ? 'settled' : ev.name === 'AuctionCancelled' ? 'cancelled' : ev.name === 'AuctionFailed' ? 'failed' : 'claimed'
          await sql`
            UPDATE auctions SET status = ${next}, updated_block = ${block}
            WHERE chain_id = ${ev.chainId} AND id = ${str(a.id)}::numeric`
          if (ev.name === 'AuctionSettled') {
            await notify(ev, lower(a.winner), 'auction_won', 'Auction won', `You won auction #${str(a.id)} for ${usdc(a.price)} USDC.`)
            await notify(ev, lower(a.seller), 'auction_sold', 'Auction settled', `Auction #${str(a.id)} sold for ${usdc(a.price)} USDC.`)
          }
          if (ev.name === 'AuctionFailed') {
            await notify(ev, lower(a.winner), 'auction_failed', 'Auction could not deliver', `Auction #${str(a.id)} failed delivery. Your bid was refunded.`)
          }
          return
        }
        default:
          return
      }
    }
    default:
      return
  }
}

function collectionForController(chainId: number, controller: string): string | undefined {
  return ARCNS[chainId]?.tlds.find((t) => t.controller.toLowerCase() === controller)?.registrar.toLowerCase()
}

async function applyController(ev: IndexedEvent): Promise<void> {
  const collection = collectionForController(ev.chainId, ev.contract)
  if (!collection) return
  const a = ev.args
  const tokenId = BigInt(String(a.label)).toString()
  const block = ev.blockNumber.toString()
  if (ev.name === 'NameRegistered') {
    await sql`
      INSERT INTO domains (chain_id, collection, token_id, label, owner, expires, updated_block)
      VALUES (${ev.chainId}, ${collection}, ${tokenId}::numeric, ${String(a.name)}, ${lower(a.owner)}, ${str(a.expires)}::numeric, ${block})
      ON CONFLICT (chain_id, collection, token_id) DO UPDATE SET label = EXCLUDED.label, expires = EXCLUDED.expires`
  } else if (ev.name === 'NameRenewed') {
    await sql`
      INSERT INTO domains (chain_id, collection, token_id, label, owner, expires, updated_block)
      VALUES (${ev.chainId}, ${collection}, ${tokenId}::numeric, ${String(a.name)}, ${ZERO}, ${str(a.expires)}::numeric, 0)
      ON CONFLICT (chain_id, collection, token_id) DO UPDATE SET label = EXCLUDED.label, expires = EXCLUDED.expires`
  }
}

async function applyRegistrar(ev: IndexedEvent): Promise<void> {
  if (ev.name !== 'Transfer') return
  const a = ev.args
  if (a.tokenId === undefined) return
  const collection = ev.contract
  const tokenId = str(a.tokenId)
  const block = ev.blockNumber.toString()
  const to = lower(a.to)
  await sql`
    INSERT INTO domains (chain_id, collection, token_id, owner, updated_block)
    VALUES (${ev.chainId}, ${collection}, ${tokenId}::numeric, ${to}, ${block})
    ON CONFLICT (chain_id, collection, token_id) DO UPDATE SET owner = EXCLUDED.owner, updated_block = EXCLUDED.updated_block
    WHERE domains.updated_block <= EXCLUDED.updated_block`
}

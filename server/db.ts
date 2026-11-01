import { SQL } from 'bun'
import { databaseUrl } from './config'

export const sql = new SQL(databaseUrl())

/**
 * Schema. Chain state (ownership, payments, settlement) is NEVER authoritative
 * here: these tables are an index over contract events plus off-chain profile
 * data. The frontend re-verifies every listing, auction and owner onchain.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_state (
  chain_id integer NOT NULL,
  key text NOT NULL,
  value numeric NOT NULL,
  PRIMARY KEY (chain_id, key)
);

CREATE TABLE IF NOT EXISTS events (
  chain_id integer NOT NULL,
  block_number bigint NOT NULL,
  block_time bigint NOT NULL,
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  contract text NOT NULL,
  source text NOT NULL,
  name text NOT NULL,
  args jsonb NOT NULL,
  actors text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (chain_id, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS events_actors_idx ON events USING gin (actors);
CREATE INDEX IF NOT EXISTS events_block_idx ON events (chain_id, block_number DESC, log_index DESC);

CREATE TABLE IF NOT EXISTS domains (
  chain_id integer NOT NULL,
  collection text NOT NULL,
  token_id numeric NOT NULL,
  label text,
  owner text NOT NULL,
  expires numeric,
  updated_block bigint NOT NULL,
  PRIMARY KEY (chain_id, collection, token_id)
);
CREATE INDEX IF NOT EXISTS domains_owner_idx ON domains (chain_id, owner);
CREATE INDEX IF NOT EXISTS domains_label_idx ON domains (chain_id, label);

CREATE TABLE IF NOT EXISTS listings (
  chain_id integer NOT NULL,
  collection text NOT NULL,
  token_id numeric NOT NULL,
  seller text NOT NULL,
  price numeric NOT NULL,
  expires_at numeric NOT NULL,
  status text NOT NULL,
  listed_block bigint NOT NULL,
  updated_block bigint NOT NULL,
  PRIMARY KEY (chain_id, collection, token_id)
);
CREATE INDEX IF NOT EXISTS listings_status_idx ON listings (chain_id, status, price);

CREATE TABLE IF NOT EXISTS offers (
  chain_id integer NOT NULL,
  id numeric NOT NULL,
  offerer text NOT NULL,
  collection text NOT NULL,
  token_id numeric NOT NULL,
  price numeric NOT NULL,
  expires_at numeric NOT NULL,
  status text NOT NULL,
  updated_block bigint NOT NULL,
  PRIMARY KEY (chain_id, id)
);
CREATE INDEX IF NOT EXISTS offers_token_idx ON offers (chain_id, collection, token_id);
CREATE INDEX IF NOT EXISTS offers_offerer_idx ON offers (chain_id, offerer);

CREATE TABLE IF NOT EXISTS auctions (
  chain_id integer NOT NULL,
  id numeric NOT NULL,
  collection text NOT NULL,
  token_id numeric NOT NULL,
  seller text NOT NULL,
  start_price numeric NOT NULL,
  min_increment numeric NOT NULL,
  highest_bid numeric NOT NULL DEFAULT 0,
  highest_bidder text,
  end_time numeric NOT NULL,
  hard_end numeric NOT NULL,
  status text NOT NULL,
  updated_block bigint NOT NULL,
  PRIMARY KEY (chain_id, id)
);
CREATE INDEX IF NOT EXISTS auctions_status_idx ON auctions (chain_id, status, end_time);

CREATE TABLE IF NOT EXISTS profiles (
  address text PRIMARY KEY,
  display_name text,
  bio text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  nonce text
);

CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY,
  chain_id integer NOT NULL,
  address text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read boolean NOT NULL DEFAULT false,
  UNIQUE (chain_id, tx_hash, log_index, address, kind)
);
CREATE INDEX IF NOT EXISTS notifications_addr_idx ON notifications (address, read, id DESC);

CREATE TABLE IF NOT EXISTS auth_nonces (
  address text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (address, nonce)
);
`

export async function migrate(): Promise<void> {
  await sql.unsafe(SCHEMA)
}

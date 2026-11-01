import { isAddress, verifyMessage, type Address } from 'viem'
import { clientFor, domixFor } from './config'
import { domixAbi } from '../src/contracts/abis'
import { sql } from './db'

const NONCE_TTL_MS = 5 * 60 * 1000

export async function issueNonce(address: string): Promise<{ nonce: string; expiresAt: number }> {
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const expiresAt = Date.now() + NONCE_TTL_MS
  await sql`DELETE FROM auth_nonces WHERE expires_at < now()`
  await sql`INSERT INTO auth_nonces (address, nonce, expires_at) VALUES (${address.toLowerCase()}, ${nonce}, ${new Date(expiresAt)})`
  return { nonce, expiresAt }
}

export interface SignedRequest {
  address: string
  message: string
  signature: `0x${string}`
}

/**
 * Verifies a personal_sign message. The message must contain `Nonce: <nonce>` for a nonce
 * issued to this address and not yet used. Nonces are single-use. EOA signatures only.
 */
export async function verifySigned(req: SignedRequest, purpose: string): Promise<Address> {
  if (!isAddress(req.address)) throw new HttpError(400, 'Invalid address')
  if (!req.message.startsWith(`DOMIX ${purpose}`)) throw new HttpError(400, 'Unexpected message')
  const match = /Nonce: ([0-9a-f]{32})/.exec(req.message)
  if (!match) throw new HttpError(400, 'Missing nonce')
  const valid = await verifyMessage({ address: req.address, message: req.message, signature: req.signature })
  if (!valid) throw new HttpError(401, 'Signature does not match address')
  const deleted = await sql`
    DELETE FROM auth_nonces WHERE address = ${req.address.toLowerCase()} AND nonce = ${match[1]} AND expires_at > now()
    RETURNING nonce`
  if (deleted.length === 0) throw new HttpError(401, 'Nonce expired or already used')
  return req.address as Address
}

/** Admin authorization follows the DOMIX owner onchain; the backend never keeps its own admin list. */
export async function requireMarketplaceOwner(chainId: number, signer: Address): Promise<void> {
  const d = domixFor(chainId)
  if (!d.domix) throw new HttpError(404, 'DOMIX is not deployed on this chain')
  const owner = await clientFor(chainId).readContract({
    address: d.domix,
    abi: domixAbi,
    functionName: 'owner',
  })
  if (owner.toLowerCase() !== signer.toLowerCase()) throw new HttpError(403, 'Only the DOMIX owner can do this')
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * smoke-test — exercises the deployed DOMIX contract on Arc Testnet with real transactions.
 * Registers a fresh ArcNS name, then lists, buys, offers, auctions (create and cancel) and writes profile records.
 * Uses DEPLOYER_PRIVATE_KEY (needs testnet USDC) and a throwaway buyer wallet it funds itself.
 *   bun run smoke
 */
import { createPublicClient, createWalletClient, erc20Abi, http, toHex, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { domixAbi } from '../src/contracts/abis'
import deployments from '../src/deployments.json'
import { controllerAbi, labelToTokenId, registrarAbi, ARCNS } from '../src/lib/protocol'
import { getChain, getUsdc } from '../src/onchain-facts'

const CHAIN = 5042002
const d = (deployments as unknown as Record<string, { domix: Address }>)[String(CHAIN)]
if (!d?.domix) throw new Error('DOMIX is not deployed on Arc Testnet. Run bun run deploy:contracts first.')
const proto = ARCNS[CHAIN]
const arc = proto.tlds[0]
const usdc = getUsdc(CHAIN)!.address as Address
const rpc = getChain(CHAIN)!.rpcUrls[0]
const key = process.env.DEPLOYER_PRIVATE_KEY as Hex
if (!key) throw new Error('DEPLOYER_PRIVATE_KEY missing')

const pub = createPublicClient({ chain: arcTestnet, transport: http(rpc) })
const seller = privateKeyToAccount(key)
const buyer = privateKeyToAccount(generatePrivateKey())
const sw = createWalletClient({ account: seller, chain: arcTestnet, transport: http(rpc) })
const bw = createWalletClient({ account: buyer, chain: arcTestnet, transport: http(rpc) })

let failures = 0
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`)
}

type Wallet = typeof sw
async function tx(w: Wallet, to: Address, abi: readonly unknown[], functionName: string, args: unknown[] = []) {
  const data = (await import('viem')).encodeFunctionData({ abi, functionName, args } as never)
  const hash = await w.sendTransaction({ to, data })
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`${functionName} reverted (${hash})`)
  return hash
}
const bal = (a: Address) => pub.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [a] })
const ownerOf = (id: bigint) => pub.readContract({ address: arc.registrar, abi: registrarAbi, functionName: 'ownerOf', args: [id] })

const label = `domix${Date.now().toString(36)}`
const id = labelToTokenId(label)
const treasury = await pub.readContract({ address: d.domix, abi: domixAbi, functionName: 'treasury' })
console.log(`Seller ${seller.address}\nBuyer  ${buyer.address}\nName   ${label}.arc\nBalance ${await bal(seller.address)}`)

// Fund the buyer with USDC (also its gas on Arc)
await tx(sw, usdc, erc20Abi, 'transfer', [buyer.address, 4_000_000n])

// 1. Register through ArcNS (commit, wait, register)
const year = 365n * 86_400n
const price = await pub.readContract({ address: arc.controller, abi: controllerAbi, functionName: 'rentPrice', args: [label, year] })
const cost = price.base + price.premium
const secret = toHex(crypto.getRandomValues(new Uint8Array(32)))
const commitment = await pub.readContract({
  address: arc.controller, abi: controllerAbi, functionName: 'makeCommitment',
  args: [label, seller.address, year, secret, proto.resolver, false, seller.address],
})
await tx(sw, arc.controller, controllerAbi, 'commit', [commitment])
console.log('Committed, waiting 65s…')
await new Promise((r) => setTimeout(r, 65_000))
await tx(sw, usdc, erc20Abi, 'approve', [arc.controller, cost])
await tx(sw, arc.controller, controllerAbi, 'register', [label, seller.address, year, secret, proto.resolver, false, cost])
check('register name via ArcNS', (await ownerOf(id)).toLowerCase() === seller.address.toLowerCase(), `cost ${cost}`)

// 2. List + atomic buy
const PRICE = 1_000_000n
await tx(sw, arc.registrar, registrarAbi, 'approve', [d.domix, id])
await tx(sw, d.domix, domixAbi, 'list', [arc.registrar, id, PRICE, 86_400n])
check('listing is valid onchain', await pub.readContract({ address: d.domix, abi: domixAbi, functionName: 'isListingValid', args: [arc.registrar, id] }))
const sellerBefore = await bal(seller.address)
const treasuryBefore = await bal(treasury)
await tx(bw, usdc, erc20Abi, 'approve', [d.domix, PRICE])
await tx(bw, d.domix, domixAbi, 'buy', [arc.registrar, id, PRICE])
check('buy transfers domain to buyer', (await ownerOf(id)).toLowerCase() === buyer.address.toLowerCase())
const [fee, proceeds] = await pub.readContract({ address: d.domix, abi: domixAbi, functionName: 'quoteFee', args: [PRICE] })
check('seller received proceeds', (await bal(seller.address)) - sellerBefore === proceeds, `+${proceeds}`)
check('treasury received fee', (await bal(treasury)) - treasuryBefore === fee, `+${fee}`)
check('sale counted by DOMIX', (await pub.readContract({ address: d.domix, abi: domixAbi, functionName: 'salesCount' })) >= 1n)

// 3. Offer, accept (buyer owns the name now; seller offers)
const OFFER = 500_000n
await tx(sw, usdc, erc20Abi, 'approve', [d.domix, OFFER])
await tx(sw, d.domix, domixAbi, 'makeOffer', [arc.registrar, id, OFFER, 86_400n])
const offerId = (await pub.readContract({ address: d.domix, abi: domixAbi, functionName: 'nextOfferId' })) - 1n
await tx(bw, arc.registrar, registrarAbi, 'approve', [d.domix, id])
await tx(bw, d.domix, domixAbi, 'acceptOffer', [offerId])
check('accepted offer moves domain back to seller', (await ownerOf(id)).toLowerCase() === seller.address.toLowerCase())

// 4. Profile records (verified owner only)
await tx(sw, d.domix, domixAbi, 'setRecords', [arc.registrar, id, ['display', 'url'], ['DOMIX smoke test', 'https://studio.arc.io']])
const display = await pub.readContract({ address: d.domix, abi: domixAbi, functionName: 'getRecord', args: [arc.registrar, id, 'display'] })
check('owner can write profile record', display === 'DOMIX smoke test')
let blocked = false
try {
  await tx(bw, d.domix, domixAbi, 'setRecord', [arc.registrar, id, 'display', 'hijack'])
} catch {
  blocked = true
}
check('non-owner cannot write profile record', blocked)

// 5. Auction create then cancel (no bids)
await tx(sw, arc.registrar, registrarAbi, 'approve', [d.domix, id])
await tx(sw, d.domix, domixAbi, 'createAuction', [arc.registrar, id, 100_000n, 50_000n, 3_600n])
const auctionId = (await pub.readContract({ address: d.domix, abi: domixAbi, functionName: 'nextAuctionId' })) - 1n
check('auction escrows the domain', (await ownerOf(id)).toLowerCase() === d.domix.toLowerCase())
await tx(sw, d.domix, domixAbi, 'cancelAuction', [auctionId, seller.address])
check('cancelled auction returns the domain', (await ownerOf(id)).toLowerCase() === seller.address.toLowerCase())

// 6. Registry sync after trades: ArcNS registry owner may differ from the NFT owner
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)

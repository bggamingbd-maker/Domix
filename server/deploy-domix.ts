/**
 * deploy-domix — deploys the single DOMIX contract from YOUR wallet, so you own the
 * address and the admin role. Works on Arc Testnet and Arc Mainnet.
 *
 *   forge build && bun run abis
 *   DEPLOYER_PRIVATE_KEY=0x... DOMIX_TREASURY=0x... bun run deploy:contracts -- --chain 5042002
 *
 * Environment:
 *   DEPLOYER_PRIVATE_KEY  key of the wallet that pays gas and deploys (never commit it)
 *   DOMIX_TREASURY        address that receives marketplace fees (required)
 *   DOMIX_ADMIN           optional: final owner. Ownership transfer is two-step, so this
 *                         address must call acceptOwnership() on the DOMIX contract.
 *   DOMIX_FEE_BPS         marketplace fee in basis points (default 250 = 2.5%, max 1000)
 *
 * Mainnet moves real USDC and is irreversible. Pass --i-understand-mainnet to confirm that you
 * have tested on testnet, had the contract independently audited, and checked every address.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createPublicClient, createWalletClient, http, isAddress, type Abi, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arc, arcTestnet } from 'viem/chains'
import { ARCNS } from '../src/lib/protocol'
import { getChain, getUsdc } from '../src/onchain-facts'
import { domixAbi } from '../src/contracts/abis'

const root = path.resolve(import.meta.dir, '..')
const args = process.argv.slice(2)
const flag = (name: string) => args[args.indexOf(name) + 1]
const chainId = Number(flag('--chain') ?? 5042002)

if (chainId !== 5042 && chainId !== 5042002) throw new Error('--chain must be 5042 (Arc Mainnet) or 5042002 (Arc Testnet)')
if (chainId === 5042 && !args.includes('--i-understand-mainnet')) {
  throw new Error(
    'Mainnet deploys involve real funds and are irreversible. Test on testnet first, get an independent audit, ' +
      'review every address, then re-run with --i-understand-mainnet.',
  )
}

const key = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Set DEPLOYER_PRIVATE_KEY (0x + 64 hex chars) in your shell')
const treasury = process.env.DOMIX_TREASURY
if (!treasury || !isAddress(treasury)) throw new Error('Set DOMIX_TREASURY to the address that receives fees')
const admin = process.env.DOMIX_ADMIN
if (admin && !isAddress(admin)) throw new Error('DOMIX_ADMIN is not a valid address')
const feeBps = Number(process.env.DOMIX_FEE_BPS ?? 250)
if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000) throw new Error('DOMIX_FEE_BPS must be 0..1000')

const usdc = getUsdc(chainId)?.address as Address | undefined
const protocol = ARCNS[chainId]
const rpc = getChain(chainId)?.rpcUrls[0]
if (!usdc || !protocol || !rpc) throw new Error(`Missing registry data for chain ${chainId}`)

const chain = chainId === 5042 ? arc : arcTestnet
const account = privateKeyToAccount(key)
const publicClient = createPublicClient({ chain, transport: http(rpc) })
const wallet = createWalletClient({ account, chain, transport: http(rpc) })

const artifactFile = path.join(root, 'contracts', 'out', 'Domix.sol', 'Domix.json')
if (!fs.existsSync(artifactFile)) throw new Error(`Missing ${artifactFile}. Run forge build first.`)
const artifact = JSON.parse(fs.readFileSync(artifactFile, 'utf8')) as { abi: Abi; bytecode: { object: Hex } }

async function send(label: string, request: Parameters<typeof wallet.writeContract>[0]) {
  const hash = await wallet.writeContract(request)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${label} failed (${hash})`)
  console.log(`${label.padEnd(18)} ok  tx ${hash}`)
}

console.log(`Deploying DOMIX to chain ${chainId} from ${account.address}`)
const deployHash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [usdc, treasury, feeBps, account.address],
})
const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash })
if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`Domix deployment failed (${deployHash})`)
const domix = receipt.contractAddress
console.log(`Domix              ${domix}  tx ${deployHash}`)

for (const t of protocol.tlds) {
  await send(`allow .${t.tld}`, {
    address: domix,
    abi: domixAbi,
    functionName: 'setCollection',
    args: [t.registrar, true, true],
  })
}

if (admin && admin.toLowerCase() !== account.address.toLowerCase()) {
  await send('handover', { address: domix, abi: domixAbi, functionName: 'transferOwnership', args: [admin] })
  console.log(`\nOwnership is pending. ${admin} must call acceptOwnership() on the DOMIX contract before it takes effect.`)
}

const file = path.join(root, 'src', 'deployments.json')
const all = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
all[String(chainId)] = { domix, deployBlock: Number(receipt.blockNumber) }
fs.writeFileSync(file, JSON.stringify(all, null, 2) + '\n')
console.log(`\nWrote ${file}. Restart the backend (bun run server) so it indexes the new contract.`)

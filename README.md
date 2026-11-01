# DOMIX

A marketplace for Web3 domains on Arc, paid in USDC. Discover, own and trade ArcNS names (`.arc`, `.circle`), with fixed-price sales, offers, auctions and onchain identity records.

Built with [Arc Studio](https://studio.arc.io)

## What it does

- Search names and wallet addresses with live availability and ownership.
- Register and renew ArcNS names with USDC.
- List domains for a fixed price, make and accept offers, run auctions.
- Set a wallet address and public profile on names you own.
- See sales, transfers, offers and auctions in an activity feed, with transaction links.
- Admin page for the marketplace owner: fee, treasury, pause, volume and fees collected.

Domains stay in the ArcNS registry. DOMIX never holds your domain while it is listed, and offers never lock your USDC.

## Tech stack

- React, Vite, TypeScript, Tailwind CSS, wagmi, viem, ConnectKit
- Solidity 0.8.28, Foundry, OpenZeppelin
- Bun backend with a Postgres index of contract events

## Development

Prerequisites: Bun, Foundry, Docker (for Postgres).

```bash
bun install
docker run -d --name domix-postgres --restart unless-stopped \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=domix \
  -v domixpg:/var/lib/postgresql -p 5432:5432 postgres:18-alpine
```

Create `.env` (see Environment variables), then run the backend and the app:

```bash
bun run server   # indexer and API on port 3001
bun run dev      # app on port 5173, proxies /api to the backend
```

Other commands:

```bash
bun run contracts:build   # forge build
bun run contracts:test    # forge test
bun run abis              # regenerate src/contracts/abis.ts after a contract change
bun run check             # lint and typecheck
bun run smoke             # real-transaction test of the deployed contract on Arc Testnet (needs DEPLOYER_PRIVATE_KEY with testnet USDC)
```

### Environment variables

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string for the backend. |
| `DOMIX_API_PORT` | Backend port. Defaults to 3001. |
| `INDEX_CHAINS` | Comma-separated chain IDs to index. Defaults to `5042,5042002`. |
| `VITE_WALLETCONNECT_PROJECT_ID` | Enables WalletConnect. Get one from WalletConnect Cloud. Without it, injected wallets (MetaMask, Rabby) still work. |
| `VITE_API_BASE_URL` | Optional. Address of a hosted backend. Without it, a built app reads the DOMIX contract's events straight from the chain and hides registry-wide totals. |
| `VITE_DOMIX_CHAIN_ID` | Optional default network (`5042` mainnet or `5042002` testnet). |
| `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS` | Optional. Provisioned by Arc Studio. Outside Arc Studio the public Arc RPC URLs are used. |

Deployment-only variables (set in your shell, never commit them): `DEPLOYER_PRIVATE_KEY`, `DOMIX_TREASURY`, `DOMIX_ADMIN`, `DOMIX_FEE_BPS`.

## Deploy your own contract (Remix)

DOMIX is a single file, `contracts/Domix.sol`, with no imports.

1. Open [Remix](https://remix.ethereum.org), create a file and paste the whole of `contracts/Domix.sol`.
2. In the Solidity compiler tab choose version 0.8.28, EVM version `cancun`, and enable the optimizer with 200 runs. Compile.
3. In Deploy, pick `Domix` and enter the constructor arguments: the USDC token address, your fee treasury address, the fee in basis points (250 = 2.5%), and the owner address.
4. After deploying, the owner allows each ArcNS registrar once (`setCollection`, or use the Admin page).
5. To use your copy in the app, put its address and deploy block in `src/deployments.json` under `domix` and `deployBlock`.

## Deploying the contract from your own wallet

DOMIX runs on a single contract, `Domix`, which handles listings, offers, auctions and profile records. The deploy script deploys it from your wallet, allows the ArcNS registrars, and writes the address to `src/deployments.json`.

```bash
forge build && bun run abis

# Arc Testnet
DEPLOYER_PRIVATE_KEY=0x... DOMIX_TREASURY=0xYourTreasury DOMIX_ADMIN=0xYourAdmin \
  bun run deploy:contracts -- --chain 5042002
```

If `DOMIX_ADMIN` differs from the deployer, ownership transfer is two-step: the admin wallet must open the Admin page (or call `acceptOwnership()`) on the contract.

Restart the backend afterwards so it starts indexing the new contracts.

### Arc Mainnet

Mainnet transactions use real USDC and cannot be reversed. Before deploying to mainnet:

1. Deploy and test everything on Arc Testnet.
2. Get an independent professional security audit of the contract.
3. Check every address in `src/lib/protocol.ts` against the ArcNS project's own deployment files.
4. Review the treasury, admin and fee settings.

Then run the same command with `--chain 5042 --i-understand-mainnet`. You deploy, fund and operate mainnet yourself; Arc Studio does not transact on mainnet for you.

## Notes

- Naming protocol: ArcNS. Its addresses in `src/lib/protocol.ts` come from the project's published deployment files and were cross-checked with onchain reads.
- The backend index is a convenience layer. The app re-reads every listing, auction, offer and owner from the contracts before showing it.
- Wallet signatures for profile, notification and admin requests are verified for externally owned accounts only.

## Arc Testnet deployment

The DOMIX contract is deployed on Arc Testnet (chain 5042002) and, by its owner, on Arc Mainnet (chain 5042); the addresses are in `src/deployments.json`. The owner and fee treasury is the project admin wallet. Before listings work, the owner opens the Admin page and allows the `.arc` and `.circle` registrars.

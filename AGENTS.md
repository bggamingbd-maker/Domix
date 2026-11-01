# [App Name]

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

[Brief description of what the app does and its primary use case]

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## Share links

- Starter apps already ship `getShareBase`, `buildShareLink` and `installShareSync` in `src/lib/share.ts`; import them instead of rewriting them.
- Keep shareable state in the URL path or query, not in the `#fragment`.
- Never put a secret (private key, claim secret, seed phrase, session token, API key) in the URL path or query, encoded or not: every in-app path and query is mirrored to the visitor's studio.arc.io address bar and browser history and reaches servers. A bearer claim secret goes only in the `#fragment` appended to the share link (`` `${await buildShareLink('/claim')}#${secret}` ``) and is read from `location.hash` on load. A link to the app's own share URL shown inside the app must be copy-only or open in a new tab with `target="_blank" rel="noopener noreferrer"`.
- Build every link a user copies or sends with `buildShareLink()` from `src/lib/share.ts`.
- Keep the `installShareSync()` call in `src/main.tsx` when editing it; it keeps the Studio address bar in step with in-app navigation.
- Navigate inside the app with relative links.

## To Run

```bash
bun install
bun run dev
```

## Contract

DOMIX runs on ONE contract: `contracts/Domix.sol` (`Domix`). It handles fixed-price listings, offers, auctions and profile records. The earlier four-contract version is archived under `archive/v1-contracts/` and is not used.

- ABI: `src/contracts/abis.ts` (`domixAbi`), regenerate with `forge build && bun run abis`.
- Address per chain: `src/deployments.json` (`{ domix, deployBlock }`). The backend indexer and every frontend hook read it.
- Deploy from your own wallet: `bun run deploy:contracts -- --chain 5042002` (see README). Constructor: `(usdc, treasury, feeBps, owner)`. After deploy, the owner must call `setCollection` for each ArcNS registrar (the script does this when the deployer is the owner).
- Ownership handover is two-step: the new owner calls `acceptOwnership()` (Admin page has the button).

Deployed on Arc Testnet (chain 5042002): `0x6bb7e9ca20f6b47f961cbea4225773a57a80662d` at block 70046958, via the platform deploy tool (2026-10-31). Constructor: USDC 0x3600…0000, treasury and owner `0x1DF1bb819729c85890D92b06a907888Cf1B54AD5`, fee 250 bps (2.5%). That wallet owns the contract directly (no handover needed) and must open Admin and click Allow for `.arc` and `.circle` before listings work. The retired four-contract testnet deployment is no longer used.
Arc Mainnet (chain 5042): `0xCe9B7EBE50E4f315708b27dF66E788F3AdB2dA39` at block 28873818, deployed by the user from their own wallet via Remix (not by Arc Studio). Owner and treasury `0x1DF1bb819729c85890D92b06a907888Cf1B54AD5`, fee 250 bps, USDC 0x3600…0000. Read back onchain and the runtime code matches the compiled project file apart from the USDC immutable and the metadata hash. Both registrars (`.arc`, `.circle`) were allowed by the owner (verified onchain). Not independently audited.

## Deploy your own

`contracts/Domix.sol` is one self-contained file (OpenZeppelin code inlined, no imports), so it can be pasted straight into Remix or any compiler. Settings: solc 0.8.28, EVM cancun, optimizer on, 200 runs. Constructor: `(usdc, treasury, feeBps, owner)`; after deploying, the owner calls `setCollection(registrar, true, true)` for each ArcNS registrar (Admin page has buttons).
The file is deliberately compact (about 580 lines): trimmed OpenZeppelin-equivalent Ownable2Step, Pausable, ReentrancyGuard and SafeERC20 are written in, plus short comments. Keep it that way and do not reintroduce `import` lines. The Arc Testnet deployment was built from the earlier, longer version of the file; the ABI and behavior are identical. After a logic change, rebuild with `forge build && bun run abis`.

## Backend in the sandbox

The dashboard data (activity, totals, listings, owned names) comes from the indexer in `server/`, which reads chain events over the public Arc RPC into Postgres. In the sandbox: Postgres runs as the Docker container `domix-postgres` (volume `domixpg`), `DATABASE_URL` is in `.env`, and the backend is started with `bun run server` (port 3001, proxied at `/api`). Mainnet is indexed first; the long ArcNS history backfill runs one chain at a time. `/health` reports `synced` (live tail) and `historyProgress`. Browser reads go through a dev-only relay at `/rpc/<chainId>` (see `vite.config.ts`). The Arc mainnet explorer (explorer.arc.io) blocks programmatic access, so the app links to it instead of reading from it.

## Interface performance

- Lite mode (`src/hooks/useLite.ts`): small screens, touch devices and reduced-motion users get no orbs, cursor glow, typing headline or letter-by-letter animation. Use `useLite()` instead of `useReducedMotion()` for new animations.
- Pages other than the dashboard are lazy-loaded in `src/App.tsx`; vendor code is split into `react`, `motion` and `web3` chunks in `vite.config.ts`.
- `NetworkNotice` shows a Testnet notice under the top bar (nothing on Mainnet). `GetStarted` replaces the empty listings text on the dashboard.

## Running without the backend (Vercel / Netlify builds)

A built app has no `/api`. `src/lib/api.ts` then answers from `src/lib/chainApi.ts`, which reads the single DOMIX contract's event log from the RPC (kept in localStorage, resumed from the last block) and serves listings, auctions, offers, activity, stats, volume and trending in the same shapes as the indexer. Registry-wide data (total domains, full owned-name lists, ArcNS registrations feed) needs the indexer: the dashboard swaps "Total domains" for "Open auctions", counts "My domains" with the registrars' `balanceOf`, and hides the registry sections. Set `VITE_API_BASE_URL` to a hosted backend to turn the indexer back on. `src/lib/persistQueries.ts` keeps the last dashboard answers in localStorage so repeat visits paint instantly.

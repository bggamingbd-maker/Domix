## Implementation Plan: DOMIX single self-contained contract file

### Summary
Turn `contracts/Domix.sol` into one self-contained file with no `import` lines, so it can be pasted into Remix or any other tool and deployed as your own copy. The marketplace logic stays exactly the same. This only changes how the source is packaged.

### Architecture
- Blockchain: Arc Testnet by default. For mainnet, the user deploys, funds and operates it themselves after an independent review (mainnet warning already given in this thread).
- Contract: `Domix`, same functions as today. The OpenZeppelin pieces it uses (Ownable2Step, Ownable, Pausable, ReentrancyGuard, SafeERC20, IERC20, IERC721, IERC721Receiver) and their small helpers are written into the same file.
- Frontend and backend: no changes. ABI, function names and events stay identical; `src/contracts/abis.ts` should regenerate to the same ABI.
- Wallet: ConnectKit as before.

### Files to Create/Modify
1. `contracts/Domix.sol` - replace with the self-contained version: one SPDX line, a single `pragma solidity ^0.8.20;`, OpenZeppelin code inlined, `Domix` contract unchanged at the bottom.
2. `docs/remix/Domix.flat.sol` - delete (redundant once `contracts/Domix.sol` is itself Remix-ready).
3. `AGENTS.md` - replace the "Remix" section with a short "Deploy your own" section: solc 0.8.28, EVM cancun, optimizer on, 200 runs, constructor `(usdc, treasury, feeBps, owner)`.
4. `README.md` - add a short "Deploy your own contract" section with the Remix steps and the script command.
5. `server/deploy-domix.ts`, `src/contracts/abis.ts`, `src/deployments.json` - no changes expected; regenerate the ABI and confirm it is unchanged.

Leave `contracts/script/Create2Factory.sol` and `contracts/script/DeployCreate2.s.sol` alone (existing deploy tooling, not part of the marketplace). Remove them only if the user asks for `contracts/` to hold a single `.sol` file.

### Build Sequence
1. Save the compiled output of the current contract, then write the single-file version.
2. Run `forge build`; confirm it compiles with solc 0.8.28 / cancun and the runtime bytecode matches the current contract apart from the metadata hash.
3. Run `bun run abis` and confirm the ABI is unchanged; run `bun run typecheck` and lint on `src` and `scripts`.
4. Delete `docs/remix/Domix.flat.sol`; update `AGENTS.md` and `README.md`.
5. Check the file has no `import` lines and no overlong lines, and compile a copy of it alone in a scratch folder to prove it works without any project setup.
6. Leave the Arc Testnet deployment (0x6bb7e9ca20f6b47f961cbea4225773a57a80662d) untouched.

### Done When
- [ ] `contracts/Domix.sol` has no `import` lines and compiles on its own with solc 0.8.28 / cancun.
- [ ] Compiled functions, events and errors match the currently deployed contract.
- [ ] `src/contracts/abis.ts` is unchanged after regeneration.
- [ ] Typecheck and lint on `src` and `scripts` pass; the preview still loads.
- [ ] `docs/remix/Domix.flat.sol` is removed and the docs explain how to deploy your own copy.
- [ ] Pasting `contracts/Domix.sol` into Remix, compiling and deploying with the four constructor arguments works.

## Ready to build?

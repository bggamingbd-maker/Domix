## Implementation Plan: DOMIX dashboard speed and clarity

### Summary
Make the DOMIX dashboard load faster and feel smoother on phones, show a clear mainnet notice, and replace the empty "0" screens with guided first steps. No contract, backend or data changes.

### Architecture
- Blockchain: no change. Mainnet contract `0xCe9B7EBE50E4f315708b27dF66E788F3AdB2dA39`, testnet contract unchanged.
- Contract: none touched.
- Frontend: React lazy loading for pages, a "lite motion" setting for phones and reduced-motion users, a network notice bar, and richer empty states.
- Wallet: ConnectKit as before.

### Files to Create/Modify
1. `src/App.tsx` - load every page except Home on demand with `React.lazy` and `Suspense` (skeleton fallback). Home stays eager so the first screen is instant.
2. `vite.config.ts` - add `build.rollupOptions.output.manualChunks` that splits the vendor code into groups (react, wagmi and viem, connectkit, framer-motion, lucide) so the entry file shrinks and browsers cache them separately.
3. `src/hooks/useLite.ts` - new hook returning true on small screens, touch devices or when the user prefers reduced motion.
4. `src/components/fx/Ambient.tsx` - `FloatingOrbs` and `CursorGlow` render nothing in lite mode.
5. `src/components/fx/Motion.tsx` - in lite mode: `AnimatedText` renders plain text, `Typewriter` shows the first message, `Magnetic` and `Reveal` render plain content, `CountUp` shows the final value at once.
6. `src/components/NetworkNotice.tsx` - new slim bar: on mainnet "Arc Mainnet: real USDC, transactions can't be undone"; on testnet "Arc Testnet: test USDC with no real value". Includes a link to switch network.
7. `src/components/Layout.tsx` - show `NetworkNotice` under the top bar.
8. `src/components/GetStarted.tsx` - new card with three steps ("Register a name", "List a name you own", "Make the first offer") and buttons to `/explore`, the list dialog and `/marketplace`.
9. `src/pages/Home.tsx` - show `GetStarted` instead of the plain "No domains are listed" text when there are no listings; improve the empty text in "Recently listed" and "Trending".
10. `src/components/ActivityFeed.tsx` - friendlier empty state with the same call to action.
11. `AGENTS.md` - note the lite-motion setting and the lazy pages.

### Build Sequence
1. Add `useLite`, then update `Ambient.tsx` and `Motion.tsx` to use it.
2. Lazy-load pages in `App.tsx` and add `manualChunks` in `vite.config.ts`.
3. Build `NetworkNotice` and `GetStarted`, then wire them into `Layout.tsx`, `Home.tsx` and `ActivityFeed.tsx`.
4. Run `bun run typecheck`, lint on `src` and `scripts`, and a production build to compare file sizes with the current 1.65 MB main file.
5. Restart nothing on the server side. Check the preview serves the new modules and that the console shows no new errors.

### Done When
- [ ] The main production file is clearly smaller than 1.65 MB, with pages and vendor code in separate files.
- [ ] On a phone-sized screen or with reduced motion, the orbs, cursor glow, typing text and letter-by-letter headings are off and the page still looks right.
- [ ] A visible notice shows whether you are on Arc Mainnet or Arc Testnet.
- [ ] With no listings, the dashboard shows the three first-step buttons and each one works.
- [ ] Typecheck, lint and the production build pass, and the preview loads without console errors.

## Ready to build?

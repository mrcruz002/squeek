# Squeekchain Launchpad — Expansion Plan: Genesis Design + Kalos Features

**Prepared:** 6 November 2026, by Koda for Sadiq Ibrahim
**Status:** plan only — nothing built, nothing deployed, no money spent
**Builds on:** `plan.md` (Phase 0–1 complete, factory live on Sepolia). This plan does not replace it.

---

## 1. The brief (locked)

- **Design = Squeekchain Genesis** (https://squeekchain.com/genesis): the launchpad's look matches Squeekchain's own branding — font, hamster logo, dot-matrix style.
- **Features = kalos.fun's, trimmed:** swap, NFT trading, whitelist, profile.
- **Removed by the user:** raffles (kalos "Fate"), points leaderboard (kalos "Rewards"), social feed (kalos "Social") — 6 Nov ~20:00 WAT; liquidity (kalos "Liquidity" page) — 6 Nov ~20:05 WAT. These are OUT — not deferred, removed.
- **Still Sepolia testnet only** (chain 11155111). No mainnet, no token launch, no audit in this plan.

---

## 2. Where we are (verified 6 Nov 2026)

- Phase 0–1 complete and verified: factory + ERC-721 drop contracts, 25/25 Foundry tests, frontend builds, local anvil smoke test passed.
- Factory live on Sepolia: `0x9Ba898622E30E2eB88B26143c6b1070789A5390f`, implementation `0x86B5dDEA1738D8901D176F38e1bDA6E8d7D22c22`, deployed 6 Nov ~10:07 WAT, tx `0xd8182e23ab925fb41429f63fd68f68960ed4c2622c42207ac4aae7868ef528ea` (block 12075576). collectionCount 0 as of the last check (19:47 WAT, block 12078429).
- Site runs at localhost:5173 with the real factory; browser wallet `0xeE60…1c54` (0.0869 Sepolia ETH).
- **Demo test still pending:** create Demo Squeeks (DSQK, 0.01 ETH, 100 supply, 3/wallet) + click-through mint on Sepolia. Three earlier attempts went to Ethereum mainnet (wallet was on mainnet) — no-ops, ~0.000032 ETH total. Fix: wallet on Sepolia, check the popup says Sepolia before confirming.
- Current frontend: plain Vite/React, no Genesis branding yet; public-sale only (no allowlist code exists).

---

## 3. Design system (from the Genesis study, 6 Nov ~20:00 WAT, read-only)

Studied: squeekchain.com/genesis, squeekchain.com/ (home), squeekchain.com/genesis/aura. No wallet or sign-in needed; nothing state-changing done.

- **Palette (light theme, exact values from the site's CSS variables, 6 Nov ~20:07 WAT):** page background #f5f5f7; raised surfaces #ededf0; off-white #f2f2f4; near-black ink #2a2a33 / #0b0b0d; royal blue #4460cf (deep #2f4499); hamster orange #e8b04a; active #003a5c; red #f44a5e; green #35d07f; gold #f2c230; grey #6e6e7a; borders #e0e0e6 / #d2d2da; cream #fdfbc8. Purple/violet for the Genesis sub-brand; teal/cyan only for LIVE states.
- **Typography (confirmed from the site's own CSS, 6 Nov ~20:07 WAT):** three faces — display **Barlow Condensed** (headings, tall condensed caps), data **IBM Plex Mono** (labels, buttons, numbers), voice **Quicksand** (body copy). Google Fonts: Barlow Condensed 200/300/600, IBM Plex Mono 400, Quicksand 600. Headings large, spaced capitals ("FARM AURA"); numbers large and tabular with small grey uppercase labels above. (Earlier impression that everything was mono was wrong — the mono face is for data/labels, not headings.)
- **Hamster logo:** small chunky pixel-art orange hamster face in the header next to a dotted blue square; larger dotted form in the footer; three colourways in the footer (orange, black/white, blue). The image the user sent (yellow hamster face in dots on a blue dot grid) is the same dot-matrix treatment.
- **Dot-matrix motif (the signature):** wordmarks built entirely from coloured dots ("SQUEEK" orange-yellow gradient over "CHAIN" blue gradient); Genesis hero wordmark and purple spiral the same technique; hero cards on a faint dotted grid; dotted aura map; dotted progress bars and countdown digits; small square bullets (■); tiny pixel icons (wallet, gamepad, chest, flag).
- **Cards & buttons:** flat, pale, very small corner radii (almost square), thin grey outlines, soft flat shadows, no glass, no gradients on the cards. Primary buttons: solid near-black rectangles, white uppercase mono text. Secondary: white with dark outline. Tabs: pill-like outlined buttons, active one filled solid blue with white text. Inputs: white boxes, grey borders, uppercase placeholder text. Tables: thin row dividers, small grey uppercase column headings, right-aligned numbers.
- **Vibe:** playful-retro, toy-like, 8-bit arcade + clean spacious layout. Copy leans into the joke ("Powered by one hamster.", "Every block started with a wheel turn."). Light theme default, LIGHT toggle in header.
- **Layout reference (Genesis page):** sticky white pill header (logo left, nav, theme toggle, LINK X, CONNECT WALLET right); big hero card with dot-matrix wordmark + tagline + two buttons + counters row; tabbed panel section; two-card CTA row; ranking/leaderboard table section; four-column footer.
- **Caveats (honest):** font names and colour tokens are confirmed from the site's own CSS (see above) — no more guessing. What is still missing: no brand kit or logo asset file is published, so the hamster mark must be recreated as dot-grid art (the user's image is the reference); it is Squeekchain's brand, and this launchpad is being built for Squeekchain, but there is no official asset file to download.

---

## 4. Feature scope (kalos features, trimmed)

What kalos has (from the 6 Nov study): swap, liquidity, NFTs, whitelist, social, Fate raffles, Rewards points, profile. Ours takes four, drops four.

### 4.1 Genesis restyle (design system) — frontend only, no contract changes

- Apply §3 across all existing pages (Home, Create, Collection, Token) and every new page.
- New shared pieces: sticky pill header with pixel hamster + dotted square, mono type everywhere, square cards, black primary buttons, blue active tabs, dot-grid hero treatment on Home, footer with hamster mark + "Powered by one hamster." line.
- A small design-tokens file (colours sampled from screenshots, mono font stack) so every page matches.
- Acceptance: side-by-side look check against squeekchain.com/genesis; every page light-theme, mono, square cards.

### 4.2 Whitelist / allowlist (Merkle) — contract + frontend

- Current collections are public-sale only; no allowlist code exists (grep-verified 6 Nov).
- Design (from plan.md §5): Merkle allowlist — list of wallets → Merkle root stored on the collection → proof supplied at mint. Two phases per collection: allowlist phase, then public phase.
- Contract work: add allowlist phase + proof verification to the collection implementation; a small off-chain script builds the Merkle tree/root from a wallet list.
- **Consequence: new implementation + fresh factory deployment.** The current factory's implementation is fixed; it cannot be upgraded. The demo test should be finished on the current factory first (or re-done on the new one).
- Frontend: allowlist checker ("is this wallet on the list?"), allowlist mint UI with phase countdown, creator flow to set the Merkle root at creation.
- This is the same allowlist the user already asked about (6 Nov 10:34 WAT); order agreed then was demo test first.

### 4.3 NFT trading / marketplace core — contract + indexer + frontend

- This is plan.md Phase 2: listing contract (list / buy / cancel), indexer v1 (own contracts only), listings + floor price on collection pages, activity feed.
- Collection page gains: floor price, volume, listed tokens with prices, list/buy buttons. Token page gains: list-for-sale, buy-now, sale history.
- Indexer is the main hard part (plan.md §6): event listener + Postgres + read API, reorg handling, resume-from-last-block. Needs a small always-on VPS (~$5–20/mo) — the only 24/7 piece.
- Royalties: ERC-2981 already on collections (5% default); marketplace enforces on sales.
- Not in core: offers, search, explore/trending, stats history — those are Phase 3 of plan.md (marketplace full) and stay later.

### 4.4 Swap — new AMM contracts + frontend

- Kalos's Swap: pick a pair, enter an amount, live quote, connect wallet to trade; centre table is a market screener (price, 1h/24h/7d/30d, market cap, volume, liquidity, supply, holders); watchlist by starring tokens.
- What we build: a minimal constant-product AMM (Uniswap V2-style factory + pair + router) on Sepolia. Pairs are ETH ↔ token. Router does the swap with slippage protection; 0.3% fee like kalos.
- Needs a test token to swap against: deploy a demo ERC-20 (e.g. test SQK) — the real SQK token has not launched and its canonical address is unverified, so the swap token is a stand-in for testing only. Do not present demo-token prices as real.
- Frontend: swap box (You pay / You receive, quote, slippage setting), token table (price, changes, volume, liquidity — from the indexer/API, not the chain directly), watchlist (local, starred tokens).
- Liquidity behind the swap: no public liquidity feature, so pools are seeded once at setup (deployer adds the initial liquidity) so swaps have something to trade against. No pool table, no add/remove UI, no positions view.
- Risk note: AMM contracts hold funds and are the highest-risk new code here; they need the same treatment as the marketplace (full tests, no audit = no real money, ever).

### 4.5 Profile / dashboard — frontend (+ optional off-chain later)

- Kalos's Profile is wallet-gated: your assets and rewards. Ours: your collections created, your NFTs owned, your listings, your liquidity positions — all readable straight from chain + indexer, no new contract.
- Username + PFP: off-chain (small database + wallet-signature sign-in, PFP image on IPFS, like OpenSea). Recommendation: on-chain-only profile first (address shown, no username/PFP); add username/PFP as a follow-up once the core works. (User asked about this 6 Nov 13:38 WAT; no decision made then.)
- This is also the "dashboard" from the earlier plan discussions.

### 4.6 Explicitly OUT

- Raffles (kalos "Fate"), points leaderboard (kalos "Rewards"), social feed (kalos "Social") — removed by the user 6 Nov ~20:00 WAT.
- Liquidity (kalos "Liquidity" page — pool table, add/remove liquidity, positions) — removed by the user 6 Nov ~20:05 WAT.
- No token launch, no mainnet, no audit, no real-money trading, no Sniper (kalos lists it as "Coming soon"; not requested).

---

## 5. Build order (phases)

| Phase | What ships | Depends on | Rough estimate |
|---|---|---|---|
| **Demo test (finish first)** | Create Demo Squeeks + mint on Sepolia, verified on-chain | User at home, wallet on Sepolia | 1 session |
| **2 — Genesis restyle** | §4.1: design system + restyle of all existing pages | Nothing (frontend only) | ~1 week |
| **3 — Whitelist** | §4.2: Merkle allowlist, new implementation + fresh factory, allowlist UI | Demo test done (or re-do demo on new factory) | ~1–2 weeks |
| **4 — Marketplace core** | §4.3: listing contract, indexer v1, floor price, list/buy, activity | Phase 2 (pages to restyle); indexer VPS | ~3–4 weeks |
| **5 — Swap** | §4.4: AMM contracts, swap box, demo token (pools seeded at setup) | Indexer (for token table) | ~2–3 weeks |
| **6 — Profile** | §4.5: on-chain dashboard; username/PFP follow-up | Indexer; Phase 4 listings | ~1–2 weeks |

**Total: ~8–12 weeks** of focused solo-paced work after the demo test (same estimating style as plan.md — build estimates, not promises). Phase 2 is the quick visible win; Phases 4–5 are the long ones (indexer, AMM).

Why this order: restyle first because it is visible, safe (no contracts), and every later page inherits it. Whitelist next because it needs a fresh factory — better to do that before collections pile up on the old one. Marketplace before swap because the indexer serves both, and NFT trading is the launchpad's core. Swap last because it is the newest risk (AMM) and needs the indexer for its tables.

---

## 6. Costs (estimates, testnet phase)

Same as plan.md §7, plus:

- VPS for indexer + API: ~$5–20/month (only new recurring cost).
- Demo ERC-20 for swap testing: gas only (Sepolia, ~free).
- Frontend hosting: $0 (static hosting free tier).
- Audit (mainnet only, when scope is final incl. AMM + marketplace): typically $5,000–$30,000+ — get quotes when Phase 5 is done; do not skip it for real money. AMM + marketplace together is a bigger audit scope than the launchpad alone.
- No revenue until mainnet; none assumed.

---

## 7. Risks (honest list)

1. **Squeekchain is early** (plan.md §8): testnet only, contracts may change before mainnet, core stalled ~10 days as recently as late October. A launchpad built now may need rework at mainnet.
2. **AMM is new risk:** swap/liquidity contracts hold user funds; a bug there loses money. Full Foundry tests + no mainnet without audit.
3. **Indexer is still the main hard part:** floor price, volume, token tables, activity, profiles all depend on it. If it falls behind or mishandles a reorg, the whole trading surface shows wrong data.
4. **Design is a recreation, not official assets:** no font name, hex codes, or logo files are published; the hamster and wordmarks are redrawn from screenshots and the user's image. Close match, not pixel-identical — and if Squeekchain publishes a brand kit later, swap to the real assets.
5. **Fresh factory for the allowlist:** the current Sepolia factory (`0x9Ba8…`) will be superseded; collections made on it stay valid but won't have allowlist phases. Keep the old factory address recorded.
6. **No users yet:** a marketplace/swap with no traders has no prices and no volume. Same community job as plan.md §8.
7. **Scope:** five features is a lot; each phase must be verified before the next starts, or bugs compound.

---

## 8. Decisions needed from him (before building)

1. **Approve this plan and order?** (Or reorder — e.g. marketplace before whitelist, or profile earlier.)
2. **Demo token for swap:** deploy a demo ERC-20 for testing, or use an existing Sepolia token? (Recommendation: deploy a clearly-named demo token; real SQK is unverified and unlaunched.)
3. **Profile:** on-chain-only first, or include username + PFP (off-chain DB + signature) in Phase 6?
4. **Name and domain:** needed before anything is public (plan.md §5.7). The site is still localhost.
5. **Hosting for the indexer:** small VPS when Phase 4 starts (his call; ~$5–20/mo).

---

## 9. What happens next (if he says go)

1. He answers §8 (or just #1 — the rest can wait).
2. Demo test: create Demo Squeeks + mint on Sepolia, verified on-chain.
3. Phase 2: Genesis restyle — he sees the new look on the live site and signs it off.
4. After each phase, he tests it and we fix what breaks before moving on. Nothing deploys to mainnet without his explicit go-ahead — and mainnet doesn't exist yet anyway.

**What this plan does not do:** it does not start building, spend money, deploy anything, or contact anyone. It is the map, not the trip.

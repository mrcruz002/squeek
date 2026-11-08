# Squeekchain Marketplace — plan

## Build status (2026-11-07)

Built and verified. Phase 4a (indexer), 4b (listing contract), 4c (offers)
and 4d (frontend) are all done. `forge test`: 49/49 pass (25 launchpad +
24 marketplace). Frontend `npm run build` passes clean. Delivery zip:
`~/workspace/squeekchain-launchpad-frontend-marketplace-v1.zip` (frontend
+ abi + marketplace-deploy + indexer, no .env). Previews:
`marketplace-preview/` (anvil fixture + live Sepolia indexer).

Two bugs found and fixed during verification:
- Indexer `GET /collections` returned HTTP 500 once any listing existed
  with a floor above ~0.009 ETH: `MIN(CAST(priceWei AS INTEGER))` came
  back as a JS number over the safe-integer limit and node:sqlite threw.
  Fixed in `indexer/src/api.mjs` — floors are now returned as TEXT
  (`CAST(MIN(...) AS TEXT)`), matching the rest of the API.
- The Squeek collection page hung on "Loading collection…" when the
  Sepolia RPC was unreachable, because it waited on the factory
  `isCollection` read before showing the indexer view. Fixed in
  `frontend/src/pages/CollectionPage.tsx` — if the indexer knows the
  collection and the factory read errors or takes over 8 s, the page
  renders from the indexer. The Token page still needs the RPC for
  ownerOf/tokenURI (it shows "does not exist" when the RPC is down);
  the same indexer fallback would fix it as a follow-up.

Not deployed yet: the listing contract — the user deploys it himself via
`marketplace-deploy/` (local-run script, dry-run supported), then adds
`VITE_MARKETPLACE_ADDRESS` to the frontend `.env`. The Sepolia indexer
is running on this machine (port 3001, synced); for continuous sync it
needs a VPS — see `indexer/README.md`.

## Goal

A marketplace where any Squeekchain-related NFT on Sepolia testnet can be traded,
even if it was not launched on this launchpad. Dashboard shows your collections;
clicking one opens its marketplace page: holders list, listings, offers, and floor
price. Same collection, split by level where levels exist (Squeek), with bids on
each token.

## Scope

- Sepolia testnet only (chain 11155111). No real money. Contracts unaudited.
- Same site as the launchpad (new Marketplace section), same Genesis design.
- SQK token trading is the swap (Phase 5), not this marketplace.

## Collections in scope

1. **Squeek** `0xC4C7982657f00509548F3a3a41db7FA439a6856B` — the 9,999 Genesis NFTs,
   with levels (see below).
2. **Launchpad factory collections** — anything created on factory
   `0x9Ba898622E30E2eB88B26143c6b1070789A5390f`.
3. **Any other Squeekchain-related ERC-721/ERC-1155 on Sepolia** — via a curated
   registry seeded with (1) and (2); the indexer can discover more later.

## Verified facts this plan rests on

- **Merge mechanic (official docs, docs.squeekchain.com/squeeks/):** a Squeek
  starts at Level 1. Merging two same-level Squeeks burns one and raises the
  other a level. Each level has 2.2x the base power of the one below, so the
  merged Squeek has 10% more power than the pair. Merging works in your wallet
  or while deposited; another merge waits for a cooldown counted in completed
  Squeek blocks. "L1/L2" here means **Level 1 / Level 2**, not blockchain layers.
- **His merges (receipts, Sepolia):** #69 merged into #67 (block 12075108,
  tx `0xde44b9c0…`), #66 merged into #68 (block 12075140, tx `0xbe6efd01…`).
  Both survivors are now **Level 2** and are held by the staking contract
  `0x50fd1780526C3186A0c037c7622203bC4fb611ca`. #66 and #69 no longer exist.
- **Level is NOT in tokenURI metadata** (verified 2026-11-07: tokenURI for #67
  and #68 decodes to visual traits only — Palette, glyphs, Background — zero
  mentions of level). Levels must be tracked from **Merge events** on chain.
  The merge event (topic `0x8a9b1a00…`) carries survivor, donor and new level.
- **Squeek collection is NOT Enumerable** (verified: supportsInterface
  `0x780e9d63` false). Holders and token lists cannot be read directly from the
  contract — they need the indexer.
- **Royalties:** Squeek and launchpad collections are ERC-2981; sales should pay
  the on-chain royalty recipient.

## Pieces to build

### 1. Listing contract (new, Foundry + OpenZeppelin)

- `list(collection, tokenId, price)` — seller's NFT moves into the contract
  (escrow). `buy(listingId)` — pay exact price, NFT goes to buyer, seller is
  paid minus royalty. `cancelListing` — NFT returns to seller.
- Offers (bids): `makeOffer(collection, tokenId, price, expiry)` with ETH
  escrowed in the contract; `acceptOffer` — seller accepts, NFT goes to the
  bidder, ETH goes to the seller minus royalty; `cancelOffer` — ETH refunded.
- 0% marketplace fee on testnet. Royalty paid per ERC-2981 on every sale.
- Escrow vs approval: escrow is recommended — an offer is only real if the ETH
  is locked, and a listing is only real if the NFT is locked. Trade-off: the
  NFT leaves the seller's wallet while listed (it is not staked or merged
  while listed).

### 2. Indexer v1 (new backend, Node + SQLite/Postgres)

- Scans Sepolia from a chosen start block and keeps these tables current:
  - **Owners/holders** from Transfer events (per collection, per token).
  - **Levels** from Merge events (per Squeek tokenId, current level).
  - **Listings, offers, sales** from the listing contract's events.
  - **Floor price** per collection, and per level for Squeek (lowest active
    listing among tokens at that level).
- Serves a small REST API the frontend reads. Needs a VPS that stays up
  (~$5–20/month). Backfill from the Squeek collection's early blocks; a missed
  Merge event means a wrong level, so backfill is re-checked, not assumed.

### 3. Frontend (same repo, Genesis design)

- **Marketplace page:** all tracked collections with floor price and listed count.
- **Collection page:** holders list, active listings, floor per level (Squeek),
  recent activity.
- **Token page:** buy / list / make an offer; all active bids on that token
  with amounts and expiry.
- **Dashboard:** your NFTs across *all* tracked collections (not just the
  launchpad's), plus your active listings and offers.

## Phases

- **4a — Indexer v1 + read-only pages** (holders, collections, levels, floors
  from listings once they exist). ~1 week.
- **4b — Listing contract + list / buy / cancel.** ~1 week.
- **4c — Offers (bids) + accept / cancel.** ~1 week.
- **4d — Floor per level + activity feed + polish.** ~1 week.
- Total **~3–4 weeks**. Demo test of the launchpad (create + mint) stays a
  separate, still-pending step and is not a blocker for this build.

## Open decisions (§8)

1. Listing model: escrow (recommended above) vs approval-based (NFT stays in
   the seller's wallet; offers cannot be guaranteed funded).
2. Indexer hosting: a VPS (~$5–20/month) — his call, and whose account it runs on.
3. Seed registry: Squeek + launchpad factory, plus any other collection he names.
4. Offers: ETH escrowed on-chain (recommended, simple, testnet-appropriate) vs
   off-chain signatures in the Seaport style (more complex, no escrow).
5. Same site (recommended) vs a separate marketplace site.

## Risks

- Contracts unaudited; testnet only, never mainnet with this code.
- Thin market: floors and bids will be empty until people actually list —
  floor per level only means something once listings exist.
- Indexer downtime = stale holders/floors/levels; the frontend must show how
  fresh its data is.
- Squeek levels depend entirely on Merge-event indexing; a gap in the backfill
  shows the wrong level.

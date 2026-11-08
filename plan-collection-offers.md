# Plan: collection offers + level-filtered offers + bulk accept

Status: **BUILT and verified 2026-11-07 ~12:30 WAT.** Forge 84/84 pass, frontend
`npm run build` clean. **Step 0 probe: the Squeek contract DOES expose
`level(uint256)`** (selector 0x05c58df2; level(67)=2, level(68)=2, level(1)=1,
level(70)=2; burned token reverts) — the marketplace enforces levels on-chain
(`WrongLevel` / `LevelNotSupported`); no level registry was needed.
**Integrated anvil verification (parent, real contracts + new indexer on real
events):** 10 ETH for 10 L2-only → top bid shows **1 ETH** (per item, not 10);
accepted on two L2 tokens (txs 0x6a887b0c…, 0xb3169b51…); L3 accept reverted
`WrongLevel(2, 3)`; batch `acceptCollectionOffers([2,2],[76,68])` sold two in
one tx (0x03e5b7cb…); batch `acceptOffers([1,2])` sold two per-token offers in
one tx (0xea3d6d06…); plain-collection any-level offer accepted, L2-only on it
reverted `LevelNotSupported`; indexer API served topBidWei 1 ETH, hasLevels,
matching offers per token (L2-only excluded from L3/L1 tokens), filled 2/10
and 2/100, volume 2.02 ETH. **Live VM indexer restarted on the new code**
(indexedBlock = latest, 0 gaps; new endpoint live, returns []). Nothing
deployed to Sepolia; no zip rebuilt — packaging is the parent's. What still
needs him: deploy the new marketplace (marketplace-deploy/, dry-run first),
then update VITE_MARKETPLACE_ADDRESS + indexer MARKETPLACE_ADDRESS, then a
browser check of the form + bulk accept against real Squeek tokens.
Related: `plan-marketplace.md` (existing marketplace), `plan-verified.md` (registry — deploy waits until this ships, so he installs one zip).

## 1. What IBRAHIM asked for (his words, restated)

Today you can only bid on one NFT at a time. He wants three things:

1. **Collection offers** — bid on a whole collection with a **total amount**
   for a number of items. The price per item is the total divided by the
   quantity. Example: offer 10 ETH for 10 Squeeks = **1 ETH each**; offer
   1 ETH for 100 Squeeks = **0.01 ETH each**. **10 (or 100) is only an
   example — there is no maximum quantity; a bidder may offer for 10, 50, 100
   or more items.** The top-bid display shows the **per-item price** (1 ETH,
   or 0.01 ETH), not the total. The offer stays open until the requested
   number of items have accepted it.
2. **Level-filtered offers** — for collections with levels (Squeek), choose a
   level when offering: bid only on L2 Squeeks, or only on L3. The offer goes
   to any NFT at that level. Example: he owns two L2 and one L3 Squeek; someone
   places 3 bids of 0.1 ETH on L2 only — he can accept only two of them, because
   the third NFT is L3 and the bid does not cover it. Collections without a
   level system get no level selector — just a plain collection offer.
3. **Bulk accept from Owned** — on the Owned tab, select the NFTs he wants to
   sell; a button appears below, e.g. "Accept 2 offers" / "Accept 3 offers",
   counting how many offers are available across the selected NFTs. One click
   accepts them.

## 2. How it works for the user

- **Collection page** gains a "Make a collection offer" form: **total offer
  (ETH)** + how many items (quantity), expiry in days (default 7), and — only
  when the collection has levels — a level selector ("Any level" / L1 / L2 /
  L3…). The form shows the per-item price live as you type ("1 ETH for 100
  Squeeks = 0.01 ETH each"). The total is what locks up front.
- **Top bid** on a collection (and on each token) shows the highest *per-item*
  price among live offers: per-token offers on that token, plus matching
  collection offers (a collection offer matches a token when the level matches
  or the offer is "any level", and the bidder does not own the token).
- **Token page** lists matching collection offers alongside per-token offers,
  labelled as collection offers (price per item, how many items are still
  wanted, level if any). The owner can accept a collection offer on that token
  exactly like a per-token offer.
- **Owned tab**: each card gets a checkbox. Selecting cards shows a button
  below the grid: "Accept N offer(s)", where N = the number of selected NFTs
  that have at least one live offer. Clicking it accepts the **highest-price**
  live offer on each of those NFTs (per-token or collection offer, whichever
  is higher). Accepting an offer still cancels that token's listing, as today.
- **Your Offers (dashboard)**: collection offers appear with price per item,
  items wanted, items filled so far, level, expiry, and a cancel button.
  Cancelling refunds the unfilled part: remaining items × price per item.

## 3. Contract changes (`SqueekMarketplace.sol` — new version)

New struct `CollectionOffer`: bidder, collection, totalPrice, pricePerItem,
quantity, filled, level (0 = any level), expiry, active.
`nextCollectionOfferId = 1`. **The bidder enters a TOTAL and a quantity; the
per-item price is total ÷ quantity** (10 ETH for 10 Squeeks = 1 ETH each;
1 ETH for 100 Squeeks = 0.01 ETH each).

- `makeCollectionOffer(collection, totalPrice, quantity, level, expiry)`
  payable. Requires totalPrice > 0, quantity ≥ 1 **with no upper limit**,
  expiry in the future, and `msg.value == totalPrice` (the whole amount is
  escrowed up front, so every acceptance is guaranteed to pay).
  `pricePerItem = totalPrice / quantity` (integer division). If the total
  does not divide evenly, the leftover dust (at most quantity − 1 wei) stays
  escrowed and returns to the bidder when the offer closes. Emits
  `CollectionOfferCreated`.
- `acceptCollectionOffer(collectionOfferId, tokenId)` — the caller must own the
  token (or be the seller of its active listing, same rule as `acceptOffer`
  today). The bidder may not accept on a token they own. Pays pricePerItem to
  the seller minus the ERC-2981 royalty, sends the NFT to the bidder, fills
  one slot (`filled += 1`). When `filled == quantity` the offer closes. Cancels
  the token's listing if any. Emits `CollectionOfferAccepted`.
- `cancelCollectionOffer(collectionOfferId)` — only the bidder (anyone may
  cancel it once expired). Refunds the unfilled part plus any division dust:
  `totalPrice - filled * pricePerItem`. Emits `CollectionOfferCancelled`.
- **Level enforcement — open question, probe first (step 0 below).** The
  contract must know a token's level at accept time, and levels today live
  only in Merge events read by the indexer — the contract cannot see them.
  Step 0 of the build: probe the Squeek contract on Sepolia for a level
  getter (`levelOf` / `getLevel` / `tokenLevel` / `levels`, plus its Etherscan
  ABI). If one exists, the marketplace reads it directly in
  `acceptCollectionOffer` and reverts on a wrong level. If none exists, the
  fallback is indexer-only filtering (the site shows a level offer only on
  tokens at that level) and the contract accepts any token for that offer —
  a documented trust gap, not a silent one. A third option, only if he wants
  it: a tiny on-chain level registry updated from Merge events. Do not build
  the registry unless the probe fails AND he asks for it.
- **Batch accept** (for the Owned bulk button): `acceptOffers(uint256[]
  offerIds)` loops the existing per-token accept logic, and
  `acceptCollectionOffers(uint256[] collectionOfferIds, uint256[] tokenIds)`
  loops the collection accept logic. One transaction per click instead of one
  per NFT. Both nonReentrant; a single failing accept reverts the whole batch
  (all-or-nothing, so no half-sold selection).
- Unchanged: listings, per-token offers, `buy`, royalties (ERC-2981, 0% fee),
  no owner/admin. New events only; no changes to existing function signatures.

## 4. Indexer changes

- New table `collection_offers` (id, collection, bidder, totalPriceWei,
  pricePerItemWei, quantity, filled, level, expiry, active, createdBlock,
  closedBlock, closedReason) + indexes on (collection, active) and (bidder,
  active).
  Migration via the same ALTER TABLE pattern used for `sales.blockTimestamp`.
- Index the three new events (`CollectionOfferCreated` /
  `CollectionOfferAccepted` / `CollectionOfferCancelled`) in `processLogs`;
  `filled` increments on each accept; the offer closes when filled ==
  quantity, on cancel, or on expiry (expiry is evaluated at read time, as
  per-token offers are today).
- API: `/collections/:address` gains `topBidWei` (highest per-item price among
  live per-token offers on any token + live collection offers); token
  endpoints gain `offers` including matching collection offers (flagged
  `kind: "collection"`, with pricePerItem, remaining, level); a new
  `/collections/:address/collection-offers` lists live collection offers;
  `/owners/:address/offers` includes the bidder's collection offers with
  filled/remaining.
- Level data already exists (`tokens.level` from Merge events) — the API uses
  it to decide which collection offers match which tokens, and to offer the
  level selector only for collections where levels are present.

## 5. Frontend changes

- `CollectionPage.tsx`: "Make a collection offer" form (per-item price,
  quantity, expiry, level selector when the collection has levels); top bid
  shows the per-item price; a "Collection offers" section lists live ones
  (price per item, wanted/filled, level, bidder, expiry, cancel for own).
- `TokenPage.tsx` / `TradeBox.tsx`: matching collection offers appear in the
  offers list with a "Collection offer" label; accept works the same way.
- Owned tab: checkboxes on cards; a sticky button below the grid appears when
  ≥1 selected NFT has an offer — "Accept N offer(s)". Clicking it sends the
  batch transaction(s) and shows per-NFT success/failure.
- Dashboard: "Your offers" gains the collection offers with filled/remaining.
- `marketplace-config.ts` / hooks: new reads for collection offers and top
  bid; `useVerified` pattern reused (direct chain reads where the indexer
  does not have the data yet).

## 6. Deployment — the marketplace contract is redeployed

This is a contract change, so the current marketplace
(`0xbc686382758998dE68A065DBBd1a48b74C8880b8`) cannot be upgraded in place.
A new marketplace is deployed (same local-run deploy flow), and
`VITE_MARKETPLACE_ADDRESS` (frontend `.env`) + `MARKETPLACE_ADDRESS`
(indexer `.env`) are updated to the new address. **Nothing migrates and
nothing is lost: there are zero listings and zero offers on the current
marketplace**, so the redeploy costs only gas. The verified registry is a
separate contract and is unaffected — its deploy still waits for this to ship
so he installs one zip (v6) and deploys once.

## 7. Verification (before delivery)

- `forge test`: new tests for the collection offer lifecycle (create with
  exact escrow, partial fills, full fill closes the offer, cancel refunds the
  unfilled part, wrong-level accept reverts when the getter exists, bidder
  cannot accept on their own token, batch accept all-or-nothing, expiry).
  Full suite must pass.
- Anvil fixture with real contracts: place a collection offer (1 ETH × 3, L2
  only), accept it on two L2 tokens and confirm the third (L3) cannot accept
  it; confirm the top bid shows 1 ETH; bulk-accept two offers from Owned in
  one transaction; confirm a plain collection offer (no level) works on a
  collection without levels. Previews saved under `marketplace-preview/`.
- State honestly what was verified on anvil vs what needs his Sepolia deploy
  and browser.

## 8. Open decisions (defaults in the plan — correct me if wrong)

1. **A higher competing offer does not remove an existing offer** — it only
   outranks it in the top-bid display. The old offer stays open until it is
   filled, cancelled, or expires. (His words: the offer "won't disappear until
   10 squeek nft accepted the offer or an offer higher than that shows up" —
   read as: the *top bid* changes when a higher offer shows up, not that the
   old offer is deleted. If he meant auto-removal, say so.)
2. **Bulk accept takes the highest-price offer per NFT** (per-token or
   collection, whichever pays more).
3. **Level enforcement** depends on the step-0 probe of the Squeek contract;
   if no on-chain level getter exists, the site filters by level and the
   contract does not enforce it (documented, not hidden).
4. **Expiry** for collection offers works like per-token offers (default 7
   days, anyone may cancel once expired, bidder may cancel anytime).
5. **No minimum quantity** (quantity ≥ 1) and no maximum set in v1.

## 9. What this does NOT include

- No WETH — collection offers are plain Sepolia ETH, like everything else.
- No changes to listings, the launchpad factory, the verified registry, or
  the swap/profile phases.
- No migration of the old marketplace's state (nothing to migrate).

# Squeekchain NFT Launchpad + Marketplace — v2 delivery

Sepolia testnet only (chain 11155111). Contracts unaudited, no mainnet.

## What's new in v10 (2026-11-07) — MARKETPLACE V3, REDEPLOY REQUIRED

1. **Listings now expire.** Listings take a price AND a duration (days,
   default 30). A listing can no longer be bought after it expires, and it
   shows "expires in Xd". An expired listing's NFT stays in escrow until
   you cancel, re-list, or accept an offer on it — and re-listing after
   expiry works straight from escrow, no separate cancel needed.
2. **Price + duration up front.** On the token page, the price and days
   fields now sit ABOVE the Approve button, so the amount is set first.
3. **Owned tab: List NFT + Accept offer.** Selecting NFTs you hold now
   shows both actions side by side. List takes one price + duration for
   all selected NFTs and lists them together (approve once per collection
   first, then one list per NFT, with per-NFT results). Already-listed
   NFTs are skipped with a note.

**Redeploy required:** the site now calls the 4-argument `list()` and
reads a 6-field listing, so it will NOT work against the live v2
marketplace. Deploy v3 with the existing script, then update three
things (details in "Deploy v3" below). The deploy script needs no
change — same command as v2.

**What the move costs — read before deploying:**
- Volume restarts at 0 on v3. The two v2 sales (0.02 ETH total) stay
  on-chain on the old contract but the v3 site does not count them.
- Live v2 offers do not carry over. There is one live v2 collection
  offer (0.006 ETH, Level 2 only, from 0x3ade, ~6 days left): its
  0.006 ETH stays locked in the old contract until the offer expires,
  then it can be cancelled (anyone may cancel an expired offer; the
  refund goes to the bidder). Nothing is lost, just parked for ~6 days.
- No v2 listings exist yet, so nothing listed is stranded.

## Deploy v3 (one job — only if you want the v10 features)

1. Stop the site and the indexer.
2. Extract the zip into `squeekchain-launchpad`, choose **Replace**.
   Your `.env` files and the indexer's database aren't in the zip.
3. In `marketplace-deploy/`: `npm run deploy:dry`, then `npm run deploy`.
   Send the new marketplace address + tx hash for a live check.
4. Update the address in TWO places (old v2 address out, new v3 in):
   - `frontend/.env`: `VITE_MARKETPLACE_ADDRESS=<new v3 address>`
   - `indexer/.env`: `MARKETPLACE_ADDRESS=<new v3 address>`
5. In `indexer/src/rewind.mjs`, update the two constants at the top to
   the v3 address and its deploy block (they still say v2). No rewind
   run is needed after a v3 deploy — there is no v3 history to recover.
6. Start the indexer (`npm start` from `indexer/`), then the site
   (`npm install`, then `npm run dev` from `frontend/`).

If you would rather keep v2 (volume 0.02 + the live offer stay as they
are), stay on the v9 zip and do not deploy v3 — but the v10 list
features will not work against v2.

What's in v9 (kept): Accept enables itself after approval; "List it"
form appears after approval; reverted approvals can't show "Confirmed!".
What's in v8 (kept): indexer rewind command + failed blocks retry
instead of skipping; level offers up to L10.
What's in v7 (kept): "Switch to Sepolia testnet" header button /
"Sepolia ✓" pill, spend buttons disabled off Sepolia, collection-offer
id crash fix.

## What is in this package

- `frontend/` — the site (Vite + React + viem/wagmi). NO `.env` included: your
  existing `frontend/.env` stays as it is — extracting this zip does not touch it.
- `abi/` — ABIs for the factory, collection implementation and marketplace.
- `marketplace-deploy/` — the script that deployed the marketplace (already deployed).
- `indexer/` — the Node + SQLite indexer that feeds floors, holders, listings and
  levels to the site. NO database included: your existing `indexer/data/indexer.db`
  stays as it is.
- No `node_modules/`, no `dist/`, no `.env` files.

## Deployed contracts (Sepolia)

- Factory: `0x9Ba898622E30E2eB88B26143c6b1070789A5390f`
- Marketplace: `0xbc686382758998dE68A065DBBd1a48b74C8880b8`
- Squeek collection: `0xC4c7982657f00509548F3a3a41db7FA439a6856B`

## Install (on your Windows machine)

Extract this zip into:

`C:\Users\SADIQ\Downloads\Telegram Desktop\Sepolia deploy package\squeekchain-launchpad`

When Windows asks about files that already exist, choose **Replace the files in the
destination**. Your `.env` files and the indexer's database are NOT in this zip, so
they are not touched.

Then run the three jobs (three separate PowerShell windows):

**Job 1 — the site** (stop the old one first with Ctrl+C):
```
cd C:\Users\SADIQ\Downloads\Telegram Desktop\Sepolia deploy package\squeekchain-launchpad\frontend
npm install
npm run dev
```
Open http://localhost:5173 — hard refresh (Ctrl+Shift+R) if the old page shows.

**Job 2 — the indexer** (stop the old one first with Ctrl+C):
```
cd C:\Users\SADIQ\Downloads\Telegram Desktop\Sepolia deploy package\squeekchain-launchpad\indexer
npm install
npm start
```
Leave it running while you use the site. First start backfills Sepolia history and
takes a few minutes; after that it follows new blocks every 12 seconds.

**Job 3 (done already) — the marketplace contract** is deployed; nothing to run.

## Your .env files (already set — do not change)

`frontend/.env`:
```
VITE_NETWORK=sepolia
VITE_FACTORY_ADDRESS=0x9Ba898622E30E2eB88B26143c6b1070789A5390f
VITE_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
VITE_MARKETPLACE_ADDRESS=0xbc686382758998dE68A065DBBd1a48b74C8880b8
```

`indexer/.env` (copy `.env.example` to `.env` first if needed):
```
RPC_URL=https://sepolia.gateway.tenderly.co
MARKETPLACE_ADDRESS=0xbc686382758998dE68A065DBBd1a48b74C8880b8
```

## How to test the new pages

1. **Marketplace** → click the **SQUEEK** card → the collection page opens on the
   ITEMS tab: stats row (floor, listed, holders, tokens, total volume 0 ETH,
   24h volume 0 ETH), tabs ITEMS / OWNED / HOLDERS / ACTIVITY, and the item
   grid. Token #68 shows its real art, "LEVEL 2", "Not listed", "0 offers"
   and a MAKE OFFER button.
2. Click the **HOLDERS** tab → the holders list appears (wallet addresses with
   token counts). Click back to ITEMS → it disappears again.
3. Click the **OWNED** tab → your own items in the Squeek collection (your #68).
4. Click **MAKE OFFER** on #68 → the token page opens scrolled to the TRADE box,
   where you can place a bid (price in ETH + expiry in days, default 7).
5. **Dashboard** → your #68 card now shows its art; clicking "Squeek (SQUEEK)"
   under it goes to the collection page.

## Known notes

- The Squeek grid fetches the first 100 tokens by ID; each token's on-chain
  metadata is ~100 KB, so the first load of the Squeek collection page can be
  slow on a public RPC. If a card's art is slow to appear it falls back to a
  `#N` placeholder — that is the fallback, not an error.
- The Demo Squeeks collection still has to be created (Create page, wallet on
  Sepolia, check the popup says Sepolia before confirming), then mint + list one
  to see the first floor price.
- The indexer on this package only tracks the Squeek collection plus collections
  created by the launchpad factory.
- The VM indexer on port 3001 is temporary; continuous running needs a VPS.

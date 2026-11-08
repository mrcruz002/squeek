# Squeekchain Marketplace Indexer v1

Indexes NFT collections on Sepolia (chain 11155111) for the marketplace
site: current owner per token, Squeek levels from Merge events, and (once
the marketplace contract is deployed) listings, offers, and sales. Serves
a small JSON REST API the Vite frontend can call.

## What it tracks

- **Transfer events** on every tracked collection — current owner per
  `(collection, tokenId)`. Mint = transfer from `0x0`; burn = transfer to
  `0x0` (token no longer exists).
- **Merge events** on the Squeek collection only
  (`0x8a9b1a00…`, topics `[topic0, survivor, donor]`, data word 1 = the
  survivor's new level). Every Squeek starts at Level 1; a merge sets the
  survivor's level and marks the donor burned. Data word 2's meaning is
  not established — it is decoded and deliberately ignored, never stored.
- **Marketplace events** (`ListingCreated/Cancelled/Sold`,
  `OfferCreated/Cancelled/Accepted`) — only when `MARKETPLACE_ADDRESS`
  is set. Topic hashes are computed from the ABI at
  `../abi/SqueekMarketplace.json`, not hardcoded.
- **Registry**: seeded with the Squeek collection
  (`0xC4C7982657f00509548F3a3a41db7FA439a6856B`) plus the launchpad
  factory (`0x9Ba898622E30E2eB88B26143c6b1070789A5390f`). At startup and
  on every sync tick it reads the factory (`collectionCount` +
  `allCollections(i)`) and auto-tracks any new factory collection,
  catching up its history from `START_BLOCK`.
- **Name/symbol** via `eth_call` (`name()`, `symbol()`); stored as null
  if the call fails. **totalSupply** is counted from distinct live
  tokenIds seen in Transfer events — no `totalSupply()` call is trusted
  (Squeek may not have one).

## Run it

```bash
cd ~/workspace/squeekchain-launchpad/indexer
npm install
npm start
```

That runs the backfill (from `START_BLOCK`, 10,000-block chunks) and then
the live sync poll plus the API server, all in one process. The API
listens on `http://localhost:3001` by default.

Copy `.env.example` to `.env` to override anything. Env vars:

| Var | Default | Meaning |
| --- | --- | --- |
| `RPC_URL` | `https://sepolia.gateway.tenderly.co` | RPC for backfill + sync. Tenderly serves historical Sepolia logs; the publicnode Sepolia RPC prunes old log history, so do not use it for backfill. |
| `PORT` | `3001` | API port |
| `START_BLOCK` | `12055000` | First block backfilled (zero Squeek activity before it) |
| `MARKETPLACE_ADDRESS` | _(empty)_ | Marketplace contract; empty = skip marketplace events |
| `DB_PATH` | `./data/indexer.db` | SQLite file (persists across restarts) |
| `POLL_MS` | `12000` | Live-sync poll interval |

## API

JSON; addresses lowercase hex; prices as decimal wei strings plus an
`priceEth` string (e.g. `"1000000000000000000"` / `"1.0"`). Errors are
`{ "error": "..." }` (500 on DB/API error, 404 `{ "error": "not found" }`
for an unknown collection/token). CORS is allow-all so
`localhost:5173` can call it directly.

| Endpoint | Returns |
| --- | --- |
| `GET /status` | `{ chainId, latestBlock, indexedBlock, indexedBlockHash, collectionsTracked, tokensTracked, ok, startedAt, gaps: [] }` |
| `GET /collections` | `[{ address, name, symbol, kind, totalSupply, holders, listedCount, floorWei, floorEth, floorByLevel }]` — floor = lowest active listing; `floorByLevel` only for Squeek; floor fields null when nothing is listed |
| `GET /collections/:address` | Same object plus `activity` (last 20 events) |
| `GET /collections/:address/holders` | `[{ holder, tokenCount, tokenIds: ["67","68"] }]` sorted by tokenCount desc, then holder asc; capped at 500 holders |
| `GET /collections/:address/tokens?limit=100&offset=0` | Live tokens only, tokenId asc: `[{ tokenId, owner, level, listing, offerCount }]`; `listing` is `{ listingId, seller, priceWei, priceEth }` or null |
| `GET /collections/:address/listings` | Active listings `[{ listingId, tokenId, seller, priceWei, priceEth, createdBlock }]` |
| `GET /collections/:address/activity?limit=50` | Recent activity for the collection, newest first |
| `GET /tokens/:collection/:tokenId` | `{ collection, tokenId, owner, level, burned, listing, offers: [{ offerId, bidder, priceWei, priceEth, expiry, expiresInSec }] }` (active offers, highest price first). 404 when the token was never seen |
| `GET /owners/:address/nfts` | `[{ collection, tokenId, level, listing }]` across all tracked collections |
| `GET /owners/:address/listings` | Active listings where seller = address |
| `GET /owners/:address/offers` | Active offers where bidder = address |
| `GET /activity?limit=50` | Recent activity across all collections, newest first |

## Database (SQLite, `data/indexer.db`)

- `collections(address PK, name, symbol, kind, firstSeenBlock, totalSupplyLive)` — kind is `'squeek'`, `'launchpad'`, or `'registry'`
- `tokens(collection, tokenId, owner, level NULL, burned 0/1, firstSeenBlock, lastSeenBlock, PK(collection, tokenId))`
- `listings(listingId PK, collection, tokenId, seller, priceWei TEXT, active, createdBlock, closedBlock NULL, closedReason NULL)`
- `offers(offerId PK, collection, tokenId, bidder, priceWei TEXT, expiry, active, createdBlock, closedBlock NULL, closedReason NULL)`
- `sales(id PK autoincrement, collection, tokenId, buyer, seller, priceWei TEXT, royaltyWei TEXT, blockNumber, txHash)`
- `activity(id PK autoincrement, type, collection, tokenId NULL, actor NULL, priceWei TEXT NULL, blockNumber, txHash, logIndex)`
- `sync_state(id PK always 1, lastBlock, lastBlockHash, updatedAt)`

## Running it continuously (VPS)

The DB file persists in `./data/indexer.db` — backfill only runs for
blocks not yet indexed, so a restart resumes from the stored cursor.
Example systemd unit (run as your user, adjust paths):

```ini
[Unit]
Description=Squeekchain marketplace indexer
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/squeekchain-launchpad/indexer
ExecStart=/usr/bin/node src/index.mjs
Restart=on-failure
RestartSec=10
# Optional overrides (defaults already work):
# Environment=RPC_URL=https://sepolia.gateway.tenderly.co
# Environment=MARKETPLACE_ADDRESS=0x...

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now squeekchain-indexer
sudo journalctl -u squeekchain-indexer -f
```

When the marketplace contract is deployed, set `MARKETPLACE_ADDRESS` in
`.env` (or the unit's `Environment=`) and restart; the indexer backfills
marketplace events from `START_BLOCK` on the next start only if the DB
is fresh — if the DB already has a cursor past the contract's deploy
block, delete `data/indexer.db` (and its `-wal`/`-shm` files) and restart
for a full re-backfill. Alternatively leave the DB alone: listings made
after the restart are indexed live.

## Known limitations

- **Reorg handling is minimal (v1):** before processing new blocks, the
  stored hash of the last indexed block is compared with the chain's hash
  at that height. On mismatch it rewinds 24 blocks — deleting activity,
  sales, and listings/offers created after the rewind point, reopening
  listings/offers closed after it, deleting tokens first seen after it —
  and reprocesses from there. This works because Transfer/Merge handlers
  set absolute values (owner / level / burned), not deltas. It does NOT
  handle: a token burned after the rewind point on the old chain but
  alive on the new chain with no post-rewind transfer (it stays marked
  burned), or a reorg deeper than 24 blocks (only the last 24 blocks
  are re-checked). Sepolia reorgs beyond a few blocks are rare; a
  deeper one needs a manual DB wipe + re-backfill.
- **Floors are empty until listings exist.** No marketplace contract is
  deployed yet, so `floorWei`/`floorEth` are null and `listedCount` is 0
  for every collection until listings are created on-chain.
- **Marketplace events only appear after `MARKETPLACE_ADDRESS` is set**
  and the contract is deployed (see the note above about re-backfill).
- **Gaps:** if a 10,000-block `eth_getLogs` chunk fails 3 times (1s / 2s /
  4s backoff), the range is recorded in `gaps` (visible in
  `GET /status`) and the sync cursor **stops there — it never advances
  past a failed chunk**. The next poll tick retries the same blocks, so
  a gateway outage can delay indexing but can no longer silently lose
  events. (Before this fix the cursor advanced past failed chunks,
  which lost the first live sale on 2026-11-07.)

## Recovering a missed sale (rewind)

If the volume or activity on the site is missing a sale that happened
on-chain, rewind the cursor and let the indexer re-read the window:

1. Stop the indexer (Ctrl+C in its terminal).
2. From the `indexer/` folder, run:
   `node src/rewind.mjs` — rewinds to block 12083424 (the marketplace
   v2 deploy block) and deletes everything indexed after it, so the
   next start re-indexes all marketplace v2 history. A different
   target block can be given: `node src/rewind.mjs 12084100`.
3. Start the indexer again: `npm start`.

The script refuses to run while the indexer is still up (it checks
the API port and the database lock) and refuses unless
`MARKETPLACE_ADDRESS` in `.env` is exactly the live marketplace v2
(`0x54F515b7fd201e73c0c33e7d351243546bAe4CeF`).
- **Holders endpoint caps at 500 holders** (sorted by token count).
  The Squeek collection currently has 1,073 holders, so the tail is
  cut off; use `/owners/:address/nfts` for a single holder.
- **New factory collections** discovered mid-sync get a catch-up
  backfill from `START_BLOCK`; collections not from the factory and not
  in the seed registry are not auto-discovered (registry additions need
  a code change for now).

// Chain indexer: backfills Transfer / Merge / marketplace logs from
// Sepolia in 10,000-block chunks, then polls for new blocks.
//
// Verified facts baked in here:
// - Squeek (ERC-721, NOT Enumerable) starts every token at Level 1.
// - Merge: topics [topic0, survivor (indexed), donor (indexed)];
//   data word 1 = survivor's NEW LEVEL (uint256). Data word 2's meaning
//   is NOT established, so it is decoded and deliberately ignored.
// - totalSupply is counted from live tokens seen in Transfer events;
//   no totalSupply() call is trusted (Squeek may not have one).
// - Public Sepolia RPC prunes old logs; default RPC is the Tenderly
//   gateway, which serves historical logs in 10k-block ranges.
import { ethers } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import {
  CHAIN_ID,
  CHUNK_BLOCKS,
  FACTORY_ADDRESS,
  INDEXER_ROOT,
  SQUEEK_ADDRESS,
  ZERO_ADDRESS,
  config,
} from './config.mjs';
import {
  getSyncState,
  recomputeAllSupplies,
  recomputeCollectionSupply,
  setSyncState,
} from './db.mjs';

const ERC721_IFACE = new ethers.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
]);
const FACTORY_IFACE = new ethers.Interface([
  'function collectionCount() view returns (uint256)',
  'function allCollections(uint256) view returns (address)',
]);
const TRANSFER_TOPIC = ERC721_IFACE.getEvent('Transfer').topicHash;
const MERGE_TOPIC =
  '0x8a9b1a009a32cc0082d2270e9033429b8e1aa3235e7b8198b013f603116a3c87';

let MARKETPLACE_IFACE = null;
let MARKETPLACE_TOPICS = new Map(); // topicHash -> event name
try {
  const abi = JSON.parse(
    fs.readFileSync(
      path.join(INDEXER_ROOT, '..', 'abi', 'SqueekMarketplace.json'),
      'utf8',
    ),
  );
  MARKETPLACE_IFACE = new ethers.Interface(abi);
  for (const frag of MARKETPLACE_IFACE.fragments) {
    if (frag.type === 'event') {
      MARKETPLACE_TOPICS.set(frag.topicHash, frag.name);
    }
  }
} catch (err) {
  console.warn(
    '[indexer] could not load SqueekMarketplace ABI, marketplace events disabled:',
    err.message,
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Indexer {
  constructor(db) {
    this.db = db;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.startedAt = new Date().toISOString();
    this.latestBlock = null;
    this.chainId = CHAIN_ID;
    this.gaps = []; // { fromBlock, toBlock, error } — ranges that failed after retries
    // Factory collections whose history catch-up failed partway: their
    // remaining chunks are retried on later poll ticks, never skipped.
    this.pendingCatchups = new Set();
    this.stats = {
      transfers: 0,
      merges: 0,
      marketplaceEvents: 0,
      firstSqueekActivityBlock: null,
      backfillStart: null,
      backfillEnd: null,
    };
    // Prepared statements
    this.stmt = {
      getCollection: db.prepare(
        'SELECT * FROM collections WHERE address = ?',
      ),
      insertCollection: db.prepare(
        `INSERT OR IGNORE INTO collections
         (address, name, symbol, kind, firstSeenBlock, totalSupplyLive)
         VALUES (?, ?, ?, ?, ?, 0)`,
      ),
      updateCollectionMeta: db.prepare(
        'UPDATE collections SET name = ?, symbol = ? WHERE address = ?',
      ),
      getToken: db.prepare(
        'SELECT * FROM tokens WHERE collection = ? AND tokenId = ?',
      ),
      upsertToken: db.prepare(
        `INSERT INTO tokens
           (collection, tokenId, owner, level, burned, firstSeenBlock, lastSeenBlock)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(collection, tokenId) DO UPDATE SET
           owner = excluded.owner,
           level = COALESCE(excluded.level, tokens.level),
           burned = excluded.burned,
           lastSeenBlock = excluded.lastSeenBlock`,
      ),
      setTokenLevel: db.prepare(
        'UPDATE tokens SET level = ?, lastSeenBlock = ? WHERE collection = ? AND tokenId = ?',
      ),
      setTokenBurned: db.prepare(
        'UPDATE tokens SET burned = 1, owner = ?, lastSeenBlock = ? WHERE collection = ? AND tokenId = ?',
      ),
      insertActivity: db.prepare(
        `INSERT INTO activity
           (type, collection, tokenId, actor, priceWei, blockNumber, txHash, logIndex)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      getListing: db.prepare(
        'SELECT * FROM listings WHERE listingId = ?',
      ),
      insertListing: db.prepare(
        `INSERT OR IGNORE INTO listings
           (listingId, collection, tokenId, seller, priceWei, expiry, active, createdBlock)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      ),
      closeListing: db.prepare(
        `UPDATE listings SET active = 0, closedBlock = ?, closedReason = ?
         WHERE listingId = ?`,
      ),
      getOffer: db.prepare('SELECT * FROM offers WHERE offerId = ?'),
      insertOffer: db.prepare(
        `INSERT OR IGNORE INTO offers
           (offerId, collection, tokenId, bidder, priceWei, expiry, active, createdBlock)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      ),
      closeOffer: db.prepare(
        `UPDATE offers SET active = 0, closedBlock = ?, closedReason = ?
         WHERE offerId = ?`,
      ),
      getCollectionOffer: db.prepare(
        'SELECT * FROM collection_offers WHERE id = ?',
      ),
      insertCollectionOffer: db.prepare(
        `INSERT OR IGNORE INTO collection_offers
           (id, collection, bidder, totalPriceWei, pricePerItemWei,
            quantity, level, expiry, active, createdBlock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      ),
      closeCollectionOffer: db.prepare(
        `UPDATE collection_offers SET active = 0, closedBlock = ?, closedReason = ?
         WHERE id = ?`,
      ),
      // filled is a counter: RETURNING gives the new count so the
      // handler can close the offer when filled == quantity.
      bumpCollectionOfferFilled: db.prepare(
        `UPDATE collection_offers SET filled = filled + 1 WHERE id = ?
         RETURNING filled, quantity`,
      ),
      insertSale: db.prepare(
        `INSERT INTO sales
           (collection, tokenId, buyer, seller, priceWei, royaltyWei, blockNumber, blockTimestamp, txHash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
    };
    // Block timestamps, fetched once per block that contains a sale
    // (for the 24h volume window). Sales are rare, so this stays cheap.
    this.blockTimestampCache = new Map();
  }

  // ---------- collections ----------

  trackedAddresses() {
    return this.db
      .prepare('SELECT address FROM collections')
      .all()
      .map((r) => r.address);
  }

  async fetchNameSymbol(address) {
    let name = null;
    let symbol = null;
    try {
      name = await this.provider.call({
        to: address,
        data: ERC721_IFACE.encodeFunctionData('name'),
      }).then((d) => ERC721_IFACE.decodeFunctionResult('name', d)[0]);
    } catch { /* leave null */ }
    try {
      symbol = await this.provider.call({
        to: address,
        data: ERC721_IFACE.encodeFunctionData('symbol'),
      }).then((d) => ERC721_IFACE.decodeFunctionResult('symbol', d)[0]);
    } catch { /* leave null */ }
    return { name, symbol };
  }

  async ensureCollection(address, kind, firstSeenBlock) {
    address = address.toLowerCase();
    const existing = this.stmt.getCollection.get(address);
    if (existing) return false;
    const { name, symbol } = await this.fetchNameSymbol(address);
    this.stmt.insertCollection.run(
      address, name, symbol, kind, firstSeenBlock,
    );
    console.log(
      `[indexer] tracking new collection ${address} (${name ?? '?'} / ${symbol ?? '?'}, kind=${kind})`,
    );
    return true;
  }

  async seedRegistry() {
    await this.ensureCollection(
      SQUEEK_ADDRESS, 'squeek', config.startBlock,
    );
    await this.discoverFactoryCollections();
  }

  async discoverFactoryCollections() {
    let count = 0n;
    try {
      const data = await this.provider.call({
        to: FACTORY_ADDRESS,
        data: FACTORY_IFACE.encodeFunctionData('collectionCount'),
      });
      count = FACTORY_IFACE.decodeFunctionResult('collectionCount', data)[0];
    } catch (err) {
      console.warn('[indexer] factory collectionCount call failed:', err.message);
      return [];
    }
    const found = [];
    const attempted = new Set();
    for (let i = 0n; i < count; i++) {
      try {
        const data = await this.provider.call({
          to: FACTORY_ADDRESS,
          data: FACTORY_IFACE.encodeFunctionData('allCollections', [i]),
        });
        const addr = FACTORY_IFACE.decodeFunctionResult(
          'allCollections', data,
        )[0].toLowerCase();
        const isNew = await this.ensureCollection(
          addr, 'launchpad', this.latestBlock ?? config.startBlock,
        );
        found.push(addr);
        if (isNew) {
          // Catch up on this collection's history from START_BLOCK.
          attempted.add(addr);
          const ok = await this.backfillRangeForAddress(
            addr,
            config.startBlock,
          );
          if (!ok) this.pendingCatchups.add(addr);
        }
      } catch (err) {
        console.warn(`[indexer] factory allCollections(${i}) failed:`, err.message);
      }
    }
    // Retry catch-ups that failed on earlier ticks. A failed chunk is
    // never skipped: without this, a collection whose catch-up failed
    // would keep a permanent hole in its early history.
    for (const addr of [...this.pendingCatchups]) {
      if (attempted.has(addr)) continue; // already tried this tick
      const ok = await this.backfillRangeForAddress(addr, config.startBlock);
      if (ok) this.pendingCatchups.delete(addr);
    }
    return found;
  }

  // ---------- log fetching ----------

  topic0Filter() {
    const topics = [TRANSFER_TOPIC, MERGE_TOPIC];
    for (const t of MARKETPLACE_TOPICS.keys()) topics.push(t);
    return topics;
  }

  async fetchLogs(fromBlock, toBlock, addresses) {
    const filter = {
      address: addresses,
      fromBlock,
      toBlock,
      topics: [this.topic0Filter()],
    };
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await this.provider.getLogs(filter);
      } catch (err) {
        lastErr = err;
        console.warn(
          `[indexer] getLogs ${fromBlock}-${toBlock} attempt ${attempt} failed: ${err.message}`,
        );
        await sleep(1000 * 2 ** (attempt - 1)); // 1s, 2s, 4s
      }
    }
    throw lastErr;
  }

  // ---------- event application (inside a DB transaction) ----------

  noteSqueekActivity(blockNumber) {
    if (
      this.stats.firstSqueekActivityBlock === null ||
      blockNumber < this.stats.firstSqueekActivityBlock
    ) {
      this.stats.firstSqueekActivityBlock = blockNumber;
    }
  }

  applyTransfer(log) {
    const collection = log.address.toLowerCase();
    const parsed = ERC721_IFACE.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (!parsed) return;
    const from = parsed.args.from.toLowerCase();
    const to = parsed.args.to.toLowerCase();
    const tokenId = parsed.args.tokenId.toString();
    const blockNumber = log.blockNumber;
    if (collection === SQUEEK_ADDRESS) this.noteSqueekActivity(blockNumber);
    this.stats.transfers++;

    const isSqueek = collection === SQUEEK_ADDRESS;
    if (from === ZERO_ADDRESS) {
      // Mint: every Squeek token starts at Level 1; others level NULL.
      this.stmt.upsertToken.run(
        collection, tokenId, to, isSqueek ? 1 : null, 0,
        blockNumber, blockNumber,
      );
      this.stmt.insertActivity.run(
        'mint', collection, tokenId, to, null,
        blockNumber, log.transactionHash, log.index,
      );
    } else if (to === ZERO_ADDRESS) {
      this.stmt.upsertToken.run(
        collection, tokenId, ZERO_ADDRESS, null, 1,
        blockNumber, blockNumber,
      );
      // upsertToken's level COALESCE keeps an existing level; a burn
      // must not resurrect one — the burned flag is what matters.
      this.stmt.insertActivity.run(
        'burn', collection, tokenId, from, null,
        blockNumber, log.transactionHash, log.index,
      );
    } else {
      this.stmt.upsertToken.run(
        collection, tokenId, to, null, 0,
        blockNumber, blockNumber,
      );
      this.stmt.insertActivity.run(
        'transfer', collection, tokenId, to, null,
        blockNumber, log.transactionHash, log.index,
      );
    }
  }

  applyMerge(log) {
    // Only the Squeek collection emits Merge. Topics: survivor, donor.
    // Data word 1 = survivor's NEW LEVEL. Data word 2 is NOT established
    // and is decoded only so the ABI decode succeeds — never stored.
    const collection = log.address.toLowerCase();
    if (collection !== SQUEEK_ADDRESS) return;
    const survivor = BigInt(log.topics[1]).toString();
    const donor = BigInt(log.topics[2]).toString();
    const [newLevel] = ethers.AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'uint256'],
      log.data,
    );
    const blockNumber = log.blockNumber;
    this.noteSqueekActivity(blockNumber);
    this.stats.merges++;

    const survivorRow = this.stmt.getToken.get(collection, survivor);
    if (survivorRow) {
      this.stmt.setTokenLevel.run(
        Number(newLevel), blockNumber, collection, survivor,
      );
    } else {
      this.stmt.upsertToken.run(
        collection, survivor, null, Number(newLevel), 0,
        blockNumber, blockNumber,
      );
    }
    const donorRow = this.stmt.getToken.get(collection, donor);
    if (donorRow) {
      this.stmt.setTokenBurned.run(
        ZERO_ADDRESS, blockNumber, collection, donor,
      );
    } else {
      this.stmt.upsertToken.run(
        collection, donor, ZERO_ADDRESS, null, 1,
        blockNumber, blockNumber,
      );
    }
    this.stmt.insertActivity.run(
      'merge', collection, survivor, null, null,
      blockNumber, log.transactionHash, log.index,
    );
  }

  applyMarketplace(log, blockTimestamps = new Map()) {
    if (!config.marketplaceAddress || !MARKETPLACE_IFACE) return;
    if (log.address.toLowerCase() !== config.marketplaceAddress) return;
    const eventName = MARKETPLACE_TOPICS.get(log.topics[0].toLowerCase());
    if (!eventName) return;
    const parsed = MARKETPLACE_IFACE.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (!parsed) return;
    const a = parsed.args;
    const blockNumber = log.blockNumber;
    const txHash = log.transactionHash;
    // Unix seconds when this block was mined, for the 24h volume window.
    // Null if the block header could not be fetched — the sale is still
    // recorded and counts toward total volume.
    const blockTimestamp = blockTimestamps.get(blockNumber) ?? null;
    this.stats.marketplaceEvents++;

    const act = (type, collection, tokenId, actor, priceWei) =>
      this.stmt.insertActivity.run(
        type, collection.toLowerCase(), tokenId, actor, priceWei,
        blockNumber, txHash, log.index,
      );

    switch (eventName) {
      case 'ListingCreated': {
        const collection = a.collection.toLowerCase();
        // v3 adds expiry (unix seconds); a v2 event has no expiry arg,
        // so a.expiry is undefined -> stored NULL (never expires).
        const expiry = a.expiry === undefined || a.expiry === null
          ? null
          : Number(a.expiry);
        this.stmt.insertListing.run(
          a.listingId.toString(), collection, a.tokenId.toString(),
          a.seller.toLowerCase(), a.price.toString(), expiry, blockNumber,
        );
        act('listing_created', collection, a.tokenId.toString(), a.seller.toLowerCase(), a.price.toString());
        break;
      }
      case 'ListingCancelled': {
        this.stmt.closeListing.run(blockNumber, 'cancelled', a.listingId.toString());
        act('listing_cancelled', a.collection, a.tokenId.toString(), a.seller.toLowerCase(), null);
        break;
      }
      case 'ListingSold': {
        const listing = this.stmt.getListing.get(a.listingId.toString());
        this.stmt.closeListing.run(blockNumber, 'sold', a.listingId.toString());
        this.stmt.insertSale.run(
          a.collection.toLowerCase(), a.tokenId.toString(),
          a.buyer.toLowerCase(), listing ? listing.seller : null,
          a.price.toString(), a.royaltyPaid.toString(), blockNumber, blockTimestamp, txHash,
        );
        act('listing_sold', a.collection, a.tokenId.toString(), a.buyer.toLowerCase(), a.price.toString());
        break;
      }
      case 'OfferCreated': {
        this.stmt.insertOffer.run(
          a.offerId.toString(), a.collection.toLowerCase(), a.tokenId.toString(),
          a.bidder.toLowerCase(), a.price.toString(), Number(a.expiry), blockNumber,
        );
        act('offer_created', a.collection, a.tokenId.toString(), a.bidder.toLowerCase(), a.price.toString());
        break;
      }
      case 'OfferCancelled': {
        this.stmt.closeOffer.run(blockNumber, 'cancelled', a.offerId.toString());
        act('offer_cancelled', a.collection, a.tokenId.toString(), a.bidder.toLowerCase(), null);
        break;
      }
      case 'OfferAccepted': {
        this.stmt.closeOffer.run(blockNumber, 'accepted', a.offerId.toString());
        this.stmt.insertSale.run(
          a.collection.toLowerCase(), a.tokenId.toString(),
          a.bidder.toLowerCase(), a.seller.toLowerCase(),
          a.price.toString(), a.royaltyPaid.toString(), blockNumber, blockTimestamp, txHash,
        );
        act('offer_accepted', a.collection, a.tokenId.toString(), a.bidder.toLowerCase(), a.price.toString());
        break;
      }
      case 'CollectionOfferCreated': {
        const collection = a.collection.toLowerCase();
        this.stmt.insertCollectionOffer.run(
          a.collectionOfferId.toString(), collection, a.bidder.toLowerCase(),
          a.totalPrice.toString(), a.pricePerItem.toString(),
          Number(a.quantity), Number(a.level), Number(a.expiry), blockNumber,
        );
        // Activity price is the per-item price — the unit the top bid
        // and the frontend compare against per-token offers.
        act('collection_offer_created', collection, null, a.bidder.toLowerCase(), a.pricePerItem.toString());
        break;
      }
      case 'CollectionOfferAccepted': {
        // Same sale/activity handling as a per-token OfferAccepted,
        // with pricePerItem as the sale price. The token's listing, if
        // any, is closed by the contract's own ListingCancelled event,
        // exactly as for per-token accepts.
        const bumped = this.stmt.bumpCollectionOfferFilled.get(
          a.collectionOfferId.toString(),
        );
        if (bumped && bumped.filled >= bumped.quantity) {
          this.stmt.closeCollectionOffer.run(
            blockNumber, 'filled', a.collectionOfferId.toString(),
          );
        }
        this.stmt.insertSale.run(
          a.collection.toLowerCase(), a.tokenId.toString(),
          a.bidder.toLowerCase(), a.seller.toLowerCase(),
          a.pricePerItem.toString(), a.royaltyPaid.toString(), blockNumber, blockTimestamp, txHash,
        );
        act('collection_offer_accepted', a.collection, a.tokenId.toString(), a.bidder.toLowerCase(), a.pricePerItem.toString());
        break;
      }
      case 'CollectionOfferCancelled': {
        this.stmt.closeCollectionOffer.run(
          blockNumber, 'cancelled', a.collectionOfferId.toString(),
        );
        act('collection_offer_cancelled', a.collection, null, a.bidder.toLowerCase(), null);
        break;
      }
      default:
        break;
    }
  }

  async fetchBlockTimestamp(blockNumber) {
    if (this.blockTimestampCache.has(blockNumber)) {
      return this.blockTimestampCache.get(blockNumber);
    }
    let ts = null;
    try {
      const blk = await this.provider.getBlock(blockNumber);
      ts = blk ? Number(blk.timestamp) : null;
    } catch (err) {
      console.warn(
        `[indexer] could not fetch timestamp for block ${blockNumber}: ${err.message}`,
      );
    }
    this.blockTimestampCache.set(blockNumber, ts);
    return ts;
  }

  async processLogs(logs) {
    // Logs arrive ordered by (block, logIndex) from the RPC; sort to be sure.
    const sorted = [...logs].sort(
      (x, y) => x.blockNumber - y.blockNumber || x.index - y.index,
    );
    // Sale events (ListingSold / OfferAccepted / CollectionOfferAccepted)
    // need their block's timestamp for the 24h volume window — fetch
    // each affected block once, before the transaction starts.
    const blockTimestamps = new Map();
    for (const log of sorted) {
      const name = MARKETPLACE_TOPICS.get(log.topics[0].toLowerCase());
      if (name !== 'ListingSold' && name !== 'OfferAccepted' && name !== 'CollectionOfferAccepted') continue;
      if (!blockTimestamps.has(log.blockNumber)) {
        blockTimestamps.set(
          log.blockNumber,
          await this.fetchBlockTimestamp(log.blockNumber),
        );
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const log of sorted) {
        const topic0 = log.topics[0].toLowerCase();
        if (topic0 === TRANSFER_TOPIC) this.applyTransfer(log);
        else if (topic0 === MERGE_TOPIC) this.applyMerge(log);
        else if (MARKETPLACE_TOPICS.has(topic0)) {
          this.applyMarketplace(log, blockTimestamps);
        }
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---------- backfill / sync ----------

  // Returns true when the whole range was processed, false when it
  // stopped early at a failed chunk. A failed chunk is NEVER skipped:
  // the sync cursor stays at the last good chunk, so the next poll
  // tick retries the same blocks. (Advancing past a failed chunk lost
  // the first live sale on 2026-11-07, when the gateway was timing out.)
  async processRange(fromBlock, toBlock) {
    if (fromBlock > toBlock) return true;
    const addresses = this.trackedAddresses();
    if (config.marketplaceAddress) addresses.push(config.marketplaceAddress);
    let cursor = fromBlock;
    while (cursor <= toBlock) {
      const chunkEnd = Math.min(cursor + CHUNK_BLOCKS - 1, toBlock);
      let logs;
      try {
        logs = await this.fetchLogs(cursor, chunkEnd, addresses);
      } catch (err) {
        this.gaps.push({ fromBlock: cursor, toBlock: chunkEnd, error: String(err.message ?? err) });
        console.error(`[indexer] GAP recorded ${cursor}-${chunkEnd}: ${err.message}`);
        return false;
      }
      if (logs.length > 0) await this.processLogs(logs);
      recomputeAllSupplies(this.db);
      const hash = await this.blockHash(chunkEnd);
      setSyncState(this.db, chunkEnd, hash);
      console.log(
        `[indexer] blocks ${cursor}-${chunkEnd}: ${logs.length} logs ` +
        `(transfers=${this.stats.transfers} merges=${this.stats.merges} mkt=${this.stats.marketplaceEvents})`,
      );
      cursor = chunkEnd + 1;
      await sleep(150);
    }
    return true;
  }

  async blockHash(blockNumber) {
    try {
      const blk = await this.provider.getBlock(blockNumber);
      return blk ? blk.hash.toLowerCase() : null;
    } catch {
      return null;
    }
  }

  // Returns true when the whole catch-up range was processed, false
  // when it stopped early at a failed chunk (same no-skip rule as
  // processRange: the caller retries the catch-up on a later tick).
  async backfillRangeForAddress(address, fromBlock) {
    // Catch-up for a newly discovered factory collection: fetch only its
    // own logs from START_BLOCK to the current indexed block.
    const state = getSyncState(this.db);
    const toBlock = state?.lastBlock ?? this.latestBlock ?? fromBlock;
    if (toBlock < fromBlock) return true;
    let cursor = fromBlock;
    while (cursor <= toBlock) {
      const chunkEnd = Math.min(cursor + CHUNK_BLOCKS - 1, toBlock);
      let logs = [];
      try {
        logs = await this.fetchLogs(cursor, chunkEnd, [address]);
      } catch (err) {
        this.gaps.push({ fromBlock: cursor, toBlock: chunkEnd, error: String(err.message ?? err) });
        console.error(`[indexer] GAP (catch-up ${address}) ${cursor}-${chunkEnd}: ${err.message}`);
        return false;
      }
      if (logs.length > 0) await this.processLogs(logs);
      cursor = chunkEnd + 1;
      await sleep(150);
    }
    recomputeCollectionSupply(this.db, address);
    return true;
  }

  async backfill() {
    const tip = await this.provider.getBlockNumber();
    this.latestBlock = tip;
    const state = getSyncState(this.db);
    const from = state?.lastBlock != null
      ? state.lastBlock + 1
      : config.startBlock;
    this.stats.backfillStart = from;
    this.stats.backfillEnd = tip;
    console.log(
      `[indexer] backfill ${from} -> ${tip} (${tip - from + 1} blocks)`,
    );
    const complete = await this.processRange(from, tip);
    if (complete) {
      console.log(
        `[indexer] backfill done. transfers=${this.stats.transfers} ` +
        `merges=${this.stats.merges} firstSqueekBlock=${this.stats.firstSqueekActivityBlock} ` +
        `gaps=${this.gaps.length}`,
      );
    } else {
      console.log(
        `[indexer] backfill incomplete — stopped at a failed chunk; ` +
        `will resume on the next poll tick. gaps=${this.gaps.length}`,
      );
    }
  }

  // Reorg check: compare the stored hash of the last indexed block with
  // the chain's hash at that height. On mismatch, rewind 24 blocks:
  // drop/undo everything after the rewind point and reprocess from there.
  // Token rows touched after the rewind point are re-settled by
  // reprocessing, because Transfer/Merge handlers set absolute values
  // (owner / level / burned), not deltas.
  async reorgCheck() {
    const state = getSyncState(this.db);
    if (!state?.lastBlock || !state.lastBlockHash) return false;
    const onChain = await this.blockHash(state.lastBlock);
    if (!onChain || onChain === state.lastBlockHash) return false;
    const rewind = Math.max(config.startBlock, state.lastBlock - 24);
    console.warn(
      `[indexer] REORG detected at block ${state.lastBlock} ` +
      `(stored ${state.lastBlockHash} != chain ${onChain}); rewinding to ${rewind}`,
    );
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM activity WHERE blockNumber > ?').run(rewind);
      this.db.prepare('DELETE FROM sales WHERE blockNumber > ?').run(rewind);
      this.db.prepare('DELETE FROM listings WHERE createdBlock > ?').run(rewind);
      this.db.prepare(
        `UPDATE listings SET active = 1, closedBlock = NULL, closedReason = NULL
         WHERE closedBlock > ?`,
      ).run(rewind);
      this.db.prepare('DELETE FROM offers WHERE createdBlock > ?').run(rewind);
      this.db.prepare(
        `UPDATE offers SET active = 1, closedBlock = NULL, closedReason = NULL
         WHERE closedBlock > ?`,
      ).run(rewind);
      this.db.prepare('DELETE FROM collection_offers WHERE createdBlock > ?').run(rewind);
      this.db.prepare(
        `UPDATE collection_offers SET active = 1, closedBlock = NULL, closedReason = NULL
         WHERE closedBlock > ?`,
      ).run(rewind);
      // filled is a counter (a delta), so a rewind must rebuild it from
      // the surviving accept activity — otherwise reprocessing the
      // rewound window would bump it twice. The match is (collection,
      // bidder, pricePerItem); a bidder with two live offers on one
      // collection at the same per-item price would merge their counts
      // in that degenerate case.
      this.db.prepare(
        `UPDATE collection_offers SET filled = (
           SELECT COUNT(*) FROM activity
           WHERE type = 'collection_offer_accepted'
             AND collection = collection_offers.collection
             AND actor = collection_offers.bidder
             AND priceWei = collection_offers.pricePerItemWei
             AND blockNumber <= ?
         ) WHERE createdBlock <= ?`,
      ).run(rewind, rewind);
      // Tokens first seen after the rewind point may not exist on the
      // new chain; reprocessing recreates them if they do.
      this.db.prepare('DELETE FROM tokens WHERE firstSeenBlock > ?').run(rewind);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    const hash = await this.blockHash(rewind);
    setSyncState(this.db, rewind, hash);
    recomputeAllSupplies(this.db);
    return true;
  }

  async syncOnce() {
    const tip = await this.provider.getBlockNumber();
    this.latestBlock = tip;
    const state = getSyncState(this.db);
    if (state?.lastBlock != null) {
      await this.reorgCheck();
    }
    const after = getSyncState(this.db);
    const from = after?.lastBlock != null
      ? after.lastBlock + 1
      : config.startBlock;
    if (from <= tip) {
      await this.processRange(from, tip);
    }
    await this.discoverFactoryCollections();
    // Refresh name/symbol for collections that failed the first lookup.
    for (const row of this.db
      .prepare('SELECT * FROM collections WHERE name IS NULL OR symbol IS NULL')
      .all()) {
      const { name, symbol } = await this.fetchNameSymbol(row.address);
      if (name !== null || symbol !== null) {
        this.stmt.updateCollectionMeta.run(
          name ?? row.name, symbol ?? row.symbol, row.address,
        );
      }
    }
    const now = getSyncState(this.db);
    if (now) setSyncState(this.db, now.lastBlock, now.lastBlockHash);
  }

  async startPolling() {
    const tick = async () => {
      try {
        await this.syncOnce();
      } catch (err) {
        console.error('[indexer] sync tick failed:', err.message);
      }
    };
    this._timer = setInterval(tick, config.pollMs);
  }

  stopPolling() {
    if (this._timer) clearInterval(this._timer);
  }
}

// SQLite storage (node:sqlite, built-in — no native build).
// tokenId is stored as TEXT (decimal string); order numerically with
// CAST(tokenId AS INTEGER). Prices are decimal wei STRINGS.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      address TEXT PRIMARY KEY,
      name TEXT,
      symbol TEXT,
      kind TEXT NOT NULL,
      firstSeenBlock INTEGER,
      totalSupplyLive INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tokens (
      collection TEXT NOT NULL,
      tokenId TEXT NOT NULL,
      owner TEXT,
      level INTEGER,
      burned INTEGER NOT NULL DEFAULT 0,
      firstSeenBlock INTEGER,
      lastSeenBlock INTEGER,
      PRIMARY KEY (collection, tokenId)
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_owner
      ON tokens (collection, owner, burned);
    CREATE INDEX IF NOT EXISTS idx_tokens_live
      ON tokens (collection, burned, tokenId);
    CREATE TABLE IF NOT EXISTS listings (
      listingId TEXT PRIMARY KEY,
      collection TEXT NOT NULL,
      tokenId TEXT NOT NULL,
      seller TEXT NOT NULL,
      priceWei TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      createdBlock INTEGER,
      closedBlock INTEGER,
      closedReason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_listings_token
      ON listings (collection, tokenId, active);
    CREATE INDEX IF NOT EXISTS idx_listings_seller
      ON listings (seller, active);
    CREATE TABLE IF NOT EXISTS offers (
      offerId TEXT PRIMARY KEY,
      collection TEXT NOT NULL,
      tokenId TEXT NOT NULL,
      bidder TEXT NOT NULL,
      priceWei TEXT NOT NULL,
      expiry INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      createdBlock INTEGER,
      closedBlock INTEGER,
      closedReason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_offers_token
      ON offers (collection, tokenId, active);
    CREATE INDEX IF NOT EXISTS idx_offers_bidder
      ON offers (bidder, active);
    CREATE TABLE IF NOT EXISTS collection_offers (
      id TEXT PRIMARY KEY,
      collection TEXT NOT NULL,
      bidder TEXT NOT NULL,
      totalPriceWei TEXT NOT NULL,
      pricePerItemWei TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      filled INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 0,
      expiry INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      createdBlock INTEGER,
      closedBlock INTEGER,
      closedReason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_collection_offers_collection
      ON collection_offers (collection, active);
    CREATE INDEX IF NOT EXISTS idx_collection_offers_bidder
      ON collection_offers (bidder, active);
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection TEXT NOT NULL,
      tokenId TEXT NOT NULL,
      buyer TEXT,
      seller TEXT,
      priceWei TEXT,
      royaltyWei TEXT,
      blockNumber INTEGER,
      blockTimestamp INTEGER,
      txHash TEXT
    );
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      collection TEXT NOT NULL,
      tokenId TEXT,
      actor TEXT,
      priceWei TEXT,
      blockNumber INTEGER,
      txHash TEXT,
      logIndex INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_activity_collection
      ON activity (collection, blockNumber DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_recent
      ON activity (blockNumber DESC, id DESC);
    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      lastBlock INTEGER,
      lastBlockHash TEXT,
      updatedAt TEXT
    );
  `);
  // Migration: sales gained blockTimestamp (for 24h volume). DBs created
  // before this column existed get it added once; old sales keep a NULL
  // timestamp and are excluded from the 24h window (they still count
  // toward total volume).
  const saleCols = db.prepare('PRAGMA table_info(sales)').all();
  if (!saleCols.some((c) => c.name === 'blockTimestamp')) {
    db.exec('ALTER TABLE sales ADD COLUMN blockTimestamp INTEGER');
  }
  // Migration: listings gained expiry (marketplace v3, unix seconds).
  // DBs created before this column existed get it added once; old rows
  // (v2 listings, which never expired) keep a NULL expiry and are
  // treated as never expiring everywhere they are read.
  const listingCols = db.prepare('PRAGMA table_info(listings)').all();
  if (!listingCols.some((c) => c.name === 'expiry')) {
    db.exec('ALTER TABLE listings ADD COLUMN expiry INTEGER');
  }
  return db;
}

export function getSyncState(db) {
  return db.prepare('SELECT * FROM sync_state WHERE id = 1').get();
}

export function setSyncState(db, lastBlock, lastBlockHash) {
  db.prepare(
    `INSERT INTO sync_state (id, lastBlock, lastBlockHash, updatedAt)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       lastBlock = excluded.lastBlock,
       lastBlockHash = excluded.lastBlockHash,
       updatedAt = excluded.updatedAt`,
  ).run(lastBlock, lastBlockHash, new Date().toISOString());
}

export function recomputeCollectionSupply(db, address) {
  db.prepare(
    `UPDATE collections SET totalSupplyLive = (
       SELECT COUNT(*) FROM tokens
       WHERE collection = ? AND burned = 0
     ) WHERE address = ?`,
  ).run(address, address);
}

export function recomputeAllSupplies(db) {
  for (const row of db
    .prepare('SELECT address FROM collections')
    .all()) {
    recomputeCollectionSupply(db, row.address);
  }
}

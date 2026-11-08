// Rewind the indexer cursor so a missed window is re-indexed from chain.
//
// Usage (from the indexer folder, with the indexer STOPPED):
//   node src/rewind.mjs [block]
//
// With no block argument it rewinds to 12088682, the block the live
// Sepolia marketplace v3 (0x552E31c7ffc23C839f7bf0957B7DBaA32C055a12) was
// deployed in — so all marketplace v3 history is re-indexed. This is
// the repair for a sale the indexer missed when the gateway was timing
// out: the old code advanced the sync cursor past failed chunks, so
// their events were silently lost.
//
// What it does (mirrors the reorgCheck cleanup in src/indexer.mjs):
//   - deletes activity / sales / listings / offers / collection_offers
//     rows after the target block, re-opens listings/offers closed
//     after it, rebuilds the collection-offer `filled` counters from
//     the surviving accept activity, and drops tokens first seen
//     after it — then sets the sync cursor to the target block with
//     the on-chain block hash at that height, and recomputes supplies.
//   - the next `npm start` re-indexes the rewound window from the RPC.
//
// Safety checks (all abort before touching anything):
//   - the indexer must be stopped: refuses if anything answering as
//     this indexer is listening on the configured port, and refuses
//     if the database is write-locked.
//   - MARKETPLACE_ADDRESS in .env must be exactly the live v3 address
//     — rewinding a database that tracks a different marketplace
//     would mix two contracts' history.
import { ethers } from 'ethers';
import { config } from './config.mjs';
import {
  getSyncState,
  openDb,
  recomputeAllSupplies,
  setSyncState,
} from './db.mjs';

const V3_MARKETPLACE = '0x552e31c7ffc23c839f7bf0957b7dbaa32c055a12';
const V3_DEPLOY_BLOCK = 12088682;

function fail(message) {
  console.error(`[rewind] ABORTED: ${message}`);
  process.exit(1);
}

function usage() {
  console.log(
    'Usage: node src/rewind.mjs [block]\n' +
      '\n' +
      'Rewinds the indexer cursor to [block] (default: ' +
      `${V3_DEPLOY_BLOCK}, the marketplace v3 deploy block) and deletes\n` +
      'everything indexed after it, so the next `npm start` re-indexes\n' +
      'that window from the chain.\n' +
      '\n' +
      'The indexer must be STOPPED first (Ctrl+C in its terminal).\n' +
      'MARKETPLACE_ADDRESS in .env must be the live v3 marketplace:\n' +
      `  ${V3_MARKETPLACE}`,
  );
}

const arg = process.argv[2];
if (arg === '--help' || arg === '-h') {
  usage();
  process.exit(0);
}

let target = V3_DEPLOY_BLOCK;
if (arg !== undefined) {
  if (!/^\d+$/.test(arg)) fail(`"${arg}" is not a block number.`);
  target = Number(arg);
}
if (target < config.startBlock) {
  fail(
    `target block ${target} is before START_BLOCK ${config.startBlock} — ` +
      'the indexer has no history before that block.',
  );
}

console.log(`[rewind] marketplace: ${config.marketplaceAddress || '(none set)'}`);
if (
  config.marketplaceAddress.toLowerCase() !== V3_MARKETPLACE
) {
  fail(
    'MARKETPLACE_ADDRESS in .env is not the live marketplace v3 ' +
      `(${V3_MARKETPLACE}). Rewinding a database that tracks a different ` +
      'marketplace would mix two contracts\' history. Set ' +
      'MARKETPLACE_ADDRESS to the v3 address first, or run this against ' +
      'the database that tracks v3.',
  );
}
console.log(`[rewind] DB: ${config.dbPath}`);
console.log(`[rewind] RPC: ${config.rpcUrl}`);

// Guard 1: refuse if the indexer is still running. It always serves
// its API on the configured port, so an answer on /status means it is up.
try {
  const res = await fetch(`http://127.0.0.1:${config.port}/status`, {
    signal: AbortSignal.timeout(2000),
  });
  const body = await res.json();
  if (body && typeof body.indexedBlock === 'number') {
    fail(
      `the indexer is still running on port ${config.port} ` +
        `(indexedBlock ${body.indexedBlock}). Stop it first (Ctrl+C in ` +
        'its terminal), then run this again.',
    );
  }
} catch (err) {
  if (err.name !== 'AbortError' && !/fetch failed|ECONNREFUSED/i.test(err.message ?? '')) {
    // A non-indexer answer or a parse failure: not the indexer, carry on.
    console.warn(`[rewind] note: /status check inconclusive (${err.message}) — continuing with the lock check.`);
  }
  // Connection refused / timeout: nothing listening, indexer is stopped.
}

let db;
try {
  db = openDb(config.dbPath);
} catch (err) {
  // SQLITE_BUSY here means another process (the indexer) is mid-write.
  if (/SQLITE_BUSY|database is locked/i.test(err.message ?? '')) {
    fail(
      `the database is locked (${err.message}). The indexer is probably ` +
        'still running — stop it first (Ctrl+C in its terminal), then ' +
        'run this again.',
    );
  }
  fail(
    `could not open the database (${err.message}). If the indexer is ` +
      'running, stop it first.',
  );
}

const state = getSyncState(db);
if (!state?.lastBlock) {
  db.close();
  fail('no sync state found — the indexer has never run; nothing to rewind.');
}
if (target > state.lastBlock) {
  db.close();
  fail(
    `target block ${target} is ahead of the current cursor ` +
      `(lastBlock ${state.lastBlock}) — there is nothing to rewind.`,
  );
}
if (target === state.lastBlock) {
  db.close();
  console.log(
    `[rewind] cursor is already at block ${target} — nothing to rewind.`,
  );
  process.exit(0);
}

// Guard 2: take the write lock. If another process (the indexer) holds
// it, this throws SQLITE_BUSY after the timeout instead of waiting.
db.exec('PRAGMA busy_timeout = 2000');
try {
  db.exec('BEGIN IMMEDIATE');
} catch (err) {
  db.close();
  fail(
    `the database is locked (${err.message}). The indexer is probably ` +
      'still running — stop it first (Ctrl+C in its terminal), then run ' +
      'this again.',
  );
}

console.log(
  `[rewind] rewinding cursor ${state.lastBlock} -> ${target} ...`,
);
const removed = {};
try {
  const del = (table, column) => {
    removed[table] = db
      .prepare(`DELETE FROM ${table} WHERE ${column} > ?`)
      .run(target).changes;
  };
  const reopen = (table) => {
    removed[`${table} (reopened)`] = db
      .prepare(
        `UPDATE ${table} SET active = 1, closedBlock = NULL, ` +
          `closedReason = NULL WHERE closedBlock > ?`,
      )
      .run(target).changes;
  };
  del('activity', 'blockNumber');
  del('sales', 'blockNumber');
  del('listings', 'createdBlock');
  reopen('listings');
  del('offers', 'createdBlock');
  reopen('offers');
  del('collection_offers', 'createdBlock');
  reopen('collection_offers');
  // filled is a counter (a delta): rebuild it from the surviving
  // accept activity, exactly like reorgCheck does, so reprocessing
  // the rewound window does not bump it twice.
  db.prepare(
    `UPDATE collection_offers SET filled = (
       SELECT COUNT(*) FROM activity
       WHERE type = 'collection_offer_accepted'
         AND collection = collection_offers.collection
         AND actor = collection_offers.bidder
         AND priceWei = collection_offers.pricePerItemWei
         AND blockNumber <= ?
     ) WHERE createdBlock <= ?`,
  ).run(target, target);
  // Tokens first seen after the target may not exist on the new chain;
  // reprocessing recreates them if they do.
  removed.tokens = db
    .prepare('DELETE FROM tokens WHERE firstSeenBlock > ?')
    .run(target).changes;
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  db.close();
  fail(`rewind failed mid-way, nothing was changed: ${err.message}`);
}

// On-chain block hash at the target height, for the reorg check.
// If the RPC is unreachable the hash stays null (with a warning) —
// the indexer re-checks it on its next tick; the rewind itself stands.
let hash = null;
try {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const block = await provider.getBlock(target);
  hash = block?.hash?.toLowerCase() ?? null;
} catch (err) {
  console.warn(
    `[rewind] WARNING: could not fetch the on-chain hash for block ` +
      `${target} (${err.message}) — cursor hash left null; the indexer ` +
      'will re-check it on its next tick.',
  );
}

setSyncState(db, target, hash);
recomputeAllSupplies(db);
db.close();

console.log('[rewind] done. Removed rows after block ' + target + ':');
for (const [table, count] of Object.entries(removed)) {
  console.log(`[rewind]   ${table}: ${count}`);
}
console.log(
  `[rewind] cursor is now ${target}` +
    (hash ? ` (hash ${hash})` : ' (hash unknown — see warning above)') +
    `. Start the indexer to re-index ${target + 1} -> tip: npm start`,
);

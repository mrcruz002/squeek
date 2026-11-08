// Entry: seed registry -> start API -> backfill -> live polling.
// One command: npm start
import { config } from './config.mjs';
import { openDb } from './db.mjs';
import { Indexer } from './indexer.mjs';
import { createServer } from './api.mjs';

const db = openDb(config.dbPath);
const indexer = new Indexer(db);

console.log('[indexer] Squeekchain marketplace indexer v1');
console.log(`[indexer] RPC: ${config.rpcUrl}`);
console.log(`[indexer] DB: ${config.dbPath}`);
console.log(
  `[indexer] startBlock=${config.startBlock} ` +
  `marketplace=${config.marketplaceAddress || '(not deployed — marketplace events skipped)'} ` +
  `pollMs=${config.pollMs}`,
);

createServer(db, indexer);

try {
  await indexer.seedRegistry();
  await indexer.backfill();
} catch (err) {
  console.error('[indexer] backfill failed:', err);
  process.exitCode = 1;
}

indexer.startPolling();
console.log('[indexer] live sync polling started');

process.on('SIGINT', () => {
  console.log('\n[indexer] shutting down');
  indexer.stopPolling();
  db.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  indexer.stopPolling();
  db.close();
  process.exit(0);
});

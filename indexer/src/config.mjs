// Config: env vars with defaults. Loads a local .env file if present
// (tiny parser, no dotenv dependency). Relative DB_PATH resolves
// against the indexer folder, not the caller's cwd.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const INDEXER_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function loadDotEnv() {
  const envPath = path.join(INDEXER_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

loadDotEnv();

function envInt(name, def) {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : def;
}

export const config = {
  rpcUrl:
    process.env.RPC_URL || 'https://sepolia.gateway.tenderly.co',
  port: envInt('PORT', 3001),
  startBlock: envInt('START_BLOCK', 12055000),
  marketplaceAddress: (process.env.MARKETPLACE_ADDRESS || '')
    .trim()
    .toLowerCase(),
  dbPath: path.resolve(
    INDEXER_ROOT,
    process.env.DB_PATH || './data/indexer.db',
  ),
  pollMs: envInt('POLL_MS', 12000),
};

export const CHAIN_ID = 11155111;
export const SQUEEK_ADDRESS =
  '0xc4c7982657f00509548f3a3a41db7fa439a6856b';
export const FACTORY_ADDRESS =
  '0x9ba898622e30e2eb88b26143c6b1070789a5390f';
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const CHUNK_BLOCKS = 10000;

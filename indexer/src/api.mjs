// REST API (node:http, no framework). JSON everywhere; addresses are
// lowercase hex; prices are decimal wei STRINGS plus a numeric eth string.
import http from 'node:http';
import { ethers } from 'ethers';
import { CHAIN_ID, config } from './config.mjs';
import { getSyncState } from './db.mjs';

const isAddr = (s) => /^0x[0-9a-fA-F]{40}$/.test(s ?? '');

function pricePair(priceWei) {
  if (priceWei === null || priceWei === undefined) {
    return { priceWei: null, priceEth: null };
  }
  return {
    priceWei: String(priceWei),
    priceEth: ethers.formatEther(BigInt(priceWei)),
  };
}

function floorPair(row) {
  if (!row || row.floorWei === null || row.floorWei === undefined) {
    return { floorWei: null, floorEth: null };
  }
  return {
    floorWei: String(row.floorWei),
    floorEth: ethers.formatEther(BigInt(row.floorWei)),
  };
}

function clampInt(v, def, min, max) {
  const n = Number.parseInt(v ?? '', 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function createServer(db, indexer) {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'GET') {
      send(res, 405, { error: 'method not allowed' });
      return;
    }
    try {
      route(db, indexer, req, res);
    } catch (err) {
      console.error('[api] error:', err);
      send(res, 500, { error: String(err.message ?? err) });
    }
  });
  server.listen(config.port, () => {
    console.log(`[api] listening on http://localhost:${config.port}`);
  });
  return server;
}

function send(res, status, obj) {
  res.writeHead(status);
  res.end(JSON.stringify(obj));
}

function notFound(res) {
  send(res, 404, { error: 'not found' });
}

function collectionSummary(db, row) {
  const address = row.address;
  // Listings past expiry do not count: a v3 listing is only live while
  // expiry is NULL (legacy v2 row, which never expired) or in the future.
  // The same predicate is used for listedCount, floor, floorByLevel,
  // activeListingFor and every listings endpoint below.
  const nowSec = Math.floor(Date.now() / 1000);
  const holders = db
    .prepare(
      `SELECT COUNT(DISTINCT owner) AS n FROM tokens
       WHERE collection = ? AND burned = 0 AND owner IS NOT NULL`,
    )
    .get(address).n;
  const listedCount = db
    .prepare(
      'SELECT COUNT(*) AS n FROM listings WHERE collection = ? AND active = 1 AND (expiry IS NULL OR expiry > ?)',
    )
    .get(address, nowSec).n;
  const floor = db
    .prepare(
      `SELECT CAST(MIN(CAST(priceWei AS INTEGER)) AS TEXT) AS floorWei FROM listings
       WHERE collection = ? AND active = 1 AND (expiry IS NULL OR expiry > ?)`,
    )
    .get(address, nowSec);
  // Trading volume comes from completed sales (ListingSold and
  // OfferAccepted events). Sums are CAST to TEXT first, as with floors —
  // a wei sum over the JS safe-integer limit would otherwise throw.
  // 24h is by block time: sales whose block timestamp is within the
  // last 86,400 seconds. Sales recorded before timestamps were stored
  // (NULL) count toward total volume only.
  const totalVolume = db
    .prepare(
      `SELECT CAST(COALESCE(SUM(CAST(priceWei AS INTEGER)), 0) AS TEXT) AS totalWei
       FROM sales WHERE collection = ?`,
    )
    .get(address);
  const cutoffSec = Math.floor(Date.now() / 1000) - 86400;
  const volume24h = db
    .prepare(
      `SELECT CAST(COALESCE(SUM(CAST(priceWei AS INTEGER)), 0) AS TEXT) AS totalWei
       FROM sales WHERE collection = ? AND blockTimestamp IS NOT NULL
         AND blockTimestamp >= ?`,
    )
    .get(address, cutoffSec);
  // Top bid: highest per-item price among LIVE offers — per-token offers
  // on any token of the collection plus live collection offers. Both
  // sides must be unexpired (expiry evaluated at read time); wei stays
  // TEXT, as with floors above.
  const topPerToken = db
    .prepare(
      `SELECT CAST(MAX(CAST(priceWei AS INTEGER)) AS TEXT) AS topWei FROM offers
       WHERE collection = ? AND active = 1 AND (expiry IS NULL OR expiry > ?)`,
    )
    .get(address, nowSec).topWei;
  const topCollection = db
    .prepare(
      `SELECT CAST(MAX(CAST(pricePerItemWei AS INTEGER)) AS TEXT) AS topWei
       FROM collection_offers
       WHERE collection = ? AND active = 1 AND (expiry IS NULL OR expiry > ?)`,
    )
    .get(address, nowSec).topWei;
  let topBidWei = null;
  if (topPerToken !== null && topCollection !== null) {
    topBidWei = BigInt(topPerToken) >= BigInt(topCollection)
      ? topPerToken
      : topCollection;
  } else {
    topBidWei = topPerToken ?? topCollection;
  }
  // True when any token row for the collection has a non-null level —
  // the frontend shows the level selector only then.
  const hasLevels = db
    .prepare(
      `SELECT EXISTS(SELECT 1 FROM tokens WHERE collection = ? AND level IS NOT NULL) AS n`,
    )
    .get(address).n === 1;
  const out = {
    address,
    name: row.name,
    symbol: row.symbol,
    kind: row.kind,
    totalSupply: row.totalSupplyLive,
    holders,
    listedCount,
    totalVolumeWei: totalVolume.totalWei,
    totalVolumeEth: ethers.formatEther(BigInt(totalVolume.totalWei)),
    volume24hWei: volume24h.totalWei,
    volume24hEth: ethers.formatEther(BigInt(volume24h.totalWei)),
    topBidWei,
    topBidEth: topBidWei === null
      ? null
      : ethers.formatEther(BigInt(topBidWei)),
    hasLevels,
    ...floorPair(floor),
  };
  // Floor per level: Squeek only (levels come from Merge events).
  // Expired listings are excluded, as in the collection floor above.
  if (row.kind === 'squeek') {
    const byLevel = {};
    for (const r of db
      .prepare(
        `SELECT t.level AS level, CAST(MIN(CAST(l.priceWei AS INTEGER)) AS TEXT) AS floorWei
         FROM listings l JOIN tokens t
           ON t.collection = l.collection AND t.tokenId = l.tokenId
         WHERE l.collection = ? AND l.active = 1 AND t.burned = 0
           AND (l.expiry IS NULL OR l.expiry > ?)
           AND t.level IS NOT NULL
         GROUP BY t.level ORDER BY t.level ASC`,
      )
      .all(address, nowSec)) {
      byLevel[String(r.level)] = floorPair(r);
    }
    out.floorByLevel = byLevel;
  }
  return out;
}

function activeListingFor(db, collection, tokenId) {
  // Expired listings (v3) do not count as the token's listing; legacy
  // v2 rows have NULL expiry and still count.
  const nowSec = Math.floor(Date.now() / 1000);
  const row = db
    .prepare(
      `SELECT listingId, seller, priceWei, expiry, createdBlock FROM listings
       WHERE collection = ? AND tokenId = ? AND active = 1
         AND (expiry IS NULL OR expiry > ?) LIMIT 1`,
    )
    .get(collection, tokenId, nowSec);
  if (!row) return null;
  return {
    listingId: row.listingId,
    seller: row.seller,
    expiry: row.expiry,
    expiresInSec: row.expiry === null ? null : row.expiry - nowSec,
    createdBlock: row.createdBlock,
    ...pricePair(row.priceWei),
  };
}

// Shape for a collection offer. Wei values stay TEXT (see the floor fix
// in collectionSummary). `remaining` is quantity - filled; `level` 0
// means "any level".
function collectionOfferShape(r, nowSec) {
  return {
    kind: 'collection',
    id: r.id,
    collection: r.collection,
    bidder: r.bidder,
    totalPriceWei: String(r.totalPriceWei),
    totalPriceEth: ethers.formatEther(BigInt(r.totalPriceWei)),
    pricePerItemWei: String(r.pricePerItemWei),
    pricePerItemEth: ethers.formatEther(BigInt(r.pricePerItemWei)),
    quantity: r.quantity,
    filled: r.filled,
    remaining: r.quantity - r.filled,
    level: r.level,
    expiry: r.expiry,
    expiresInSec: r.expiry === null ? null : r.expiry - nowSec,
    createdBlock: r.createdBlock,
  };
}

// A collection offer matches a token when it is live (active and not
// expired — expiry is evaluated at read time, as with per-token
// offers), its level is "any" (0) or equals the token's level, and the
// bidder does not own the token. A NULL token level (collections
// without levels) only matches "any level" offers: `level = NULL` is
// never true in SQL.
function matchingCollectionOffers(db, collection, tokenId, owner, level, nowSec) {
  const rows = db
    .prepare(
      `SELECT id, collection, bidder, totalPriceWei, pricePerItemWei,
              quantity, filled, level, expiry, createdBlock
       FROM collection_offers
       WHERE collection = ? AND active = 1
         AND (expiry IS NULL OR expiry > ?)
         AND (level = 0 OR level = ?)
         AND bidder != ?
       ORDER BY CAST(pricePerItemWei AS INTEGER) DESC`,
    )
    .all(collection, nowSec, level, (owner ?? '').toLowerCase());
  return rows.map((r) => collectionOfferShape(r, nowSec));
}

// Per-item price of an entry in a merged offers list: per-token offers
// carry priceWei, collection offers carry pricePerItemWei.
function offerUnitPriceWei(o) {
  return BigInt(o.priceWei ?? o.pricePerItemWei);
}

// All live offers on one token, per-token and matching collection
// offers together, highest per-item price first. Per-token offers keep
// today's shape plus kind: "offer"; collection offers carry
// kind: "collection". (Per-token expiry is NOT filtered here, matching
// today's behaviour — only collection offers are expiry-filtered at
// read time; see matchingCollectionOffers.)
function tokenOffers(db, collection, token, nowSec) {
  const perToken = db
    .prepare(
      `SELECT offerId, bidder, priceWei, expiry FROM offers
       WHERE collection = ? AND tokenId = ? AND active = 1
       ORDER BY CAST(priceWei AS INTEGER) DESC`,
    )
    .all(collection, token.tokenId)
    .map((r) => ({
      kind: 'offer',
      offerId: r.offerId,
      bidder: r.bidder,
      expiry: r.expiry,
      expiresInSec: r.expiry === null ? null : r.expiry - nowSec,
      ...pricePair(r.priceWei),
    }));
  const collectionOffers = matchingCollectionOffers(
    db, collection, token.tokenId, token.owner, token.level, nowSec,
  );
  return [...perToken, ...collectionOffers].sort((x, y) => {
    const px = offerUnitPriceWei(x);
    const py = offerUnitPriceWei(y);
    return px < py ? 1 : px > py ? -1 : 0;
  });
}

// Live-offer count for one token: per-token offers (today's count) plus
// matching live collection offers — the number the Owned tab uses to
// decide whether a selected NFT has an offer.
function liveOfferCountForToken(db, collection, tokenId, owner, level, nowSec) {
  const perToken = db
    .prepare(
      `SELECT COUNT(*) AS n FROM offers
       WHERE collection = ? AND tokenId = ? AND active = 1`,
    )
    .get(collection, tokenId).n;
  const collectionOffers = db
    .prepare(
      `SELECT COUNT(*) AS n FROM collection_offers
       WHERE collection = ? AND active = 1
         AND (expiry IS NULL OR expiry > ?)
         AND (level = 0 OR level = ?)
         AND bidder != ?`,
    )
    .get(collection, nowSec, level, (owner ?? '').toLowerCase()).n;
  return perToken + collectionOffers;
}

function activityRows(db, whereSql, params, limit) {
  return db
    .prepare(
      `SELECT type, collection, tokenId, actor, priceWei, blockNumber, txHash, logIndex
       FROM activity ${whereSql}
       ORDER BY blockNumber DESC, id DESC LIMIT ?`,
    )
    .all(...params, limit)
    .map((r) => ({
      type: r.type,
      collection: r.collection,
      tokenId: r.tokenId,
      actor: r.actor,
      blockNumber: r.blockNumber,
      txHash: r.txHash,
      logIndex: r.logIndex,
      ...(r.priceWei !== null && r.priceWei !== undefined
        ? pricePair(r.priceWei)
        : { priceWei: null, priceEth: null }),
    }));
}

function route(db, indexer, req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  const q = url.searchParams;

  // GET /status
  if (parts.length === 1 && parts[0] === 'status') {
    const state = getSyncState(db);
    const collectionsTracked = db
      .prepare('SELECT COUNT(*) AS n FROM collections')
      .get().n;
    const tokensTracked = db
      .prepare('SELECT COUNT(*) AS n FROM tokens WHERE burned = 0')
      .get().n;
    send(res, 200, {
      chainId: indexer.chainId ?? CHAIN_ID,
      latestBlock: indexer.latestBlock,
      indexedBlock: state?.lastBlock ?? null,
      indexedBlockHash: state?.lastBlockHash ?? null,
      collectionsTracked,
      tokensTracked,
      ok: true,
      startedAt: indexer.startedAt,
      gaps: indexer.gaps,
    });
    return;
  }

  // GET /activity
  if (parts.length === 1 && parts[0] === 'activity') {
    const limit = clampInt(q.get('limit'), 50, 1, 500);
    send(res, 200, activityRows(db, '', [], limit));
    return;
  }

  // GET /collections
  if (parts.length === 1 && parts[0] === 'collections') {
    const rows = db
      .prepare('SELECT * FROM collections ORDER BY address ASC')
      .all();
    send(res, 200, rows.map((r) => collectionSummary(db, r)));
    return;
  }

  // /collections/:address ...
  if (parts[0] === 'collections' && parts.length >= 2) {
    const address = parts[1].toLowerCase();
    if (!isAddr(address)) return notFound(res);
    const row = db
      .prepare('SELECT * FROM collections WHERE address = ?')
      .get(address);
    if (!row) return notFound(res);

    if (parts.length === 2) {
      const out = collectionSummary(db, row);
      out.activity = activityRows(
        db, 'WHERE collection = ?', [address], 20,
      );
      send(res, 200, out);
      return;
    }
    if (parts.length === 3 && parts[2] === 'holders') {
      const holders = db
        .prepare(
          `SELECT owner, COUNT(*) AS tokenCount,
                  GROUP_CONCAT(tokenId) AS tokenIdsCsv
           FROM (SELECT owner, tokenId FROM tokens
                 WHERE collection = ? AND burned = 0 AND owner IS NOT NULL
                 ORDER BY CAST(tokenId AS INTEGER) ASC)
           GROUP BY owner
           ORDER BY tokenCount DESC, owner ASC LIMIT 500`,
        )
        .all(address)
        .map((r) => ({
          holder: r.owner,
          tokenCount: r.tokenCount,
          tokenIds: r.tokenIdsCsv ? r.tokenIdsCsv.split(',') : [],
        }));
      send(res, 200, holders);
      return;
    }
    if (parts.length === 3 && parts[2] === 'tokens') {
      const limit = clampInt(q.get('limit'), 100, 1, 500);
      const offset = clampInt(q.get('offset'), 0, 0, 1_000_000);
      const nowSec = Math.floor(Date.now() / 1000);
      const rows = db
        .prepare(
          `SELECT tokenId, owner, level FROM tokens
           WHERE collection = ? AND burned = 0
           ORDER BY CAST(tokenId AS INTEGER) ASC LIMIT ? OFFSET ?`,
        )
        .all(address, limit, offset);
      send(res, 200, rows.map((r) => ({
        tokenId: r.tokenId,
        owner: r.owner,
        level: r.level,
        listing: activeListingFor(db, address, r.tokenId),
        // Per-token offers plus matching live collection offers.
        offerCount: liveOfferCountForToken(
          db, address, r.tokenId, r.owner, r.level, nowSec,
        ),
      })));
      return;
    }
    if (parts.length === 3 && parts[2] === 'collection-offers') {
      const nowSec = Math.floor(Date.now() / 1000);
      const rows = db
        .prepare(
          `SELECT id, collection, bidder, totalPriceWei, pricePerItemWei,
                  quantity, filled, level, expiry, createdBlock
           FROM collection_offers
           WHERE collection = ? AND active = 1 AND (expiry IS NULL OR expiry > ?)
           ORDER BY createdBlock DESC, CAST(id AS INTEGER) DESC`,
        )
        .all(address, nowSec);
      send(res, 200, rows.map((r) => collectionOfferShape(r, nowSec)));
      return;
    }
    if (parts.length === 3 && parts[2] === 'listings') {
      const nowSec = Math.floor(Date.now() / 1000);
      const rows = db
        .prepare(
          `SELECT listingId, tokenId, seller, priceWei, expiry, createdBlock
           FROM listings WHERE collection = ? AND active = 1
             AND (expiry IS NULL OR expiry > ?)
           ORDER BY CAST(priceWei AS INTEGER) ASC`,
        )
        .all(address, nowSec);
      send(res, 200, rows.map((r) => ({
        listingId: r.listingId,
        tokenId: r.tokenId,
        seller: r.seller,
        expiry: r.expiry,
        expiresInSec: r.expiry === null ? null : r.expiry - nowSec,
        createdBlock: r.createdBlock,
        ...pricePair(r.priceWei),
      })));
      return;
    }
    if (parts.length === 3 && parts[2] === 'activity') {
      const limit = clampInt(q.get('limit'), 50, 1, 500);
      send(res, 200, activityRows(
        db, 'WHERE collection = ?', [address], limit,
      ));
      return;
    }
    return notFound(res);
  }

  // GET /tokens/:collection/:tokenId
  if (parts[0] === 'tokens' && parts.length === 3) {
    const collection = parts[1].toLowerCase();
    const tokenId = parts[2];
    if (!isAddr(collection)) return notFound(res);
    const col = db
      .prepare('SELECT * FROM collections WHERE address = ?')
      .get(collection);
    if (!col) return notFound(res);
    const token = db
      .prepare(
        'SELECT * FROM tokens WHERE collection = ? AND tokenId = ?',
      )
      .get(collection, tokenId);
    if (!token) return notFound(res);
    const nowSec = Math.floor(Date.now() / 1000);
    const offers = tokenOffers(db, collection, token, nowSec);
    send(res, 200, {
      collection,
      tokenId,
      owner: token.owner,
      level: token.level,
      burned: token.burned === 1,
      listing: activeListingFor(db, collection, tokenId),
      offers,
    });
    return;
  }

  // /owners/:address/...
  if (parts[0] === 'owners' && parts.length === 3) {
    const address = parts[1].toLowerCase();
    if (!isAddr(address)) return notFound(res);
    if (parts[2] === 'nfts') {
      const nowSec = Math.floor(Date.now() / 1000);
      const rows = db
        .prepare(
          `SELECT collection, tokenId, level FROM tokens
           WHERE owner = ? AND burned = 0
           ORDER BY collection ASC, CAST(tokenId AS INTEGER) ASC`,
        )
        .all(address);
      send(res, 200, rows.map((r) => ({
        collection: r.collection,
        tokenId: r.tokenId,
        level: r.level,
        listing: activeListingFor(db, r.collection, r.tokenId),
        // Per-token offers plus matching live collection offers.
        offerCount: liveOfferCountForToken(
          db, r.collection, r.tokenId, address, r.level, nowSec,
        ),
      })));
      return;
    }
    if (parts[2] === 'listings') {
      const nowSec = Math.floor(Date.now() / 1000);
      const rows = db
        .prepare(
          `SELECT listingId, collection, tokenId, priceWei, expiry, createdBlock
           FROM listings WHERE seller = ? AND active = 1
             AND (expiry IS NULL OR expiry > ?)
           ORDER BY createdBlock DESC`,
        )
        .all(address, nowSec);
      send(res, 200, rows.map((r) => ({
        listingId: r.listingId,
        collection: r.collection,
        tokenId: r.tokenId,
        expiry: r.expiry,
        expiresInSec: r.expiry === null ? null : r.expiry - nowSec,
        createdBlock: r.createdBlock,
        ...pricePair(r.priceWei),
      })));
      return;
    }
    if (parts[2] === 'offers') {
      const nowSec = Math.floor(Date.now() / 1000);
      // Per-token offers (today's shape plus kind: "offer") alongside
      // the bidder's live collection offers (kind: "collection", with
      // filled/remaining), highest per-item price first.
      const perToken = db
        .prepare(
          `SELECT offerId, collection, tokenId, priceWei, expiry
           FROM offers WHERE bidder = ? AND active = 1
           ORDER BY CAST(priceWei AS INTEGER) DESC`,
        )
        .all(address)
        .map((r) => ({
          kind: 'offer',
          offerId: r.offerId,
          collection: r.collection,
          tokenId: r.tokenId,
          expiry: r.expiry,
          expiresInSec: r.expiry === null ? null : r.expiry - nowSec,
          ...pricePair(r.priceWei),
        }));
      const collectionOffers = db
        .prepare(
          `SELECT id, collection, bidder, totalPriceWei, pricePerItemWei,
                  quantity, filled, level, expiry, createdBlock
           FROM collection_offers
           WHERE bidder = ? AND active = 1 AND (expiry IS NULL OR expiry > ?)
           ORDER BY CAST(pricePerItemWei AS INTEGER) DESC`,
        )
        .all(address, nowSec)
        .map((r) => collectionOfferShape(r, nowSec));
      const merged = [...perToken, ...collectionOffers].sort((x, y) => {
        const px = offerUnitPriceWei(x);
        const py = offerUnitPriceWei(y);
        return px < py ? 1 : px > py ? -1 : 0;
      });
      send(res, 200, merged);
      return;
    }
    return notFound(res);
  }

  return notFound(res);
}

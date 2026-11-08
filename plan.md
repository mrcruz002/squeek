# Squeekchain NFT Launchpad — Full Plan

**Prepared:** 6 November 2026, by Koda for Sadiq Ibrahim
**Idea:** an OpenSea-like NFT launchpad running on Squeekchain
**Status:** plan only — nothing built, nothing deployed, no money spent

---

## 1. What we are building

A website where anyone can:

- **Launch** an NFT collection on Squeekchain (create, set price, supply, art, mint rules)
- **Mint** from a live drop (public sale, allowlist sale, or both)
- **Trade** on a secondary marketplace (list, buy, make offers) — this is the OpenSea-like half

Two products in one, built in order. The launchpad (minting) comes first because it needs no indexer. The marketplace comes second because it lives or dies on the indexer.

### Scope

| | MVP (v1) | Full product (v2) |
|---|---|---|
| Launch a collection | Yes — ERC-721, fixed price, fixed supply | + ERC-1155 editions, Dutch auction, allowlist phases |
| Mint | Yes — public sale | + allowlist/presale, per-wallet limits |
| Secondary market | No | List, buy, cancel, offers |
| Browse/discover | Basic collection + token pages | Explore, search, trending, activity feed, stats, floor price, volume |
| Royalties | ERC-2981 set at launch | + creator dashboard, fee splits |
| Accounts | Wallet connect only | + profiles, favourites, watchlists |

---

## 2. Where Squeekchain stands today (verified 6 Nov 2026)

These facts decide what can be built now and what has to wait.

- **Network:** Ethereum Sepolia testnet only. Chain ID **11155111**. Explorer: sepolia.etherscan.io.
- **Core status:** live and advancing — settled through round **360** at the 6 Nov check (was 232 on the morning of 5 Nov, 281 that evening). Settlement enabled, no incident open. It stalled for ~10 days before that (26 Oct – 5 Nov), so liveness is not guaranteed.
- **Token:** SQK has **not launched**. Test SQK exists on Sepolia, but conflicting token addresses circulate in community material — the payment token must be verified against official docs before any build depends on it.
- **Docs:** docs.squeekchain.com — contracts, events and API for building. The docs themselves warn: *"These contracts may change before mainnet. Pin the ABI you use and re-check the deployment before relying on it."*
- **Chain model:** SqueekCore records settled hamster work per 10-minute round and converts it into Squeek block progress. A launchpad does not need the core to function — it only needs normal EVM transactions — but the chain's liveness and finality behaviour is the core's behaviour.
- **Ecosystem:** permissionless, anyone can build. No established marketplace, indexer, or launchpad exists on it yet. Wallet support is standard EVM (MetaMask, Rabby, OKX, WalletConnect) via a custom network entry.

**Consequence:** everything built now is testnet-only. A real-money launchpad cannot go live until Squeekchain mainnet exists, and its token, fees and finality rules are published.

---

## 3. Architecture

```
User (browser wallet: MetaMask / Rabby / OKX)
        │
        ▼
Frontend (static site: explore, collection, token, create, activity)
        │  reads                │  writes (signatures + txs)
        ▼                       ▼
API + Indexer ──────►  Smart contracts on Sepolia (11155111)
        ▲                       (factory, collections, marketplace)
        │ listens to events
        │
Metadata + images: IPFS (pinned)
```

### 3.1 Smart contracts (Solidity, 0.8.x)

| Contract | Job | Approach |
|---|---|---|
| Collection factory | Deploys a new collection per creator, cheaply | Minimal-proxy clones (EIP-1167) of one implementation, like SeaDrop does |
| ERC-721 collection | The NFTs themselves | OpenZeppelin ERC721 + Enumerable + ERC-2981 royalties |
| ERC-1155 editions | Cheaper multi-copy drops (v2) | OpenZeppelin ERC1155 + ERC-2981 |
| Mint / drop logic | Public sale, allowlist sale, per-wallet caps, start/end times, price | SeaDrop-style stages, or a small custom drop contract — adapt, don't invent |
| Marketplace | Listings, buys, cancellations, offers | v1: simple escrow listing contract. v2: Seaport-style order book (or integrate Seaport itself if it is deployed on Sepolia) |
| Royalties | Creator cut on secondary sales | ERC-2981 on the collection; marketplace enforces it. Note: royalties are only as enforceable as the marketplace — a transfer validator (CreatorTokenTransferValidator, already used in this ecosystem) can restrict trading to royalty-respecting venues, at the cost of friction |

Security rules: no owner backdoors that can steal funds or freeze user NFTs, `nonReentrant` on every payable function, pull-payment for proceeds (creators withdraw, contract never pushes), pausable only by a timelocked owner or not at all, full Foundry test suite.

### 3.2 Indexer (the hard part — see §6)

- A listener process watches the launchpad's own contracts only (not the whole chain): `Transfer`, listing created / filled / cancelled, offer events.
- It keeps a database (Postgres) of current truth: who owns what, what is listed at what price, floor price, volume, activity.
- A small read API serves the frontend: collection page, token page, explore, search, activity.
- Must handle reorgs (Sepolia reorgs happen) and restarts (resume from the last processed block, never from scratch).
- Hosting: a small always-on server (VPS). This is the only piece that must run 24/7.

### 3.3 Frontend

- Static site (React + viem/wagmi), mobile-first, dark design in the OpenSea idiom: home/explore grid, collection page, token page, create-launch flow, activity feed, profile.
- Wallet connect: MetaMask, Rabby, OKX, WalletConnect. Network auto-switch to Sepolia 11155111, with a clear TEST NETWORK label.
- Reads: mostly from the API (fast), falling back to direct chain reads.
- Writes: mint, list, buy, offer — all signed in the user's own wallet. The site never holds keys or funds.

### 3.4 Metadata and art

- Token metadata JSON + images on IPFS, pinned (Pinata or web3.storage free tier to start).
- `tokenURI` returns `ipfs://…/{id}`; the frontend resolves through a public gateway.
- Collection metadata (name, description, banner, royalty) stored the same way.

---

## 4. Build phases (one developer, building in order)

| Phase | What ships | Estimate |
|---|---|---|
| **0 — Setup & decisions** | Repo, toolchain (Foundry + frontend), Sepolia RPC + keys, deploy wallet, IPFS account, final scope decisions (§5) | 3–5 days |
| **1 — Launchpad MVP** | Factory + ERC-721 collection, public mint with price/supply/caps, create-launch flow, collection + token pages, mint page. Deployed on Sepolia, verified on Etherscan. | 3–4 weeks |
| **2 — Marketplace core** | Listing contract, list / buy / cancel, indexer v1 (own contracts only), listings + floor price on collection pages, activity feed | 3–4 weeks |
| **3 — Marketplace full** | Offers, search, explore/trending, stats (volume, floor history), profiles, ERC-1155 editions, allowlist phases, Dutch auction | 3–4 weeks |
| **4 — Hardening & mainnet readiness** | Full test coverage, testnet bug-bash, external audit, docs, mainnet deploy plan (waits on Squeekchain mainnet) | 2–4 weeks + audit queue time |

**Totals**

- **Launchpad MVP (Phase 0+1): ~4–5 weeks** of focused solo work.
- **Full OpenSea-like product (Phases 0–3): ~3–4 months.**
- Audit adds calendar time and cost on top (see §7), it is not included in the build estimates.

These are build estimates, not promises. The two things most likely to stretch them are Squeekchain changing its contracts before mainnet (docs warn this will happen) and the indexer behaving badly under real load.

---

## 5. Decisions needed before building (with a recommendation each)

1. **ERC-721 first, or 1155 too?** → 721 first. Most collections are 721; 1155 editions come in Phase 3.
2. **Payment token?** → Sepolia ETH for the testnet build. Real payment token (SQK vs ETH vs stablecoin) is a mainnet decision, and SQK's canonical address is unverified — do not hard-code it.
3. **Marketplace fee?** → 0% on testnet; decide the real fee (e.g. 2.5% like OpenSea, or lower to attract creators) before mainnet.
4. **Royalties?** → ERC-2981, creator-set 0–10%, default 5%. Enforcement via the marketplace; optional transfer validator later.
5. **Allowlist model?** → Merkle allowlist (cheap, standard) for presales.
6. **Who builds it?** → Koda builds it in phases (this plan), or IMD builds it (their swarm, paid per job — also counts as a Squeekchain submission for the whitelist). They are not mutually exclusive: IMD could build the frontend while Koda does contracts, but splitting work across two builders adds coordination cost.
7. **Name and domain?** → Needed before Phase 1 ends. Nothing is public without them.
8. **Hosting?** → Small VPS for the indexer + static hosting for the site (Vercel/Netlify free tier works for the frontend).

---

## 6. Why the indexer is the main issue

A chain cannot answer "show me all listings for this collection, sorted by price". Somebody has to watch every event, store it, handle cancellations, expiries and reorgs, and keep it consistent. That stored view is what produces floor price, volume, activity, search and trending — everything that makes a marketplace feel like a marketplace instead of a block explorer.

Three ways to shrink it:

- **Index only our own contracts**, never the whole chain. Orders of magnitude less data.
- **Launchpad first, marketplace second.** Minting needs no indexer at all.
- **Reuse where possible:** a plain event listener + Postgres is enough at this scale; The Graph / hosted indexers are only worth it if they ever support Squeekchain (nothing indicates they do today).

---

## 7. Costs (estimates, testnet phase)

| Item | Cost |
|---|---|
| Gas on Sepolia | ~free (test ETH from faucets) |
| Domain | ~$10–15/year |
| Frontend hosting | $0 (static hosting free tier) |
| VPS for indexer + API | ~$5–20/month |
| IPFS pinning | $0 to start (free tiers), ~$10–20/month at scale |
| Security audit (mainnet only) | Typically $5,000–$30,000+ depending on scope and firm — get quotes when Phase 3 is done; do not skip it for real money |

No revenue until mainnet, and none is assumed in this plan.

---

## 8. Risks (honest list)

1. **Squeekchain is early.** Testnet only, contracts may change before mainnet, core stalled for ~10 days as recently as late October. A launchpad built now may need rework at mainnet.
2. **No users yet.** A marketplace with no traders has no floor prices and no volume. Launching means also attracting the first creators and collectors — that is a community job, not a code job.
3. **Security.** Anything holding listings and funds is a target. No audit = no real money, full stop.
4. **Payment token unknown.** Until SQK launches and its address is confirmed in official docs, the economics of the marketplace are undecided.
5. **Competition.** If Squeekchain succeeds, other marketplaces will appear. First-mover advantage on a tiny chain is real but small.
6. **Maintenance.** The indexer and site need someone keeping them running. That is an ongoing cost, not a one-time build.

---

## 9. What happens next (if you say go)

1. You answer the decisions in §5 (or just the first three — the rest can wait).
2. Phase 0: repo + toolchain + Sepolia setup. I show you the empty skeleton working.
3. Phase 1: factory + first collection + mint page on Sepolia. You mint the first test NFT from it yourself.
4. After each phase, you test it and we fix what breaks before moving on. Nothing is deployed to mainnet, ever, without your explicit go-ahead — and mainnet doesn't exist yet anyway.

**What this plan does not do:** it does not start building, spend money, deploy anything, or contact anyone. It is the map, not the trip.

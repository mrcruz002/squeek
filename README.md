# Squeekchain NFT Launchpad

An OpenSea-style NFT launchpad and marketplace on **Squeekchain** (Sepolia testnet for now —
Squeekchain mainnet does not exist yet). Creators launch ERC-721 collections through a factory;
anyone can mint during a public sale window, list, buy, and make offers on the marketplace.
Full plan: [`plan.md`](plan.md).

**Live site: https://squeekchain-launchpad-production.up.railway.app**

**Status (updated 8 Nov 2026): live on Sepolia.** Factory, marketplace v3, verified-badge
registry and indexer are all deployed and the site is public. The first sales have happened
(Squeek #68 sold for 0.01 ETH twice on v2, then 0.011 ETH on v3). No demo collection has been
created on the factory yet — that test is still pending.

## Live contracts (Sepolia, chain ID 11155111)

| Contract | Address | Notes |
|---|---|---|
| CollectionFactory | [`0x9Ba898622E30E2eB88B26143c6b1070789A5390f`](https://sepolia.etherscan.io/address/0x9Ba898622E30E2eB88B26143c6b1070789A5390f) | Deployed 6 Nov 2026, block 12075576 |
| SqueekMarketplace (v3) | [`0x552E31c7ffc23C839f7bf0957B7DBaA32C055a12`](https://sepolia.etherscan.io/address/0x552E31c7ffc23C839f7bf0957B7DBaA32C055a12) | Deployed 8 Nov 2026, block 12088682; bytecode verified against the local build |
| VerifiedRegistry | [`0x27ec54DeD78af3ced661Fbe8EfEB9f6E92EC8605`](https://sepolia.etherscan.io/address/0x27ec54DeD78af3ced661Fbe8EfEB9f6E92EC8605) | Owner-verified badge registry; Squeek is verified |
| Squeek (official collection) | [`0xC4C7982657f00509548F3a3a41db7FA439a6856B`](https://sepolia.etherscan.io/address/0xC4C7982657f00509548F3a3a41db7FA439a6856B) | The hamster NFTs the marketplace was built around |

Superseded: marketplace v1 (`0xbc686382758998dE68A065DBBd1a48b74C8880b8`) and v2
(`0x54F515b7fd201e73c0c33e7d351243546bAe4CeF`) — do not use. One v2 collection offer
(0.006 ETH, Level 2 only) is still escrowed in the old contract until it expires (~13 Nov 2026).

## What the platform does

- **Launchpad** — create an ERC-721 collection through the factory (fixed price, exact payment,
  max supply, per-wallet cap, sale window, ERC-2981 royalties, default 5%). Mint during the sale.
- **Marketplace** — escrow listings with an expiry you set (1–365 days, default 30); buying at the
  exact listed price; per-token offers (ETH escrowed, expiring); collection offers priced as
  total ÷ quantity, with an optional level filter (L1–L10) on levelled collections like Squeek;
  bulk accept and bulk list from the Owned tab. **0% marketplace fee** — only the creator royalty
  is paid on resales.
- **Verified badge** — collections verified on-chain in the registry show a blue ✓.
- **Indexer** — live on a hosted server, serving holders, levels, floors, volume and activity
  (`/indexer/status` on the site). Volume is kept as running history across marketplace versions.
- **Network safety** — the site shows a "Switch to Sepolia testnet" button when your wallet is on
  the wrong network, and all spending buttons are disabled until you switch.

## Structure

```
squeekchain-launchpad/
├── plan.md                  # Full plan (architecture, phases, decisions)
├── README.md                # This file
├── TEST_RESULTS.md          # Test output, smoke-test results, known quirks
├── contracts/               # Foundry project
│   ├── src/
│   │   ├── SqueekCollection.sol    # ERC-721 drop contract (clone implementation)
│   │   ├── CollectionFactory.sol   # Permissionless EIP-1167 clone factory
│   │   ├── SqueekMarketplace.sol   # Marketplace v3 (escrow listings + offers)
│   │   └── VerifiedRegistry.sol    # On-chain verified-badge registry
│   ├── test/                       # Foundry tests (marketplace v3: 94/94 pass)
│   ├── script/
│   │   ├── Deploy.s.sol            # Sepolia deploy script
│   │   └── CreateDemoCollection.s.sol
│   └── foundry.toml
├── abi/                     # Exported ABIs (factory, collection, marketplace, registry)
├── frontend/                # Vite + React + viem/wagmi (live on Railway)
├── indexer/                 # Node + SQLite indexer (live on a Vultr server)
├── marketplace-deploy/      # Local-run deploy scripts for the marketplace
├── verified-deploy/         # Local-run scripts for the registry
└── deploy-local/            # Local-run deploy package for the factory
```

## Contracts

### `SqueekCollection` — the drop contract (ERC-721)

OpenZeppelin `ERC721` + `ERC721Enumerable` + `ERC2981` + `ReentrancyGuard`, `Initializable`
(EIP-1167 clone — never used directly; the implementation constructor disables initializers).

- **Fixed price, exact payment only** — underpayment and overpayment both revert.
- **Max supply** and **per-wallet cap** enforced on every mint.
- **Sale window** — `saleStart` / `saleEnd`; minting outside the window reverts.
- **Royalties** — ERC-2981, default **5%** to the creator, configurable at creation.
- **Base URI** — settable by the creator only before the sale starts; `tokenURI(id)` =
  `baseURI + tokenId`. Token IDs start at **1**.
- **Withdrawal** — pull-payment, owner-only, `nonReentrant`; reverts when the balance is 0.
  Proceeds sit in the collection contract until the creator withdraws.
- **No backdoors** — no admin mint, no pausing, no freezing, no changing price/supply after
  creation. The creator's only powers are `setBaseURI` (before sale) and `withdraw`.
- **Security** — `nonReentrant` on `mint` and `withdraw`; reentrancy is covered by tests
  with malicious receiver contracts; exact-payment rule prevents stuck ETH from overpaying.

### `CollectionFactory` — permissionless clone factory

- Deploys the `SqueekCollection` implementation once in its constructor.
- `createCollection(InitParams)` deploys an EIP-1167 minimal-proxy clone, initialises it,
  and requires `params.creator == msg.sender` (you cannot create a collection for someone
  else's address).
- Tracks `allCollections`, `collectionsOfCreator`, `collectionCount`, `isCollection`.
- **Ownerless** — no admin, no fees, no allowlist. Anyone can launch.
- Emits `CollectionCreated(collection, creator, name, symbol)`.

### `SqueekMarketplace` (v3) — escrow listings + offers

- **Listings are escrow-based**: listing moves the NFT into the marketplace contract; cancelling
  (or expiry) is what returns it. A listing has a price and an expiry (duration set up front);
  buying past expiry reverts, and the seller can re-list straight from escrow.
- **Per-token offers** — bidder's ETH is escrowed; anyone may cancel an expired offer.
- **Collection offers** — bidder enters a total price and a quantity; per-item price is
  total ÷ quantity, with no maximum quantity. Offers can be filtered by level (L1–L10) on
  levelled collections; the level is enforced on-chain. Accepting takes the highest live offer
  per NFT; unfilled funds are refunded when the offer closes.
- **Royalties** — ERC-2981 paid on every sale; **0% marketplace fee**; no owner/admin.

### `VerifiedRegistry` — on-chain verified badge

- `setVerified(address, bool)` is owner-only; `isVerified(address)` is read by the frontend.
- To verify another collection: `node set-verified.mjs 0x<collection-address> true` in
  `verified-deploy/` (no redeploy needed).

## Setup

### Contracts (Foundry)

```bash
cd contracts
forge install   # restores contracts/lib (forge-std, OpenZeppelin) — not committed
forge build
forge test
```

Requires Foundry 1.9.0+ (`~/.foundry/bin`). No API keys or private keys are needed for
building or testing.

### Local smoke test (anvil)

```bash
anvil --chain-id 11155111 --port 8545   # in one terminal
cd contracts
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80  # anvil account 0 — TEST KEY ONLY
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --start-fresh
export FACTORY_ADDRESS=<factory address from the output>
forge script script/CreateDemoCollection.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --start-fresh
```

See `TEST_RESULTS.md` for the verified smoke-test run (factory, demo collection, 2 mints,
withdraw — all confirmed on the local chain).

> **Quirk:** anvil with `--chain-id 11155111` inflates deployment gas ~6.8x (see
> `TEST_RESULTS.md`). It does not affect the contracts or real Sepolia. A plain `anvil`
> (default chain ID) avoids it.

### Frontend

```bash
cd frontend
npm install
npm run dev      # local dev server
npm run build    # production build (must pass)
```

The frontend targets **Sepolia (chain ID 11155111)** and is clearly labelled
**TEST NETWORK**. Wallet connect via wagmi. Public Sepolia RPC:
`https://ethereum-sepolia-rpc.publicnode.com` — no keys in the repo.

Copy `frontend/.env.example` to `frontend/.env` and fill in the live contract addresses
(factory, marketplace v3, verified registry) and the indexer URL.

### Indexer

```bash
cd indexer
npm install
npm start       # serves on port 3001
```

Needs `RPC_URL` (use the Tenderly Sepolia gateway for historical logs),
`MARKETPLACE_ADDRESS` (v3), `START_BLOCK` and `DB_PATH` in `indexer/.env`.
The indexer loads the marketplace ABI from `../abi/SqueekMarketplace.json` — the `abi/`
folder must sit beside the `indexer/` folder. To rewind: stop the indexer, then
`node src/rewind.mjs <block>` from `indexer/`.

## Sepolia deployment

All contracts are already deployed (see the table at the top). Deploys go through the
**local-run route**: the deployer runs the scripts from their own computer with the key in a
local `.env` file — the key is never sent to, or stored by, anyone else. Deploy scripts abort
unless the key belongs to the expected deployer address and the chain is Sepolia (11155111).

- Factory: `deploy-local/` (`deploy.mjs`)
- Marketplace: `marketplace-deploy/`
- Verified registry: `verified-deploy/`

After a deploy, update the addresses in `frontend/.env` and `indexer/.env`, and record them
in the table at the top of this README.

No mainnet deployment is possible or planned — Squeekchain mainnet does not exist yet.

## Network config

| Network | Chain ID | RPC |
|---|---|---|
| Sepolia (Squeekchain testnet) | 11155111 | https://ethereum-sepolia-rpc.publicnode.com |
| Local anvil (smoke test) | 11155111 | http://127.0.0.1:8545 |

## What's next

- **Demo collection** — create Demo Squeeks on the factory (Sepolia) and mint once to confirm
  the live create → mint → list path end to end.
- **Phase 3 whitelist** — Merkle allowlist, new implementation + fresh factory deployment.
- **Phase 5 swap** — Uniswap V2-style AMM with a demo token and seeded pools (no public
  liquidity UI).
- **Phase 6 profile extras** — username / PFP (off-chain recommended).

## Notes on this repo

- `contracts/lib/` (forge-std, OpenZeppelin) is **not committed** — run `forge install`.
- `.env` files are **never committed** — only `.env.example` files are in the repo.
- `frontend/public/hamster.jpg` and the preview screenshots are **not in the repo** (binary
  files) — the site build expects the hamster image at that path; add it separately.
- The indexer database (`indexer/data/`) is **not committed** — it is rebuilt from chain
  history on first run (backfill from `START_BLOCK`).

## Rules for this repo

- **No live deployments, no spending, no private keys or seed phrases** in the repo or in
  chat. Test keys are anvil defaults only.
- **No contacting anyone, no modifying Squeekchain's own contracts.**
- Test locally with anvil; Sepolia only when explicitly approved with a funded
  deployer wallet via the local-run route.

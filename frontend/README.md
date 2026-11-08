# Squeekchain NFT Launchpad — Frontend

Vite + React + TypeScript + viem/wagmi. Phase 0–1 MVP: browse collections,
create a collection through the factory, mint from a drop, and view tokens.

**TEST NETWORK only.** The app targets Sepolia (chain ID 11155111) — Squeekchain
runs on Sepolia testnet for now; Squeekchain mainnet does not exist yet. A
banner at the top of every page says so. No real money, no mainnet.

## Setup

```bash
npm install
npm run dev      # local dev server (default http://localhost:5173)
npm run build    # production build (must pass)
npm run preview  # serve the production build locally
```

Requires Node 20+ (built with Node v24.22.1, npm 10.9.4).

## Configuration (env vars)

| Variable | Default | Meaning |
|---|---|---|
| `VITE_NETWORK` | `sepolia` | `sepolia` or `local` (anvil). Selects which chain wagmi uses. |
| `VITE_FACTORY_ADDRESS` | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | The `CollectionFactory` address. |
| `VITE_SEPOLIA_RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` | Public Sepolia RPC, no key needed. |
| `VITE_LOCAL_RPC_URL` | `http://127.0.0.1:8545` | Local anvil RPC. |

Copy `.env.example` to `.env` and edit it. **Never put a private key or seed
phrase in `.env` or anywhere in this repo** — the site only ever signs through
the user's own wallet.

### Local anvil (dev testing)

```bash
# terminal 1 — in contracts/
anvil --chain-id 11155111 --port 8545
# terminal 2 — deploy factory + demo collection (see ../README.md)
# terminal 3 — here
cp .env.example .env   # VITE_NETWORK=local, factory = anvil address (already the default)
npm run dev
```

The `.env` shipped in the repo already points at the local anvil, so `npm run
dev` just works against a running anvil with the smoke-test factory deployed.

### Sepolia

After the factory is deployed on Sepolia (see `../README.md` — deployer wallet
via the user's local-run route only):

```bash
VITE_NETWORK=sepolia
VITE_FACTORY_ADDRESS=0x<sepolia factory address>
```

Then `npm run dev` / `npm run build`. The banner switches to "TEST NETWORK —
Sepolia".

### Why only one chain is active at a time

The local anvil runs with chain ID 11155111 — the same as Sepolia — and wagmi's
chain map is keyed by chain ID, so Sepolia and anvil cannot both be configured
at once. `src/config.ts` exports both chain definitions (`sepolia` and
`anvilChain`) and activates exactly one based on `VITE_NETWORK`.

## Pages (hash routing, no router dependency)

| Route | Page |
|---|---|
| `#/` | Browse — all collections from the factory (`collectionCount` / `allCollections`), each with price and minted/total. Empty state when none exist. |
| `#/create` | Create-launch form — name, symbol, max supply, mint price (ETH), max per wallet, sale start/end, base URI, royalty % (default 5). Submits `createCollection` and shows the new collection address from the `CollectionCreated` event. |
| `#/collection/<address>` | Collection page — name, symbol, price, supply minted/total with progress bar, per-wallet cap, sale window + live status (Not started / Live / Ended), royalty %, token list, and the mint box. |
| `#/collection/<address>/token/<id>` | Token page — owner, tokenURI, and metadata fetched from the tokenURI JSON (http(s)/ipfs:// via a public gateway); failures are shown gracefully with the raw tokenURI still visible. |

## Minting

The mint box (on the collection page) has a quantity selector clamped to the
per-wallet cap and remaining supply, shows the exact total ETH, and sends one
`mint(quantity)` transaction with exactly `price × quantity` — the contract
reverts on under- or over-payment. States: confirm-in-wallet → pending →
confirmed (with links to the new token pages, IDs are sequential from
`totalSupply` + 1) or error with the revert reason.

Wallet connect is via wagmi's injected connector (MetaMask / Rabby / OKX).
Wrong network shows a "Switch to Sepolia" button. Wallet not connected shows
the connect button instead of the mint form.

## ABIs

`src/abi.ts` imports `CollectionFactory.json` and `SqueekCollection.json`
directly from `../abi/` — the single source of truth exported from the Foundry
project. The ABIs are **not** hand-written or copied into `src/`. Vite is
configured (`vite.config.ts`, `server.fs.allow`) so the dev server can serve
those files from the parent directory.

## Structure

```
frontend/
├── src/
│   ├── main.tsx            # entry, renders <App/>
│   ├── App.tsx             # wagmi + react-query providers, header/banner, hash router
│   ├── config.ts           # chains, wagmi config, factory address, env vars
│   ├── abi.ts              # imports the exported ABIs from ../abi/
│   ├── hooks.ts            # useCollectionAddresses, useCollectionSummaries,
│   │                       # useCollection, useToken, useTokenMetadata
│   ├── lib/utils.ts        # formatting, sale status, ipfs:// resolution, errors
│   ├── components/
│   │   ├── ConnectButton.tsx
│   │   ├── MintBox.tsx
│   │   └── CollectionCard.tsx
│   └── pages/
│       ├── HomePage.tsx
│       ├── CreatePage.tsx
│       ├── CollectionPage.tsx
│       └── TokenPage.tsx
├── .env.example
├── index.html
└── package.json
```

## Known limits (MVP)

- No router library — hash routing keeps dependencies minimal.
- No WalletConnect (no project ID bundled); injected wallets only. Add
  `@wagmi/connectors` WalletConnect later if needed.
- Token list on a collection page lists minted IDs by number; there is no
  indexer yet (Phase 2), so no search, floor price, or activity feed.
- Metadata images load from `ipfs.io`; if the gateway is slow, the token page
  still shows owner + tokenURI.

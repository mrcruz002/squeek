# Squeekchain NFT Launchpad

An OpenSea-style NFT launchpad on **Squeekchain** (Sepolia testnet for now — Squeekchain
mainnet does not exist yet). Creators launch ERC-721 collections through a factory; anyone
can mint during a public sale window. Full plan: [`plan.md`](plan.md).

**Status: Phase 0–1 complete, local-only.** Contracts are written, tested (25/25) and
smoke-tested on a local anvil. The frontend is built (Vite + React + wagmi) and
verified against the local anvil (browse, create, mint, token pages — see
`frontend/README.md`). **Nothing has been deployed to any live network and no
money has been spent.**

## Structure

```
squeekchain-launchpad/
├── plan.md                  # Full plan (architecture, phases, decisions)
├── README.md                # This file
├── TEST_RESULTS.md          # Test output, smoke-test results, known quirks
├── contracts/               # Foundry project
│   ├── src/
│   │   ├── SqueekCollection.sol    # ERC-721 drop contract (clone implementation)
│   │   └── CollectionFactory.sol   # Permissionless EIP-1167 clone factory
│   ├── test/SqueekLaunchpad.t.sol  # 25 Foundry tests
│   ├── script/
│   │   ├── Deploy.s.sol            # Sepolia deploy script (NOT run yet)
│   │   └── CreateDemoCollection.s.sol
│   └── foundry.toml
├── abi/                     # Exported ABIs (CollectionFactory, SqueekCollection)
└── frontend/                # Vite + React + viem/wagmi (built, verified locally)
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

## Setup

### Contracts (Foundry)

```bash
cd contracts
forge build
forge test
```

Requires Foundry 1.9.0+ (`~/.foundry/bin` — see `contracts/README` if present).
No API keys or private keys are needed for building or testing.

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

## Sepolia deployment (NOT done yet)

Scripts are ready but **never executed against a live network**:

- `contracts/script/Deploy.s.sol` — deploys the factory; requires chain ID 11155111 and
  `PRIVATE_KEY` from the environment only.
- `contracts/script/CreateDemoCollection.s.sol` — creates a demo collection on a deployed
  factory; env-driven (`FACTORY_ADDRESS`, `COLLECTION_*`).

**What is still needed before a Sepolia deployment can happen:**

1. A **funded Sepolia deployer wallet** — Sepolia ETH for gas (factory deploy ≈ 1–2M gas
   on real Sepolia). This goes through the user's **local-run route** (the deployer key
   lives in a local `.env` on his own computer, exactly like the Squeekchain claim script;
   the key is never sent to, or stored by, the assistant).
2. The deployer runs `forge script script/Deploy.s.sol --rpc-url <sepolia-rpc> --broadcast`
   from his machine, or the assistant runs it against a key he provides locally.
3. After deployment, record the factory address in `frontend/.env` as
   `VITE_FACTORY_ADDRESS` and verify the contracts on Sepolia Etherscan.
4. Create one demo collection on Sepolia and mint once to confirm the live path.

No mainnet deployment is possible or planned — Squeekchain mainnet does not exist yet.

## Network config

| Network | Chain ID | RPC |
|---|---|---|
| Sepolia (Squeekchain testnet) | 11155111 | https://ethereum-sepolia-rpc.publicnode.com |
| Local anvil (smoke test) | 11155111 | http://127.0.0.1:8545 |

## Rules for this repo

- **No live deployments, no spending, no private keys or seed phrases** in the repo or in
  chat. Test keys are anvil defaults only.
- **No contacting anyone, no modifying Squeekchain's own contracts.**
- Test locally with anvil; Sepolia only when the user explicitly approves with a funded
  deployer wallet via his local-run route.

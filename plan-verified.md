# Verified collections — plan

## Status

Built 2026-11-07, not yet deployed to Sepolia. Contract
`contracts/src/VerifiedRegistry.sol`, tests 8/8 pass (57/57 full suite),
deploy + admin scripts in `verified-deploy/`, frontend badge wired behind
`VITE_VERIFIED_REGISTRY_ADDRESS` (empty until deployed).

## What it is

A tiny on-chain registry that says which collections carry a verified badge
on the marketplace. The site shows a blue ✓ next to a collection's name —
on marketplace collection cards, on the collection page header, and under
NFT cards on the Dashboard — only when this registry says the collection
is verified. The badge is read straight from the chain, so it cannot be
faked by editing the site.

## Registry address (Sepolia)

**Not deployed yet — placeholder.** After the user runs
`verified-deploy/deploy.mjs`, fill in here:

- Registry: `<TBD — paste from deployment.json>`
- Owner: `0x3ade5ce6a61c5a22dbb509cb847960759c88d35d`
- Deploy tx: `<TBD>`

## Who can set it

Only the owner wallet `0x3ade5ce6a61c5a22dbb509cb847960759c88d35d` can call
`setVerified` — enforced by the contract itself (`onlyOwner`), not by the
site. Anyone else calling it reverts with `OwnableUnauthorizedAccount`.
The deploy/admin scripts also abort unless the local key belongs to that
wallet. There are no other roles; ownership can be transferred to another
wallet the operator controls (`transferOwnership`), but that is an on-chain
owner-only call — do not do it without thinking, and never renounce
ownership: a renounced registry can never add or remove a badge again.

## How to add / remove a badge

From `squeekchain-launchpad\verified-deploy` (key in local `.env`, same key
as the claim script and marketplace deploy):

```powershell
npm install
node set-verified.mjs                          # verify the Squeek collection
node set-verified.mjs 0x<collection> true      # verify a collection
node set-verified.mjs 0x<collection> false     # remove the badge
```

Prefix `DRY_RUN=1` to simulate without sending. If the collection is
already in the requested state, the script sends nothing. Each call prints
its tx hash and a Sepolia Etherscan link; the script re-reads
`isVerified` on chain afterwards and aborts if the state did not change.

## Frontend wiring

- `VITE_VERIFIED_REGISTRY_ADDRESS` in `frontend/.env` (empty until the
  registry is deployed). No badge and no registry read while it is unset.
- `useVerified(collection)` in `frontend/src/hooks.ts` — direct chain read
  of `isVerified`.
- `components/VerifiedBadge.tsx` — renders the ✓ or nothing.
- Badge shows on: `MarketplaceCollectionCard`, the collection page header
  (both the indexer and the launchpad branches), and the collection name
  under NFT cards on the Dashboard (`OwnedNftCard`).

## Verification (anvil fixture)

Deploy the registry on anvil with an anvil account as owner, verify the
Squeek collection, confirm the badge shows on the collection card and
collection page; confirm a non-owner `setVerified` reverts; unset it and
confirm the badge disappears. Previews in `marketplace-preview/`. Sepolia
rendering in the user's browser still needs his deploy + the
`VITE_VERIFIED_REGISTRY_ADDRESS` line.

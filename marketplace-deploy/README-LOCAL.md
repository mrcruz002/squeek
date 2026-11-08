# Marketplace deploy — local run

Deploys `SqueekMarketplace` to Sepolia (chain 11155111) from your own computer.
Your private key stays in a local `.env` file here and is never sent anywhere.

## What it deploys

One contract, no constructor arguments, no owner: the escrow marketplace
(list / buy / cancel + escrowed per-token offers + **collection offers**
— bid a total for a quantity of items, optionally level-filtered — and batch
accept). It holds no funds after deployment until someone lists or offers.
0% marketplace fee; royalties per ERC-2981.

> **Redeploy note (v2, 2026-11-07):** this version replaces the marketplace
> deployed 2026-11-07 (`0xbc68…`). That contract had zero listings and zero
> offers, so nothing migrates — deploy this one and point the frontend and
> indexer at the new address. The old address stops being used.

## Run it

You are in this folder: `squeekchain-launchpad\marketplace-deploy`

```powershell
npm install
copy .env.example .env
# paste your deployer private key into .env (same key as the claim script)
npm run deploy:dry   # simulation only — estimates gas, sends nothing
npm run deploy       # deploys for real
```

## Folder check

Before you run anything, `dir` in this folder should show:

- `deploy.mjs`
- `SqueekMarketplace.json`
- `package.json`
- `.env.example`
- `.env` (after you copy it — this one is yours, never share it)

## After it runs

- `deployment.json` is written here with the marketplace address + tx hash.
- Send the marketplace address and tx hash to Koda.
- Koda then points the frontend (`VITE_MARKETPLACE_ADDRESS`) and the indexer
  (`MARKETPLACE_ADDRESS`) at it, and the listing / offer buttons go live.

## Safety

- The script aborts unless the key belongs to
  `0x3ade5ce6a61c5a22dbb509cb847960759c88d35d` and unless the chain is Sepolia
  (11155111). It estimates gas first and aborts if your balance cannot cover it.
- Testnet only. The contract is unaudited — never deploy this code to mainnet.

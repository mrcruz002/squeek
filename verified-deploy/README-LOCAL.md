# Verified registry deploy + admin — local run

Deploys `VerifiedRegistry` to Sepolia (chain 11155111) from your own computer,
and adds/removes verified badges. Your private key stays in a local `.env`
file here and is never sent anywhere.

## What it deploys

One tiny contract, owner-only: a mapping of collection address → verified
(true/false). The owner is set at deploy to
`0x3ade5ce6a61c5a22dbb509cb847960759c88d35d` — only that wallet can ever call
`setVerified`. Nobody else can add or remove a badge, and the site reads the
badge straight from this contract, so it cannot be faked by editing the site.

## Run it

You are in this folder: `squeekchain-launchpad\verified-deploy`

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
- `set-verified.mjs`
- `VerifiedRegistry.json`
- `package.json`
- `.env.example`
- `.env` (after you copy it — this one is yours, never share it)

## After the deploy

- `deployment.json` is written here with the registry address + tx hash.
- Send the registry address and tx hash to Koda.
- Add the address to the site: in `frontend\.env`, add
  `VITE_VERIFIED_REGISTRY_ADDRESS=<the registry address>`, then restart the
  site (`npm run dev`). The badge stays hidden until this is set.
- Then verify the Squeek collection (this is the badge people will see first):

```powershell
node set-verified.mjs
```

That verifies the Squeek collection (`0xC4C7982657f00509548F3a3a41db7FA439a6856B`).
To verify another collection, or to remove a badge:

```powershell
node set-verified.mjs 0x<collection address> true    # add the badge
node set-verified.mjs 0x<collection address> false   # remove the badge
```

Add `DRY_RUN=1` in front (`DRY_RUN=1 node set-verified.mjs ...`) to simulate
without sending anything. If the collection is already in the requested
state, the script says so and sends nothing.

## Safety

- Both scripts abort unless the key belongs to
  `0x3ade5ce6a61c5a22dbb509cb847960759c88d35d` and unless the chain is Sepolia
  (11155111). They estimate gas first and abort if your balance cannot cover it.
- Testnet only. The contract is unaudited — never deploy this code to mainnet.
- Do not renounce ownership of the registry: if the owner is ever removed,
  no badge can ever be added or removed again. (Ownership can be transferred
  to another wallet you control with `transferOwnership`, but that is an
  on-chain owner-only call — ask Koda before doing it.)

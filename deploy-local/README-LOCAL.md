# Deploy the launchpad factory to Sepolia — local run

Same method as the Squeekchain claim script: you run it on your own computer,
your key stays in a local `.env` file, and nothing is ever sent to Koda or
stored anywhere else.

## What this deploys

One transaction: the `CollectionFactory` contract on Sepolia (chain ID
11155111). The factory's constructor also deploys the `SqueekCollection`
implementation, so this single deploy sets up the whole launchpad. The factory
is ownerless and permissionless — the deployer only pays gas and holds no
admin power afterwards.

## Before you run it

- **Deployer wallet:** your `0x3ade…` wallet (same key as the claim script).
  Checked 6 Nov: it holds **0.0483 Sepolia ETH**, which comfortably covers
  the deploy (the real deploy used 18,942,729 gas, but Sepolia's gas price
  was near zero, so it cost almost nothing — about 0.00000000034 ETH).
- **Node.js** installed (you already have it from the claim script).
- **No Sepolia ETH top-up needed** unless the balance has dropped since the
  check — the script itself verifies the balance covers the cost before
  sending anything, and aborts if it doesn't.

## Steps (Windows)

1. Unzip this folder anywhere, e.g. next to your `squeekchain-claim-local`
   folder. Open a terminal **inside the `deploy-local` folder itself** — your
   prompt must end in `deploy-local`. Check with `dir`: you should see
   `deploy.mjs` listed. If your prompt ends in `squeekchain-launchpad`
   instead, run `cd deploy-local` first — running the commands one folder up
   fails with "Cannot find module" / "Missing script".
2. Install dependencies (one time):
   `npm install`
3. Copy `.env.example` to `.env` and paste your deployer private key after
   `PRIVATE_KEY=`. Same key as the claim script's `.env`. Never send it to
   anyone.
4. Simulate first (sends nothing):
   `npm run deploy:dry`
   or `DRY_RUN=1 node deploy.mjs` — it prints the estimated gas and cost.
   (If `cross-env` is missing, `npm install` will have added it; if the dry
   run script fails on Windows, use the `DRY_RUN=1 node deploy.mjs` form.)
5. Deploy for real:
   `node deploy.mjs`
6. When it finishes, it writes `deployment.json` in this folder. Send Koda
   the **factory address** and the **transaction hash**. That is all he needs
   to point the frontend at it, verify the contracts on Sepolia Etherscan,
   and create the first demo collection.

## Safety checks built into the script

- Aborts if the key in `.env` is not your `0x3ade…` wallet.
- Aborts if the network is not Sepolia (chain ID 11155111).
- Aborts if your balance can't cover the estimated cost.
- After deploying, it verifies on chain that code exists at the factory
  address, reads the implementation address, and confirms the collection
  count is 0.

## If something fails

Copy the terminal output and send it to Koda. Do not re-run the deploy blindly
— if the first transaction actually went through, a second run would deploy a
second factory. Check `deployment.json` first: if it exists, the deploy
already succeeded.

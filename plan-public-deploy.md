# Plan: Public website + hosted indexer (Vercel + Google Cloud e2-micro)

## Goal
Turn the local Sepolia marketplace into a real public website friends can open
in a browser and stress test — no computer of yours running, no install for them.
Sepolia testnet only. No real money, contracts unaudited.

## Current state (2026-11-08 ~08:21 WAT)
- Marketplace **v3 LIVE**: `0x552E31c7ffc23C839f7bf0957B7DBaA32C055a12`
  (tx `0x05816b8310648a857367973209c1395450d7d342c949228fdf88083c80202bee`,
  block 12088682, bytecode verified exact match with the v3 build).
- Factory: `0x9Ba898622E30E2eB88B26143c6b1070789A5390f`
- Verified registry: `0x27ec54DeD78af3ced661Fbe8EfEB9f6E92EC8605`
  (Squeek verified: `0xC4C7982657f00509548F3a3a41db7FA439a6856B`)
- Local site + indexer on your machine are on v3 and working.
- **Volume decision (kept):** the 0.02 ETH from the two v2 sales stays in the
  indexer database as running history. The first v3 sale adds on top.
- **Hosting decision: AWS (switched 2026-11-08 ~08:47 WAT).**
  Oracle signup failed 2026-11-08 and Google Cloud billing rejected his cards
  (Bybit Card is classed as prepaid; Google refuses prepaid/virtual cards).
  AWS is more lenient with cards and now bills in naira. Oracle Always Free
  and Contabo (~$5–7/mo) remain fallbacks; the Cloudflare Tunnel ($0, no
  card, PC must stay on) is the stopgap.

## Part 1 — Indexer on AWS (t2.micro, free tier)
Why this box: new AWS accounts get $200 credit for 6 months (some sources
still describe the classic 12-month 750 hrs/month t2.micro — either way, a
t2.micro costs about $8/month, so the credit covers the first 6 months
easily). 1 GB RAM is enough for this indexer — a light Node app with a small
SQLite database. Card needed at signup (small ~$1 verification hold); AWS is
more lenient with card types than Google. After the credit, expect about
$8/month. Set a billing alert so nothing surprises you.

1. **AWS account.** Go to aws.amazon.com and click Create an AWS Account.
   Email + account name (e.g. `squeekchain`), verify the email code, set a
   root password, fill in contact details with your REAL name and address
   exactly as your bank has them. Add your card — the Bybit Card may work
   here where Google refused it; AWS does a small ~$1 verification hold.
   Verify your phone number with the code they send. Support plan: choose
   **Basic support (free)**. Job 1 is done when you can sign into the AWS
   Console and see the dashboard.
2. **Launch the server (EC2).** In the console, check the region at the top
   right is **eu-central-1 (Frankfurt)** — change it if not. Open EC2 →
   Instances → Launch instances. Fill in exactly:
   - Name: `squeekchain-indexer`
   - Application image: `Ubuntu Server 24.04 LTS (HVM), SSD Volume Type`,
     64-bit (x86)
   - Instance type: `t2.micro` (1 vCPU, 1 GB RAM — free tier eligible)
   - Key pair: Create new key pair, name `squeekchain-key`, type RSA,
     format `.pem`. **Download it and keep the file safe** — you need it to
     copy files to the server.
   - Network: default VPC, auto-assign public IP: Enable.
   - Firewall (security group): create a new one, name
     `squeekchain-indexer-sg`, with two rules: SSH (port 22, source My IP)
     and Custom TCP port `3001`, source `0.0.0.0/0` (anywhere — this is what
     lets browsers reach the indexer).
   - Storage: leave the default (8 GB gp3 is enough; the free tier allows
     up to 30 GB).
   Click Launch instance. Wait until state is Running and note the **Public
   IPv4 address**.
3. **Give it a fixed address (Elastic IP).** A normal public IP can change if
   the server ever stops. Go to EC2 → Elastic IPs → Allocate Elastic IP
   address → Allocate, then Actions → Associate Elastic IP address, pick
   your instance, Associate. An Elastic IP is free while attached to a
   running instance. Note this IP — it is the one the site will use, and it
   will not change.
4. **Copy your indexer to the server.** On your computer, zip your local
   `indexer` folder — **including `data/indexer.db`** (that keeps the 0.02
   ETH volume history and the token data, so no re-backfill is needed) and
   **excluding `node_modules`** (it gets reinstalled on the server). From
   PowerShell, copy it with the key you downloaded:
   `scp -i squeekchain-key.pem indexer.zip ubuntu@<Elastic-IP>:~/`
   Then connect in the browser: EC2 → Instances → select yours → Connect →
   EC2 Instance Connect → Connect. Unzip into
   `/home/ubuntu/squeekchain-launchpad/indexer` and check `indexer/.env`
   has:
   - `MARKETPLACE_ADDRESS=0x552E31c7ffc23C839f7bf0957B7DBaA32C055a12`
   - `RPC_URL=https://sepolia.gateway.tenderly.co`
   - `PORT=3001`
   - `START_BLOCK=12055000`
   Note: the DB cursor is already past the v3 deploy block (12088682). That is
   fine — v3 has no history to recover yet, and live sync catches new events.
5. **Install Node and start it.** In the same browser terminal: install Node
   24, `npm install` in the indexer folder, then set up the systemd unit
   from `indexer/README.md`
   (`/etc/systemd/system/squeekchain-indexer.service`, User=ubuntu,
   WorkingDirectory=/home/ubuntu/squeekchain-launchpad/indexer,
   ExecStart=/usr/bin/node src/index.mjs), `systemctl enable --now`.
   Verify: `curl localhost:3001/status` shows `ok:true`, and
   `http://<Elastic-IP>:3001/status` opens in your browser.
6. **Keep the Elastic IP.** You need it for Part 2 (`VITE_INDEXER_URL`).

## Part 2 — Site on Vercel (free)
No GitHub repo is on file for this project, so the simplest route is the
Vercel CLI from your computer (no repo needed).

1. **Install the CLI.** `npm i -g vercel` (PowerShell).
2. **Deploy from the frontend folder.** `cd` into `frontend`, run `vercel`,
   log in when asked, accept the defaults. That gives you a preview URL.
3. **Set the environment variables** in the Vercel dashboard for the project
   (or with `vercel env add`). Exact values — v3, current:
   - `VITE_NETWORK=sepolia`
   - `VITE_FACTORY_ADDRESS=0x9Ba898622E30E2eB88B26143c6b1070789A5390f`
   - `VITE_MARKETPLACE_ADDRESS=0x552E31c7ffc23C839f7bf0957B7DBaA32C055a12`
   - `VITE_VERIFIED_REGISTRY_ADDRESS=0x27ec54DeD78af3ced661Fbe8EfEB9f6E92EC8605`
   - `VITE_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com`
   - `VITE_INDEXER_URL=http://<Elastic-IP>:3001` (from Part 1, step 6)
   Root directory is `frontend`, build command `npm run build`, framework
   preset Vite. (If you import from GitHub instead, same settings.)
4. **Production deploy.** `vercel --prod`. You get a public URL like
   `https://<name>.vercel.app`. A custom domain is optional, later.
5. **Test it.** Open the URL, connect a wallet (it prompts to switch to
   Sepolia), open the Squeek collection: volume should read 0.02 ETH, the
   verified badge should show, and the Owned tab should show List NFT +
   Accept offer. Friends need Sepolia ETH from a faucet (sepoliafaucet.com)
   to list, buy or make offers.

## Order
AWS server indexer FIRST, then Vercel — the site needs the indexer URL, and
without it the site still loads but with no floors, holders, listings or
levels. After the server is up, your local indexer can be stopped (or kept as
backup).

## Cost
About $8/month for the t2.micro, covered by the $200 new-account credit for
the first 6 months. Vercel free tier $0. After the credit runs out, expect
about $8/month. Set a billing alert in AWS (Billing → Budgets) so nothing
surprises you. The Elastic IP is free while attached to the running instance.

## Known quirks to expect
- The old 0.006 ETH v2 collection offer may still show on the Squeek page
  (it lives in the copied DB). It CANNOT be accepted on v3 — trying will fail
  on-chain, because v3 has no such offer. It expires in ~5 days; until then,
  ignore it. If it bothers you, it can be deleted from the DB.
- Volume reads 0.02 ETH (v2 history, kept by your choice) until the first
  v3 sale.
- No listings, floors or offers exist on v3 yet — the first listing is still
  the demo test (create Demo Squeeks, mint, list one).

## What Koda needs from you
1. Approval of this plan (or edits).
2. You create the AWS account + server (your card, your email) and send the
   server's Elastic IP when you have it.
3. You run the Vercel deploy from your computer (your Vercel login).
Koda then checks the public URL + indexer status and helps debug any step
that fails.

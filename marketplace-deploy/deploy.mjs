// deploy.mjs — deploy the Squeekchain marketplace (SqueekMarketplace) to Sepolia (chain 11155111).
//
// LOCAL-RUN ONLY. Run this on your own computer. Your private key lives in a
// local .env file in this folder and is never sent anywhere. This script only
// deploys the marketplace contract. One transaction, no other writes. The
// marketplace has no constructor arguments and no owner — anyone can list,
// buy, offer and accept once it is deployed.
//
// Usage:
//   npm install
//   copy .env.example to .env and paste your deployer private key
//   node deploy.mjs            (deploys for real on Sepolia)
//   DRY_RUN=1 node deploy.mjs  (simulates only: estimates gas, sends nothing)
//
// After a real run, deployment.json is written in this folder — send the
// marketplace address and transaction hash to Koda so the frontend and the
// indexer (MARKETPLACE_ADDRESS) can be pointed at it.

import "dotenv/config";
import { ethers } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";

const RPC_URL =
  process.env.SEPOLIA_RPC_URL ||
  "https://ethereum-sepolia-rpc.publicnode.com";
const EXPECTED_DEPLOYER = (
  process.env.EXPECTED_DEPLOYER ||
  "0x3ade5ce6a61c5a22dbb509cb847960759c88d35d"
).toLowerCase();
const DRY_RUN = process.env.DRY_RUN === "1";

const artifact = JSON.parse(
  readFileSync(new URL("./SqueekMarketplace.json", import.meta.url), "utf8")
);

function fail(msg) {
  console.error("ABORT:", msg);
  process.exit(1);
}

const key = (process.env.PRIVATE_KEY || "").trim();
if (!key) {
  fail(
    "Missing PRIVATE_KEY. Copy .env.example to .env and paste your deployer private key in it."
  );
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(key, provider);

console.log("Deployer:", wallet.address);
if (wallet.address.toLowerCase() !== EXPECTED_DEPLOYER) {
  fail(
    `Derived address ${wallet.address} does not match EXPECTED_DEPLOYER ${EXPECTED_DEPLOYER}. Wrong key in .env — stopping so nothing is deployed from the wrong wallet.`
  );
}

const network = await provider.getNetwork();
console.log("Chain ID:", network.chainId.toString());
if (network.chainId !== 11155111n) {
  fail("Expected Sepolia (chain ID 11155111). Check SEPOLIA_RPC_URL.");
}

const factory = new ethers.ContractFactory(
  artifact.abi,
  artifact.bytecode.object,
  wallet
);
const deployTx = await factory.getDeployTransaction();
const gasEstimate = await provider.estimateGas({
  ...deployTx,
  from: wallet.address,
});
const feeData = await provider.getFeeData();
const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
const cost = gasEstimate * gasPrice;
const balance = await provider.getBalance(wallet.address);
console.log("Estimated gas:", gasEstimate.toString());
console.log("Gas price (wei):", gasPrice.toString());
console.log("Estimated cost (ETH):", ethers.formatEther(cost));
console.log("Deployer balance (ETH):", ethers.formatEther(balance));
if (balance < cost) fail("Deployer balance is below the estimated cost.");

if (DRY_RUN) {
  console.log("DRY RUN: simulation only, nothing was sent.");
  process.exit(0);
}

console.log("Sending marketplace deployment...");
const deployed = await factory.deploy();
const receipt = await deployed.deploymentTransaction().wait();
const marketplaceAddress = await deployed.getAddress();
console.log("Marketplace deployed:", marketplaceAddress);
console.log("Tx hash:", receipt.hash);
console.log("Block:", receipt.blockNumber);

// Verify on chain: code exists, counters start at 1.
const code = await provider.getCode(marketplaceAddress);
if (code === "0x") fail("No code at the marketplace address after deployment.");
const live = new ethers.Contract(marketplaceAddress, artifact.abi, provider);
const nextListingId = await live.nextListingId();
const nextOfferId = await live.nextOfferId();
const nextCollectionOfferId = await live.nextCollectionOfferId();
console.log("nextListingId:", nextListingId.toString());
console.log("nextOfferId:", nextOfferId.toString());
console.log("nextCollectionOfferId:", nextCollectionOfferId.toString());
if (nextListingId !== 1n || nextOfferId !== 1n || nextCollectionOfferId !== 1n) {
  fail("Unexpected counters after a fresh deploy.");
}

const deployment = {
  network: "sepolia",
  chainId: 11155111,
  marketplace: marketplaceAddress,
  deployer: wallet.address,
  txHash: receipt.hash,
  blockNumber: receipt.blockNumber,
  deployedAt: new Date().toISOString(),
};
writeFileSync(
  new URL("./deployment.json", import.meta.url),
  JSON.stringify(deployment, null, 2) + "\n"
);
console.log("Saved deployment.json. Send the marketplace address + tx hash to Koda.");

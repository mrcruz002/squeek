// deploy.mjs — deploy the Squeekchain launchpad factory to Sepolia (chain 11155111).
//
// LOCAL-RUN ONLY. Run this on your own computer. Your private key lives in a
// local .env file in this folder and is never sent anywhere. This script only
// deploys the factory contract (which also deploys the collection
// implementation in its constructor). One transaction, no other writes.
//
// Usage:
//   npm install
//   copy .env.example to .env and paste your deployer private key
//   node deploy.mjs            (deploys for real on Sepolia)
//   DRY_RUN=1 node deploy.mjs  (simulates only: estimates gas, sends nothing)
//
// After a real run, deployment.json is written in this folder — send the
// factory address and transaction hash to Koda so the frontend can be pointed
// at it and the contracts verified on Sepolia Etherscan.

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
  readFileSync(new URL("./CollectionFactory.json", import.meta.url), "utf8")
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

console.log("Sending factory deployment...");
const deployed = await factory.deploy();
const receipt = await deployed.deploymentTransaction().wait();
const factoryAddress = await deployed.getAddress();
console.log("Factory deployed:", factoryAddress);
console.log("Tx hash:", receipt.hash);
console.log("Block:", receipt.blockNumber);

// Verify on chain: code exists, implementation set, zero collections so far.
const code = await provider.getCode(factoryAddress);
if (code === "0x") fail("No code at the factory address after deployment.");
const live = new ethers.Contract(factoryAddress, artifact.abi, provider);
const implementation = await live.implementation();
const count = await live.collectionCount();
console.log("Implementation:", implementation);
console.log("Collection count:", count.toString());
if (count !== 0n) fail("Unexpected collection count after a fresh deploy.");

const deployment = {
  network: "sepolia",
  chainId: 11155111,
  factory: factoryAddress,
  implementation,
  deployer: wallet.address,
  txHash: receipt.hash,
  blockNumber: receipt.blockNumber,
  deployedAt: new Date().toISOString(),
};
writeFileSync(
  new URL("./deployment.json", import.meta.url),
  JSON.stringify(deployment, null, 2) + "\n"
);
console.log("Saved deployment.json. Send the factory address + tx hash to Koda.");

// set-verified.mjs — add or remove a verified badge for a collection.
//
// LOCAL-RUN ONLY. Run this on your own computer. Your private key lives in a
// local .env file in this folder and is never sent anywhere. Only the registry
// owner (0x3ade5ce6a61c5a22dbb509cb847960759c88d35d) can call setVerified — the
// contract itself rejects anyone else, and this script also aborts unless the
// key belongs to that wallet.
//
// Usage:
//   npm install
//   copy .env.example to .env and paste your deployer private key
//   node set-verified.mjs                          (verifies the Squeek collection)
//   node set-verified.mjs 0x<collection> true      (verify a collection)
//   node set-verified.mjs 0x<collection> false     (remove the badge)
//   DRY_RUN=1 node set-verified.mjs ...           (simulates only, sends nothing)
//
// The registry address comes from REGISTRY_ADDRESS in .env, or from
// deployment.json in this folder (written by deploy.mjs).

import "dotenv/config";
import { ethers } from "ethers";
import { existsSync, readFileSync } from "node:fs";

const RPC_URL =
  process.env.SEPOLIA_RPC_URL ||
  "https://ethereum-sepolia-rpc.publicnode.com";
const EXPECTED_DEPLOYER = (
  process.env.EXPECTED_DEPLOYER ||
  "0x3ade5ce6a61c5a22dbb509cb847960759c88d35d"
).toLowerCase();
const SQUEEK = "0xC4C7982657f00509548F3a3a41db7FA439a6856B";
const DRY_RUN = process.env.DRY_RUN === "1";

const artifact = JSON.parse(
  readFileSync(new URL("./VerifiedRegistry.json", import.meta.url), "utf8")
);

function fail(msg) {
  console.error("ABORT:", msg);
  process.exit(1);
}

const collectionArg = process.argv[2];
const verifiedArg = process.argv[3];
const collection = (collectionArg || SQUEEK).toLowerCase();
if (!ethers.isAddress(collection)) {
  fail(`"${collectionArg}" is not a valid collection address.`);
}
let verified = true;
if (verifiedArg !== undefined) {
  if (verifiedArg === "true") verified = true;
  else if (verifiedArg === "false") verified = false;
  else fail(`Second argument must be true or false, not "${verifiedArg}".`);
}

let registryAddress = (process.env.REGISTRY_ADDRESS || "").trim();
if (!registryAddress) {
  const deploymentPath = new URL("./deployment.json", import.meta.url);
  if (existsSync(deploymentPath)) {
    const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
    registryAddress = deployment.registry || "";
  }
}
if (!registryAddress || !ethers.isAddress(registryAddress)) {
  fail(
    "No registry address. Deploy first (node deploy.mjs), then set REGISTRY_ADDRESS in .env or keep deployment.json in this folder."
  );
}
registryAddress = registryAddress.toLowerCase();

const key = (process.env.PRIVATE_KEY || "").trim();
if (!key) {
  fail(
    "Missing PRIVATE_KEY. Copy .env.example to .env and paste your deployer private key in it."
  );
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(key, provider);

console.log("Caller:", wallet.address);
if (wallet.address.toLowerCase() !== EXPECTED_DEPLOYER) {
  fail(
    `Derived address ${wallet.address} does not match EXPECTED_DEPLOYER ${EXPECTED_DEPLOYER}. Only the registry owner can set a badge — stopping.`
  );
}

const network = await provider.getNetwork();
console.log("Chain ID:", network.chainId.toString());
if (network.chainId !== 11155111n) {
  fail("Expected Sepolia (chain ID 11155111). Check SEPOLIA_RPC_URL.");
}

const registry = new ethers.Contract(registryAddress, artifact.abi, provider);
const code = await provider.getCode(registryAddress);
if (code === "0x") fail(`No code at ${registryAddress} — wrong registry address?`);
const owner = await registry.owner();
console.log("Registry owner:", owner);
if (owner.toLowerCase() !== EXPECTED_DEPLOYER) {
  fail("Registry owner is not the expected deployer wallet.");
}
const before = await registry.isVerified(collection);
console.log(`isVerified(${collection}) before:`, before);
if (before === verified) {
  console.log("Already in the requested state — nothing to send.");
  process.exit(0);
}

console.log(
  `Setting verified=${verified} for ${collection} on registry ${registryAddress}...`
);
const registryWithSigner = registry.connect(wallet);
if (DRY_RUN) {
  await registryWithSigner.setVerified.staticCall(collection, verified);
  console.log("DRY RUN: call would succeed. Nothing was sent.");
  process.exit(0);
}
const tx = await registryWithSigner.setVerified(collection, verified);
console.log("Tx hash:", tx.hash);
console.log("Etherscan:", `https://sepolia.etherscan.io/tx/${tx.hash}`);
const receipt = await tx.wait();
console.log("Block:", receipt.blockNumber);
const after = await registry.isVerified(collection);
console.log(`isVerified(${collection}) after:`, after);
if (after !== verified) fail("On-chain state did not change as expected.");
console.log(
  verified
    ? "Badge added — the collection now shows as verified on the site."
    : "Badge removed — the collection no longer shows as verified."
);

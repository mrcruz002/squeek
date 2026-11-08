# Squeekchain NFT Launchpad — Test Results

Last updated: **2026-11-06** (Phase 0–1, local testing only — no live deployment).

## Environment

- Foundry **1.9.0** (forge / cast / anvil)
- solc **0.8.24**, optimizer on, 200 runs
- OpenZeppelin Contracts **v5.7.0**, forge-std **v1.17.0**
- Node **v24.22.1**, npm **10.9.4**

## Foundry test suite — 25/25 PASS

Command: `forge test -vv` (in `contracts/`)

```
Ran 25 tests for test/SqueekLaunchpad.t.sol:SqueekLaunchpadTest
[PASS] testFuzz_MintExactPayment(uint8) (runs: 256, μ: 351276, ~: 365778)
[PASS] test_FactoryClonesAreIndependent() (gas: 677084)
[PASS] test_FactoryDeploysCloneWithCorrectState() (gas: 122310)
[PASS] test_FactoryRejectsCreatorMismatch() (gas: 42291)
[PASS] test_FactoryTracksCreatorCollections() (gas: 23752)
[PASS] test_ImplementationCannotBeInitialized() (gas: 45084)
[PASS] test_InitializeRejectsBadParams() (gas: 610364)
[PASS] test_MintEmitsTransferEvents() (gas: 240245)
[PASS] test_MintHappyPath() (gas: 445129)
[PASS] test_MintReentrancyBlocked() (gas: 517888)
[PASS] test_MintRevertsAfterSaleEnds() (gas: 68765)
[PASS] test_MintRevertsBeforeSaleStarts() (gas: 68686)
[PASS] test_MintRevertsOnOverpayment() (gas: 77873)
[PASS] test_MintRevertsOnUnderpayment() (gas: 77851)
[PASS] test_MintRevertsOnZeroQuantity() (gas: 57181)
[PASS] test_MintRevertsWhenExceedingPerWalletCap() (gas: 951054)
[PASS] test_MintRevertsWhenExceedingSupply() (gas: 1641625)
[PASS] test_RoyaltyInfoDefault5Percent() (gas: 13340)
[PASS] test_RoyaltyInfoRespectsInterface() (gas: 25272)
[PASS] test_SetBaseURIBeforeSale() (gas: 682305)
[PASS] test_SetBaseURIOnlyOwner() (gas: 431021)
[PASS] test_SetBaseURIRevertsAfterSaleStarts() (gas: 37452)
[PASS] test_WithdrawOnlyOwner() (gas: 308558)
[PASS] test_WithdrawReentrancyBlocked() (gas: 950038)
[PASS] test_WithdrawRevertsWhenEmpty() (gas: 56544)
Suite result: ok. 25 passed; 0 failed; 0 skipped; finished in 30.90ms
```

Coverage by area:

| Area | Tests |
|---|---|
| Mint happy path + events | `test_MintHappyPath`, `test_MintEmitsTransferEvents`, `testFuzz_MintExactPayment` (256 runs) |
| Price enforcement | `test_MintRevertsOnUnderpayment`, `test_MintRevertsOnOverpayment`, `test_MintRevertsOnZeroQuantity` |
| Supply cap | `test_MintRevertsWhenExceedingSupply` |
| Per-wallet cap | `test_MintRevertsWhenExceedingPerWalletCap` |
| Sale window | `test_MintRevertsBeforeSaleStarts`, `test_MintRevertsAfterSaleEnds` |
| Withdrawal (owner-only, empty, reentrancy) | `test_WithdrawOnlyOwner`, `test_WithdrawRevertsWhenEmpty`, `test_WithdrawReentrancyBlocked` |
| Mint reentrancy | `test_MintReentrancyBlocked` (malicious receiver contracts) |
| Royalties | `test_RoyaltyInfoDefault5Percent`, `test_RoyaltyInfoRespectsInterface` |
| Factory (clones, tracking, creator check, implementation lock) | `test_FactoryClonesAreIndependent`, `test_FactoryDeploysCloneWithCorrectState`, `test_FactoryRejectsCreatorMismatch`, `test_FactoryTracksCreatorCollections`, `test_ImplementationCannotBeInitialized` |
| Init validation + base URI rules | `test_InitializeRejectsBadParams`, `test_SetBaseURIBeforeSale`, `test_SetBaseURIOnlyOwner`, `test_SetBaseURIRevertsAfterSaleStarts` |

## Contract sizes (`forge build --sizes`)

| Contract | Runtime (bytes) | Init code (bytes) | Limit |
|---|---|---|---|
| SqueekCollection | 9,345 | 10,130 | 24,576 |
| CollectionFactory | 2,205 | 12,449 | 24,576 |

Both well under the 24,576-byte runtime limit.

## Anvil smoke test — COMPLETE, all steps verified

Local anvil, chain ID **11155111** (Sepolia), port **8545**.
Deployer = anvil account 0 (`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`),
minter = anvil account 1 (`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`).

1. **Factory deployed** — `0x5FbDB2315678afecb367f032d93F642f64180aa3`
   - Implementation: `0xa16E02E87b7454126E5E10d957A927A7F5B5d2be`
   - Tx `0x0938f453f8a7fb3457674009f41a089bdf8d982a19c4286dbeb78c0818d07cd2`, status success.
   - `implementation()` and `collectionCount()` (= 0) verified via cast.
2. **Demo collection created** — `0xB7A5bd0345EF1Cc5E66bf61BdeC17D2461fBd968`
   - "Demo Squeeks" (DSQK), max supply 100, 0.01 ETH, max 3/wallet, sale +60s to +7d, royalty 5%.
   - Created via `forge script script/CreateDemoCollection.s.sol --broadcast --start-fresh`.
   - `collectionCount()` = 1, `isCollection(demo)` = true.
3. **Minted 2 tokens** — tx `0x90cdd1c6785324e8ec2ce5953b1d256d929a833e063dfdc0acfec06b872acb5e`, status success, 0.02 ETH paid.
   - Token IDs **1 and 2** (IDs start at 1), both owned by the minter.
   - `totalSupply()` = 2, `balanceOf(minter)` = 2, `minted(minter)` = 2.
   - Transfer + Minted events emitted for both tokens.
   - `tokenURI(1)` = `ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/1` — base URI + token ID correct.
   - `royaltyInfo(1, 1 ether)` = (creator `0xf39F…`, **0.05 ETH**) — 5% royalty correct.
   - Contract ETH balance after mint: **0.02 ETH**.
4. **Withdraw as creator** — tx `0xabfd7b64fc65e4749c37a288ef90a3c41aea477846f9a5fdbf886137d69f6e5a`, status success.
   - Contract balance **0.02 ETH → 0**. Creator balance rose by ~0.02 ETH (minus gas).
   - Withdrawn event emitted.

Note: `ownerOf(0)` and `tokenURI(0)` correctly revert with `ERC721NonexistentToken(0)` — token IDs start at 1.

## Known quirk: anvil `--chain-id 11155111` inflates deployment gas (~6.8x)

Deploying the factory on anvil with `--chain-id 11155111` used **18,942,729 gas**; deploying the
SqueekCollection implementation alone used **15,333,764 gas**. Investigation:

- The same bytecode on a default anvil (chain ID 31337) estimates **953,204 gas** for a bare
  OZ ERC721, vs **6,499,512 gas** on anvil `--chain-id 11155111`.
- Reproduced on a **fresh** anvil with `--chain-id 11155111` (same 6,499,512 estimate), so it is
  not stale state — it is the chain-ID flag itself.
- A 1,500,000-gas-limit deployment on the 11155111 anvil genuinely fails out-of-gas, so the
  inflated metering is real inside that anvil instance, not a forge estimation artifact.
- Per-byte cost is consistent (~1,640 gas per deployed byte vs the normal ~200 for code
  deposit), i.e. a ~6.8x multiplier on deployment only.

**Impact: none on the deliverable.** Forge tests are unaffected (separate in-memory EVM),
the contracts deploy and behave correctly, and this is an anvil-local artifact — it does not
apply to the real Sepolia network. Expected real-Sepolia deployment cost is ~1–2M gas for the
factory (implementation included). If re-running the smoke test, a plain `anvil` (default
chain ID) avoids the inflation; the `--chain-id 11155111` anvil still works fine, it just
burns more fake gas (deployer has 10,000 test ETH).

## Known warnings (benign)

- `forge build` emits one lint warning: the factory emits `CollectionCreated` after the
  external `initialize()` call. This is intentional (the event must carry the fully
  initialised collection address) and not a reentrancy risk — `initialize()` can only run
  once per clone and the factory holds no funds.
- The first smoke-test run left a stale `broadcast/run-latest.recovery.lock`; `forge script
  --broadcast` refuses to run while a previous broadcast is unfinished. Fix: `rm -rf
  broadcast` and re-run with `--start-fresh`. (The lock is created by forge during the
  run, so deleting `broadcast/` alone is not enough — `--start-fresh` is required.)

## Not yet done

- **Frontend** — Vite + React + viem/wagmi, in progress (separate workstream).
- **No live Sepolia deployment** — scripts are prepared (`contracts/script/Deploy.s.sol`,
  `contracts/script/CreateDemoCollection.s.sol`) but never executed against a live network.
  See README.md for what is needed before that step.

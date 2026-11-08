// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CollectionFactory} from "../src/CollectionFactory.sol";
import {SqueekCollection} from "../src/SqueekCollection.sol";

/// @title Create a demo collection on an already-deployed factory (Sepolia)
/// @notice Prepared only — same rules as Deploy.s.sol: run on the deployer's
///         own machine with PRIVATE_KEY in the environment, never stored here.
///
///         Required env: FACTORY_ADDRESS, PRIVATE_KEY
///         Optional env (defaults shown):
///           COLLECTION_NAME=Demo Squeeks   COLLECTION_SYMBOL=DSQK
///           BASE_URI=ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/
///           MAX_SUPPLY=100  MINT_PRICE_WEI=10000000000000000  MAX_PER_WALLET=3
///           SALE_START=<now+60>  SALE_END=<now+7d>  ROYALTY_BPS=500
///
///         The caller of this script becomes the collection creator/owner.
contract CreateDemoCollection is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address factoryAddress = vm.envAddress("FACTORY_ADDRESS");
        require(block.chainid == 11155111, "CreateDemoCollection: expected Sepolia (11155111)");

        SqueekCollection.InitParams memory params = SqueekCollection.InitParams({
            creator: vm.addr(deployerKey),
            name: vm.envOr("COLLECTION_NAME", string("Demo Squeeks")),
            symbol: vm.envOr("COLLECTION_SYMBOL", string("DSQK")),
            baseURI: vm.envOr(
                "BASE_URI",
                string("ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/")
            ),
            maxSupply: vm.envOr("MAX_SUPPLY", uint256(100)),
            mintPrice: vm.envOr("MINT_PRICE_WEI", uint256(0.01 ether)),
            maxPerWallet: vm.envOr("MAX_PER_WALLET", uint256(3)),
            saleStart: uint64(vm.envOr("SALE_START", block.timestamp + 60)),
            saleEnd: uint64(vm.envOr("SALE_END", block.timestamp + 7 days)),
            royaltyReceiver: vm.addr(deployerKey),
            royaltyBps: uint96(vm.envOr("ROYALTY_BPS", uint256(500)))
        });

        vm.startBroadcast(deployerKey);
        address collection =
            CollectionFactory(factoryAddress).createCollection(params);
        vm.stopBroadcast();

        console.log("Collection deployed:", collection);
        console.log("Name:", params.name);
        console.log("Max supply:", params.maxSupply);
        console.log("Mint price (wei):", params.mintPrice);
    }
}

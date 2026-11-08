// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CollectionFactory} from "../src/CollectionFactory.sol";

/// @title Deploy the Squeekchain launchpad factory to Sepolia (chain ID 11155111)
/// @notice Prepared only — DO NOT run without a funded deployer wallet and the
///         user's go-ahead. The deployer key is never stored in this repo; it is
///         passed at runtime via the PRIVATE_KEY environment variable, on the
///         machine that runs the deploy (the user's own computer, local-run route).
///
///         Example (from contracts/):
///           export PRIVATE_KEY=0x...            # deployer key, never committed
///           forge script script/Deploy.s.sol:Deploy \
///             --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
///             --broadcast --verify --etherscan-api-key $ETHERSCAN_API_KEY
///
///         The factory constructor deploys the SqueekCollection implementation,
///         so one transaction sets up the whole launchpad. Record the printed
///         factory address in frontend/src/config.ts afterwards.
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);
        require(block.chainid == 11155111, "Deploy: expected Sepolia (11155111)");

        vm.startBroadcast(deployerKey);
        CollectionFactory factory = new CollectionFactory();
        vm.stopBroadcast();

        console.log("CollectionFactory deployed:", address(factory));
        console.log("Implementation:", factory.implementation());
    }
}

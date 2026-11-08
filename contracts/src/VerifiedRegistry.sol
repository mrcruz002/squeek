// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice On-chain registry of marketplace-verified collections.
///
/// Only the owner (the marketplace operator, 0x3ade5ce6a61c5a22dbb509cb847960759c88d35d
/// on Sepolia) can set or remove a badge. The frontend shows a verified badge
/// next to a collection's name only when this registry says it is verified.
/// No upgradeability, no other roles.
contract VerifiedRegistry is Ownable {
    mapping(address => bool) public verified;

    event VerifiedSet(address indexed collection, bool verified);

    constructor(address owner_) Ownable(owner_) {}

    function isVerified(address collection) external view returns (bool) {
        return verified[collection];
    }

    function setVerified(address collection, bool verified_) external onlyOwner {
        verified[collection] = verified_;
        emit VerifiedSet(collection, verified_);
    }
}

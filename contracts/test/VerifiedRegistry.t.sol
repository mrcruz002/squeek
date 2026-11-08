// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {VerifiedRegistry} from "../src/VerifiedRegistry.sol";

contract VerifiedRegistryTest is Test {
    address public constant OPERATOR =
        0x3adE5ce6A61c5A22Dbb509CB847960759C88d35D;
    address public constant SQUEEK =
        0xC4C7982657f00509548F3a3a41db7FA439a6856B;
    address public constant OTHER =
        0x9Ba898622E30E2eB88B26143c6b1070789A5390f;

    VerifiedRegistry public registry;

    event VerifiedSet(address indexed collection, bool verified);

    function setUp() public {
        registry = new VerifiedRegistry(OPERATOR);
    }

    function testOwnerIsOperator() public view {
        assertEq(registry.owner(), OPERATOR);
    }

    function testUnverifiedByDefault() public view {
        assertFalse(registry.isVerified(SQUEEK));
        assertFalse(registry.verified(SQUEEK));
    }

    function testSetVerifiedRoundTrip() public {
        vm.prank(OPERATOR);
        registry.setVerified(SQUEEK, true);
        assertTrue(registry.isVerified(SQUEEK));
        assertTrue(registry.verified(SQUEEK));

        vm.prank(OPERATOR);
        registry.setVerified(SQUEEK, false);
        assertFalse(registry.isVerified(SQUEEK));
        assertFalse(registry.verified(SQUEEK));
    }

    function testOnlyOwnerCanSetVerified() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                Ownable.OwnableUnauthorizedAccount.selector,
                stranger
            )
        );
        registry.setVerified(SQUEEK, true);
        assertFalse(registry.isVerified(SQUEEK));
    }

    function testOnlyOwnerCanUnsetVerified() public {
        vm.prank(OPERATOR);
        registry.setVerified(SQUEEK, true);

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                Ownable.OwnableUnauthorizedAccount.selector,
                stranger
            )
        );
        registry.setVerified(SQUEEK, false);
        assertTrue(registry.isVerified(SQUEEK));
    }

    function testEmitsVerifiedSetOnSet() public {
        vm.expectEmit(true, false, false, true, address(registry));
        emit VerifiedSet(SQUEEK, true);
        vm.prank(OPERATOR);
        registry.setVerified(SQUEEK, true);
    }

    function testEmitsVerifiedSetOnUnset() public {
        vm.prank(OPERATOR);
        registry.setVerified(SQUEEK, true);

        vm.expectEmit(true, false, false, true, address(registry));
        emit VerifiedSet(SQUEEK, false);
        vm.prank(OPERATOR);
        registry.setVerified(SQUEEK, false);
    }

    function testCollectionsAreIndependent() public {
        vm.prank(OPERATOR);
        registry.setVerified(SQUEEK, true);
        assertTrue(registry.isVerified(SQUEEK));
        assertFalse(registry.isVerified(OTHER));
    }
}

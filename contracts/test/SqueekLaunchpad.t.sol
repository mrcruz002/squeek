// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {CollectionFactory} from "../src/CollectionFactory.sol";
import {SqueekCollection} from "../src/SqueekCollection.sol";

/// @notice Tries to re-enter mint() from inside the ERC-721 receive hook.
contract ReentrantMinter is IERC721Receiver {
    SqueekCollection public target;
    uint256 public price;

    constructor(SqueekCollection _target, uint256 _price) {
        target = _target;
        price = _price;
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        override
        returns (bytes4)
    {
        // Re-enter the collection's mint while the first mint is still running.
        target.mint{value: price}(1);
        return this.onERC721Received.selector;
    }

    receive() external payable {}
}

/// @notice Tries to re-enter withdraw() from inside the payout receive hook.
contract ReentrantOwner is IERC721Receiver {
    SqueekCollection public target;

    function setTarget(SqueekCollection _target) external {
        target = _target;
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return this.onERC721Received.selector;
    }

    receive() external payable {
        // Re-enter withdraw while the first withdraw is still paying out.
        target.withdraw();
    }
}

contract SqueekLaunchpadTest is Test {
    CollectionFactory public factory;
    SqueekCollection public collection;

    address public creator = address(0xC0FFEE);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    uint256 public constant PRICE = 0.01 ether;
    uint256 public constant MAX_SUPPLY = 10;
    uint256 public constant MAX_PER_WALLET = 3;
    uint64 public saleStart;
    uint64 public saleEnd;

    function setUp() public {
        factory = new CollectionFactory();
        saleStart = uint64(block.timestamp + 100);
        saleEnd = uint64(block.timestamp + 7 days);
        collection = SqueekCollection(factory.createCollection(_params()));
        // Move inside the sale window for the default tests.
        vm.warp(saleStart + 1);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(creator, 100 ether);
    }

    function _params() internal view returns (SqueekCollection.InitParams memory) {
        return SqueekCollection.InitParams({
            creator: address(this),
            name: "Squeek Testers",
            symbol: "SQT",
            baseURI: "ipfs://testcid/",
            maxSupply: MAX_SUPPLY,
            mintPrice: PRICE,
            maxPerWallet: MAX_PER_WALLET,
            saleStart: saleStart,
            saleEnd: saleEnd,
            royaltyReceiver: address(this),
            royaltyBps: 500 // 5%
        });
    }

    function _paramsFor(address _creator) internal view returns (SqueekCollection.InitParams memory) {
        SqueekCollection.InitParams memory p = _params();
        p.creator = _creator;
        return p;
    }

    // --- Factory ---

    function test_FactoryDeploysCloneWithCorrectState() public view {
        assertTrue(factory.isCollection(address(collection)));
        assertEq(factory.collectionCount(), 1);
        assertEq(collection.name(), "Squeek Testers");
        assertEq(collection.symbol(), "SQT");
        assertEq(collection.owner(), address(this));
        assertEq(collection.maxSupply(), MAX_SUPPLY);
        assertEq(collection.mintPrice(), PRICE);
        assertEq(collection.maxPerWallet(), MAX_PER_WALLET);
        assertEq(collection.saleStart(), saleStart);
        assertEq(collection.saleEnd(), saleEnd);
        assertEq(collection.totalMinted(), 0);
    }

    function test_FactoryClonesAreIndependent() public {
        SqueekCollection second =
            SqueekCollection(factory.createCollection(_paramsFor(address(this))));
        assertTrue(second != collection);
        assertEq(factory.collectionCount(), 2);

        vm.prank(alice);
        collection.mint{value: PRICE}(1);
        assertEq(collection.totalMinted(), 1);
        assertEq(second.totalMinted(), 0);
        assertEq(collection.balanceOf(alice), 1);
        assertEq(second.balanceOf(alice), 0);
    }

    function test_FactoryTracksCreatorCollections() public view {
        address[] memory mine = factory.collectionsOf(address(this));
        assertEq(mine.length, 1);
        assertEq(mine[0], address(collection));
        assertEq(factory.collectionsOf(alice).length, 0);
    }

    function test_FactoryRejectsCreatorMismatch() public {
        SqueekCollection.InitParams memory p = _paramsFor(alice); // creator != caller
        vm.expectRevert(bytes("Factory: creator must be caller"));
        factory.createCollection(p);
    }

    function test_ImplementationCannotBeInitialized() public {
        address impl = factory.implementation();
        SqueekCollection.InitParams memory p = _params();
        vm.expectRevert();
        SqueekCollection(impl).initialize(p);
    }

    // --- Mint happy path ---

    function test_MintHappyPath() public {
        vm.prank(alice);
        collection.mint{value: PRICE * 2}(2);

        assertEq(collection.totalMinted(), 2);
        assertEq(collection.balanceOf(alice), 2);
        assertEq(collection.ownerOf(1), alice);
        assertEq(collection.ownerOf(2), alice);
        assertEq(collection.mintedBy(alice), 2);
        assertEq(address(collection).balance, PRICE * 2);
        assertEq(collection.tokenURI(1), "ipfs://testcid/1");
        assertEq(collection.tokenURI(2), "ipfs://testcid/2");
    }

    function test_MintEmitsTransferEvents() public {
        vm.expectEmit(true, true, true, true);
        emit Transfer(address(0), alice, 1);
        vm.prank(alice);
        collection.mint{value: PRICE}(1);
    }

    // --- Mint guards ---

    function test_MintRevertsOnUnderpayment() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                SqueekCollection.IncorrectPayment.selector, PRICE, PRICE - 1 wei
            )
        );
        collection.mint{value: PRICE - 1 wei}(1);
    }

    function test_MintRevertsOnOverpayment() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                SqueekCollection.IncorrectPayment.selector, PRICE, PRICE + 1 wei
            )
        );
        collection.mint{value: PRICE + 1 wei}(1);
    }

    function test_MintRevertsOnZeroQuantity() public {
        vm.prank(alice);
        vm.expectRevert(SqueekCollection.InvalidQuantity.selector);
        collection.mint{value: 0}(0);
    }

    function test_MintRevertsBeforeSaleStarts() public {
        vm.warp(saleStart - 1);
        vm.prank(alice);
        vm.expectRevert(SqueekCollection.SaleNotActive.selector);
        collection.mint{value: PRICE}(1);
    }

    function test_MintRevertsAfterSaleEnds() public {
        vm.warp(saleEnd + 1);
        vm.prank(alice);
        vm.expectRevert(SqueekCollection.SaleNotActive.selector);
        collection.mint{value: PRICE}(1);
    }

    function test_MintRevertsWhenExceedingSupply() public {
        address carol = address(0xCA901);
        address dave = address(0xDA9E);
        vm.deal(carol, 1 ether);
        vm.deal(dave, 1 ether);

        // Fill the collection: alice 3 + bob 3 + carol 3 = 9 of 10.
        vm.prank(alice);
        collection.mint{value: PRICE * 3}(3);
        vm.prank(bob);
        collection.mint{value: PRICE * 3}(3);
        vm.prank(carol);
        collection.mint{value: PRICE * 3}(3);
        assertEq(collection.totalMinted(), 9);

        // Only 1 left; asking for 2 must fail.
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(SqueekCollection.ExceedsMaxSupply.selector, 11, 10)
        );
        collection.mint{value: PRICE * 2}(2);

        // Minting the last 1 works from a fresh wallet.
        vm.prank(dave);
        collection.mint{value: PRICE}(1);
        assertEq(collection.totalMinted(), 10);

        // Sold out.
        vm.prank(dave);
        vm.expectRevert(
            abi.encodeWithSelector(SqueekCollection.ExceedsMaxSupply.selector, 11, 10)
        );
        collection.mint{value: PRICE}(1);
    }

    function test_MintRevertsWhenExceedingPerWalletCap() public {
        vm.prank(alice);
        collection.mint{value: PRICE * 3}(3);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(SqueekCollection.ExceedsMaxPerWallet.selector, 4, 3)
        );
        collection.mint{value: PRICE}(1);
        // Bob is unaffected.
        vm.prank(bob);
        collection.mint{value: PRICE * 3}(3);
    }

    // --- Fuzz: payment math ---

    function testFuzz_MintExactPayment(uint8 quantity) public {
        quantity = uint8(bound(uint256(quantity), 1, MAX_PER_WALLET));
        vm.prank(alice);
        collection.mint{value: PRICE * quantity}(quantity);
        assertEq(collection.totalMinted(), quantity);
        assertEq(address(collection).balance, PRICE * quantity);
    }

    // --- Withdraw ---

    function test_WithdrawOnlyOwner() public {
        vm.prank(alice);
        collection.mint{value: PRICE}(1);

        vm.prank(alice);
        vm.expectRevert(SqueekCollection.NotOwner.selector);
        collection.withdraw();

        uint256 before = address(this).balance;
        collection.withdraw();
        assertEq(address(collection).balance, 0);
        assertEq(address(this).balance, before + PRICE);
    }

    function test_WithdrawRevertsWhenEmpty() public {
        vm.expectRevert(SqueekCollection.NothingToWithdraw.selector);
        collection.withdraw();
    }

    // --- Reentrancy ---

    function test_MintReentrancyBlocked() public {
        ReentrantMinter attacker = new ReentrantMinter(collection, PRICE);
        vm.deal(address(attacker), 10 ether);

        vm.prank(address(attacker));
        vm.expectRevert();
        collection.mint{value: PRICE}(1);

        // Nothing was minted by the attack.
        assertEq(collection.totalMinted(), 0);
        assertEq(collection.balanceOf(address(attacker)), 0);
    }

    function test_WithdrawReentrancyBlocked() public {
        // Collection owned by the malicious contract.
        ReentrantOwner attacker = new ReentrantOwner();
        // Deploy a second collection whose creator IS the attacker contract.
        vm.prank(address(attacker));
        SqueekCollection victim =
            SqueekCollection(factory.createCollection(_paramsFor(address(attacker))));
        // Point the attacker at the victim so the re-entry targets the same contract.
        attacker.setTarget(victim);

        vm.prank(alice);
        victim.mint{value: PRICE}(1);
        assertEq(address(victim).balance, PRICE);

        vm.prank(address(attacker));
        vm.expectRevert(SqueekCollection.WithdrawFailed.selector);
        victim.withdraw();

        // Funds are still there; the re-entrant drain failed.
        assertEq(address(victim).balance, PRICE);
        assertEq(address(attacker).balance, 0);
    }

    // --- Royalties ---

    function test_RoyaltyInfoDefault5Percent() public view {
        (address receiver, uint256 amount) = collection.royaltyInfo(1, 1 ether);
        assertEq(receiver, address(this));
        assertEq(amount, 0.05 ether);
    }

    function test_RoyaltyInfoRespectsInterface() public view {
        assertTrue(collection.supportsInterface(0x2a55205a)); // ERC-2981
        assertTrue(collection.supportsInterface(0x80ac58cd)); // ERC-721
        assertTrue(collection.supportsInterface(0x780e9d63)); // ERC-721 enumerable
    }

    // --- Base URI ---

    function test_SetBaseURIBeforeSale() public {
        // Fresh collection whose sale starts in the future (setUp already
        // warped inside the default collection's sale window).
        SqueekCollection.InitParams memory p = _paramsFor(address(this));
        p.saleStart = uint64(block.timestamp + 1000);
        p.saleEnd = uint64(block.timestamp + 1000 + 7 days);
        SqueekCollection fresh = SqueekCollection(factory.createCollection(p));
        fresh.setBaseURI("ipfs://newcid/");
        // Mint after warping into the fresh collection's window and check the new URI.
        vm.warp(p.saleStart + 1);
        vm.prank(alice);
        fresh.mint{value: PRICE}(1);
        assertEq(fresh.tokenURI(1), "ipfs://newcid/1");
    }

    function test_SetBaseURIRevertsAfterSaleStarts() public {
        vm.expectRevert(SqueekCollection.SaleAlreadyStarted.selector);
        collection.setBaseURI("ipfs://newcid/");
    }

    function test_SetBaseURIOnlyOwner() public {
        SqueekCollection fresh =
            SqueekCollection(factory.createCollection(_paramsFor(address(this))));
        vm.prank(alice);
        vm.expectRevert(SqueekCollection.NotOwner.selector);
        fresh.setBaseURI("ipfs://newcid/");
    }

    // --- Init validation ---

    function test_InitializeRejectsBadParams() public {
        SqueekCollection.InitParams memory p;

        p = _params();
        p.maxSupply = 0;
        vm.expectRevert(SqueekCollection.InvalidMaxSupply.selector);
        factory.createCollection(p);

        p = _params();
        p.maxPerWallet = 0;
        vm.expectRevert(SqueekCollection.InvalidMaxPerWallet.selector);
        factory.createCollection(p);

        p = _params();
        p.maxPerWallet = MAX_SUPPLY + 1;
        vm.expectRevert(SqueekCollection.InvalidMaxPerWallet.selector);
        factory.createCollection(p);

        p = _params();
        p.saleStart = p.saleEnd;
        vm.expectRevert(SqueekCollection.InvalidSaleWindow.selector);
        factory.createCollection(p);

        p = _params();
        p.royaltyBps = 1001;
        vm.expectRevert(
            abi.encodeWithSelector(SqueekCollection.RoyaltyTooHigh.selector, 1001)
        );
        factory.createCollection(p);

        p = _params();
        p.royaltyReceiver = address(0);
        vm.expectRevert(SqueekCollection.RoyaltyReceiverZero.selector);
        factory.createCollection(p);
    }

    // forge-std Transfer event for expectEmit
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    // The test contract is the collection owner, so it must accept ETH payouts.
    receive() external payable {}
}

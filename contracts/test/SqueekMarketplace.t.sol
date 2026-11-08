// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {SqueekMarketplace} from "../src/SqueekMarketplace.sol";

/// @notice Minimal ERC-721 with ERC-2981 royalties, for marketplace tests.
contract MockERC721 is ERC721, ERC2981 {
    uint256 public nextId = 1;

    constructor(string memory name_, string memory symbol_)
        ERC721(name_, symbol_)
    {}

    function mint(address to) external returns (uint256 tokenId) {
        tokenId = nextId;
        nextId += 1;
        _safeMint(to, tokenId);
    }

    function setRoyalty(address receiver, uint96 bps) external {
        _setDefaultRoyalty(receiver, bps);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}

/// @notice Plain ERC-721 with no royalty support, for the no-royalty path.
contract MockERC721NoRoyalty is ERC721 {
    uint256 public nextId = 1;

    constructor() ERC721("NoRoyalty", "NR") {}

    function mint(address to) external returns (uint256 tokenId) {
        tokenId = nextId;
        nextId += 1;
        _safeMint(to, tokenId);
    }
}

/// @notice Royalty receiver that tries to re-enter buy() when it is paid.
contract ReentrantRoyaltyReceiver {
    SqueekMarketplace public market;
    uint256 public targetListing;

    function setTarget(SqueekMarketplace _market, uint256 _listingId) external {
        market = _market;
        targetListing = _listingId;
    }

    receive() external payable {
        // Re-enter buy() while the first buy is still paying out.
        market.buy{value: 1 ether}(targetListing);
    }
}

contract SqueekMarketplaceTest is Test {
    SqueekMarketplace public market;
    MockERC721 public collection;
    MockERC721NoRoyalty public plainCollection;

    address public creator = address(0xC0FFEE);
    address public seller = address(0x5E11E2);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    uint256 public constant PRICE = 1 ether;

    function setUp() public {
        market = new SqueekMarketplace();
        collection = new MockERC721("Mock Squeeks", "MSQK");
        plainCollection = new MockERC721NoRoyalty();
        collection.setRoyalty(creator, 500); // 5% to creator

        vm.deal(seller, 10 ether);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(creator, 0);

        // Seller holds tokens 1, 2, 3 in the royalty collection.
        collection.mint(seller);
        collection.mint(seller);
        collection.mint(seller);
        // Seller holds token 1 in the no-royalty collection.
        plainCollection.mint(seller);
    }

    // --- helpers ---

    function _list(uint256 tokenId, uint256 price)
        internal
        returns (uint256)
    {
        return _listFor(tokenId, price, 30 days);
    }

    function _listFor(uint256 tokenId, uint256 price, uint64 duration)
        internal
        returns (uint256)
    {
        vm.prank(seller);
        collection.approve(address(market), tokenId);
        vm.prank(seller);
        return market.list(address(collection), tokenId, price, duration);
    }

    // --- listings ---

    function testListMovesNftIntoEscrow() public {
        uint256 id = _list(1, PRICE);
        assertEq(id, 1);
        assertEq(collection.ownerOf(1), address(market));
        (address s, , , uint256 p, uint64 e, bool active) = market.listings(id);
        assertEq(s, seller);
        assertEq(p, PRICE);
        assertEq(e, uint64(block.timestamp + 30 days));
        assertTrue(active);
        assertEq(market.listingOf(address(collection), 1), id);
    }

    function testListNotOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert(SqueekMarketplace.NotTokenOwner.selector);
        market.list(address(collection), 1, PRICE, 30 days);
    }

    function testListZeroPriceReverts() public {
        vm.prank(seller);
        collection.approve(address(market), 1);
        vm.prank(seller);
        vm.expectRevert(SqueekMarketplace.InvalidPrice.selector);
        market.list(address(collection), 1, 0, 30 days);
    }

    function testListZeroDurationReverts() public {
        vm.prank(seller);
        collection.approve(address(market), 1);
        vm.prank(seller);
        vm.expectRevert(SqueekMarketplace.InvalidExpiry.selector);
        market.list(address(collection), 1, PRICE, 0);
    }

    function testListAlreadyListedReverts() public {
        _list(1, PRICE);
        vm.prank(seller);
        vm.expectRevert(SqueekMarketplace.AlreadyListed.selector);
        market.list(address(collection), 1, PRICE, 30 days);
    }

    function testBuyPaysSellerMinusRoyalty() public {
        uint256 id = _list(1, PRICE);
        uint256 sellerBefore = seller.balance;
        uint256 creatorBefore = creator.balance;

        vm.prank(alice);
        market.buy{value: PRICE}(id);

        assertEq(collection.ownerOf(1), alice);
        assertEq(seller.balance, sellerBefore + 0.95 ether);
        assertEq(creator.balance, creatorBefore + 0.05 ether);
        (, , , , , bool active) = market.listings(id);
        assertFalse(active);
        assertEq(market.listingOf(address(collection), 1), 0);
    }

    function testBuyWrongPriceReverts() public {
        uint256 id = _list(1, PRICE);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                SqueekMarketplace.IncorrectPayment.selector, PRICE, 0.9 ether
            )
        );
        market.buy{value: 0.9 ether}(id);
    }

    function testBuyOwnListingReverts() public {
        uint256 id = _list(1, PRICE);
        vm.prank(seller);
        vm.expectRevert(SqueekMarketplace.CannotBuyOwnListing.selector);
        market.buy{value: PRICE}(id);
    }

    function testBuyInactiveReverts() public {
        uint256 id = _list(1, PRICE);
        vm.prank(alice);
        market.buy{value: PRICE}(id);
        vm.prank(bob);
        vm.expectRevert(SqueekMarketplace.ListingNotActive.selector);
        market.buy{value: PRICE}(id);
    }

    function testCancelListingReturnsNft() public {
        uint256 id = _list(1, PRICE);
        vm.prank(seller);
        market.cancelListing(id);
        assertEq(collection.ownerOf(1), seller);
        (, , , , , bool active) = market.listings(id);
        assertFalse(active);
    }

    function testCancelListingNotSellerReverts() public {
        uint256 id = _list(1, PRICE);
        vm.prank(alice);
        vm.expectRevert(SqueekMarketplace.NotSeller.selector);
        market.cancelListing(id);
    }

    function testBuyNoRoyaltyCollectionPaysSellerInFull() public {
        vm.prank(seller);
        plainCollection.approve(address(market), 1);
        vm.prank(seller);
        uint256 id = market.list(address(plainCollection), 1, PRICE, 30 days);

        uint256 sellerBefore = seller.balance;
        vm.prank(alice);
        market.buy{value: PRICE}(id);
        assertEq(plainCollection.ownerOf(1), alice);
        assertEq(seller.balance, sellerBefore + PRICE);
    }

    // --- listing expiry (v3) ---

    function testListStoresExpiry() public {
        uint256 before = block.timestamp;
        uint256 id = _listFor(1, PRICE, 7 days);
        (, , , , uint64 e, bool active) = market.listings(id);
        assertEq(e, uint64(before + 7 days));
        assertTrue(active);
        assertEq(market.activeListingOf(address(collection), 1), id);
    }

    function testBuyBeforeExpiryWorks() public {
        uint256 id = _listFor(1, PRICE, 1 days);
        vm.warp(block.timestamp + 12 hours);
        vm.prank(alice);
        market.buy{value: PRICE}(id);
        assertEq(collection.ownerOf(1), alice);
    }

    function testBuyAfterExpiryReverts() public {
        uint256 id = _listFor(1, PRICE, 1 days);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(alice);
        vm.expectRevert(SqueekMarketplace.ListingExpired.selector);
        market.buy{value: PRICE}(id);
        // NFT is still in escrow; the listing is still the recorded one.
        assertEq(collection.ownerOf(1), address(market));
        assertEq(market.listingOf(address(collection), 1), id);
    }

    function testActiveListingOfReturnsZeroAfterExpiry() public {
        uint256 id = _listFor(1, PRICE, 1 days);
        assertEq(market.activeListingOf(address(collection), 1), id);
        vm.warp(block.timestamp + 1 days + 1);
        assertEq(market.activeListingOf(address(collection), 1), 0);
    }

    function testRelistAfterExpiryWithoutCancel() public {
        uint256 firstId = _listFor(1, PRICE, 1 days);
        vm.warp(block.timestamp + 2 days);
        // No cancel: the seller re-lists straight from escrow. The NFT
        // never leaves the marketplace, and the old listing is closed.
        vm.prank(seller);
        uint256 secondId = market.list(
            address(collection), 1, 2 ether, 30 days
        );
        assertTrue(secondId != firstId);
        assertEq(collection.ownerOf(1), address(market));
        assertEq(market.activeListingOf(address(collection), 1), secondId);
        (, , , , , bool oldActive) = market.listings(firstId);
        assertFalse(oldActive);
        (, , , uint256 p, uint64 e, bool active) = market.listings(secondId);
        assertEq(p, 2 ether);
        assertEq(e, uint64(block.timestamp + 30 days));
        assertTrue(active);
        // And the re-listed token can be bought.
        vm.prank(alice);
        market.buy{value: 2 ether}(secondId);
        assertEq(collection.ownerOf(1), alice);
    }

    function testRelistAfterExpiryByNonSellerReverts() public {
        _listFor(1, PRICE, 1 days);
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice);
        vm.expectRevert(SqueekMarketplace.NotTokenOwner.selector);
        market.list(address(collection), 1, PRICE, 30 days);
    }

    function testCancelExpiredListingReturnsNft() public {
        uint256 id = _listFor(1, PRICE, 1 days);
        vm.warp(block.timestamp + 2 days);
        vm.prank(seller);
        market.cancelListing(id);
        assertEq(collection.ownerOf(1), seller);
        (, , , , , bool active) = market.listings(id);
        assertFalse(active);
        assertEq(market.listingOf(address(collection), 1), 0);
    }

    function testAcceptOfferOnExpiredListingStillSellsFromEscrow() public {
        uint256 listingId = _listFor(2, PRICE, 1 days);
        uint256 offerId = _offer(
            bob, address(collection), 2, 0.9 ether, uint64(block.timestamp + 30 days)
        );
        vm.warp(block.timestamp + 2 days); // listing expired, offer live
        assertEq(market.activeListingOf(address(collection), 2), 0);

        uint256 sellerBefore = seller.balance;
        vm.prank(seller);
        market.acceptOffer(offerId);

        assertEq(collection.ownerOf(2), bob);
        assertEq(seller.balance, sellerBefore + 0.855 ether);
        (, , , , , bool listingActive) = market.listings(listingId);
        assertFalse(listingActive);
        assertEq(market.listingOf(address(collection), 2), 0);
    }

    function testAcceptCollectionOfferOnExpiredListingStillSellsFromEscrow() public {
        uint256 listingId = _listFor(2, PRICE, 1 days);
        vm.prank(bob);
        uint256 collectionOfferId = market.makeCollectionOffer{value: 1 ether}(
            address(collection), 1 ether, 1, 0, uint64(block.timestamp + 30 days)
        );
        vm.warp(block.timestamp + 2 days); // listing expired, offer live

        vm.prank(seller);
        market.acceptCollectionOffer(collectionOfferId, 2);

        assertEq(collection.ownerOf(2), bob);
        (, , , , , bool listingActive) = market.listings(listingId);
        assertFalse(listingActive);
    }

    // --- offers ---

    function _offer(
        address bidder,
        address coll,
        uint256 tokenId,
        uint256 price,
        uint64 expiry
    ) internal returns (uint256) {
        vm.prank(bidder);
        return market.makeOffer{value: price}(coll, tokenId, price, expiry);
    }

    function testMakeOfferEscrowsEth() public {
        uint256 id = _offer(bob, address(collection), 2, 0.8 ether, uint64(block.timestamp + 1 days));
        assertEq(id, 1);
        assertEq(address(market).balance, 0.8 ether);
        (address b,,, uint256 p, uint64 e, bool active) = market.offers(id);
        assertEq(b, bob);
        assertEq(p, 0.8 ether);
        assertEq(e, uint64(block.timestamp + 1 days));
        assertTrue(active);
    }

    function testMakeOfferWrongValueReverts() public {
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                SqueekMarketplace.IncorrectPayment.selector, 0.8 ether, 0.7 ether
            )
        );
        market.makeOffer{value: 0.7 ether}(
            address(collection), 2, 0.8 ether, uint64(block.timestamp + 1 days)
        );
    }

    function testMakeOfferExpiredReverts() public {
        vm.prank(bob);
        vm.expectRevert(SqueekMarketplace.InvalidExpiry.selector);
        market.makeOffer{value: 0.8 ether}(
            address(collection), 2, 0.8 ether, uint64(block.timestamp)
        );
    }

    function testMakeOfferOnOwnTokenReverts() public {
        vm.prank(seller);
        vm.expectRevert(SqueekMarketplace.CannotBidOwnToken.selector);
        market.makeOffer{value: 0.8 ether}(
            address(collection), 2, 0.8 ether, uint64(block.timestamp + 1 days)
        );
    }

    function testAcceptOfferUnlistedPaysSellerMinusRoyalty() public {
        uint256 id = _offer(
            bob, address(collection), 2, 0.8 ether, uint64(block.timestamp + 1 days)
        );
        vm.prank(seller);
        collection.approve(address(market), 2);

        uint256 sellerBefore = seller.balance;
        uint256 creatorBefore = creator.balance;
        vm.prank(seller);
        market.acceptOffer(id);

        assertEq(collection.ownerOf(2), bob);
        assertEq(seller.balance, sellerBefore + 0.76 ether);
        assertEq(creator.balance, creatorBefore + 0.04 ether);
        (, , , , , bool active) = market.offers(id);
        assertFalse(active);
    }

    function testAcceptOfferOnListedTokenCancelsListing() public {
        uint256 listingId = _list(2, PRICE);
        uint256 offerId = _offer(
            bob, address(collection), 2, 0.9 ether, uint64(block.timestamp + 1 days)
        );

        uint256 sellerBefore = seller.balance;
        vm.prank(seller);
        market.acceptOffer(offerId);

        assertEq(collection.ownerOf(2), bob);
        // 0.9 ETH minus 5% royalty = 0.855 to seller.
        assertEq(seller.balance, sellerBefore + 0.855 ether);
        (, , , , , bool listingActive) = market.listings(listingId);
        assertFalse(listingActive);
        assertEq(market.listingOf(address(collection), 2), 0);
    }

    function testAcceptOfferNotSellerOrOwnerReverts() public {
        uint256 id = _offer(
            bob, address(collection), 2, 0.8 ether, uint64(block.timestamp + 1 days)
        );
        vm.prank(alice);
        vm.expectRevert(SqueekMarketplace.NotSellerOrOwner.selector);
        market.acceptOffer(id);
    }

    function testAcceptExpiredOfferReverts() public {
        uint256 id = _offer(
            bob, address(collection), 2, 0.8 ether, uint64(block.timestamp + 1 days)
        );
        vm.warp(block.timestamp + 2 days);
        vm.prank(seller);
        vm.expectRevert(SqueekMarketplace.OfferExpired.selector);
        market.acceptOffer(id);
    }

    function testCancelOfferRefundsBidder() public {
        uint256 id = _offer(
            bob, address(collection), 2, 0.8 ether, uint64(block.timestamp + 1 days)
        );
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        market.cancelOffer(id);
        assertEq(bob.balance, bobBefore + 0.8 ether);
        (, , , , , bool active) = market.offers(id);
        assertFalse(active);
    }

    function testCancelOfferNotBidderReverts() public {
        uint256 id = _offer(
            bob, address(collection), 2, 0.8 ether, uint64(block.timestamp + 1 days)
        );
        vm.prank(alice);
        vm.expectRevert(SqueekMarketplace.NotBidder.selector);
        market.cancelOffer(id);
    }

    function testCancelExpiredOfferByAnyoneRefundsBidder() public {
        uint256 id = _offer(
            bob, address(collection), 2, 0.8 ether, uint64(block.timestamp + 1 days)
        );
        vm.warp(block.timestamp + 2 days);
        uint256 bobBefore = bob.balance;
        vm.prank(alice);
        market.cancelOffer(id);
        assertEq(bob.balance, bobBefore + 0.8 ether);
    }

    function testOfferOnNonexistentTokenReverts() public {
        vm.prank(bob);
        vm.expectRevert();
        market.makeOffer{value: 0.8 ether}(
            address(collection), 999, 0.8 ether, uint64(block.timestamp + 1 days)
        );
    }

    // --- reentrancy ---

    function testReentrantRoyaltyReceiverCannotDrainListing() public {
        ReentrantRoyaltyReceiver attacker = new ReentrantRoyaltyReceiver();
        // Point the collection royalty at the attacker.
        collection.setRoyalty(address(attacker), 500);

        uint256 listingId = _list(1, PRICE);
        attacker.setTarget(market, listingId);

        // The buy reverts: the royalty payout triggers a re-entrant buy(),
        // which the nonReentrant guard blocks, unwinding the whole purchase.
        vm.prank(alice);
        vm.expectRevert();
        market.buy{value: PRICE}(listingId);

        // Nothing moved: the listing is still active and the NFT is escrowed.
        (, , , , , bool active) = market.listings(listingId);
        assertTrue(active);
        assertEq(collection.ownerOf(1), address(market));
    }
}

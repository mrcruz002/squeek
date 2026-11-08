// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {SqueekMarketplace} from "../src/SqueekMarketplace.sol";

/// @notice ERC-721 with ERC-2981 royalties AND a Squeek-style `level(uint256)`
///         getter (public mapping). Mirrors the real Squeek contract's probe
///         result on Sepolia: level(1) = 1, level(67) = 2, level(68) = 2.
contract MockLevelledERC721 is ERC721, ERC2981 {
    uint256 public nextId = 1;
    mapping(uint256 => uint256) public level;

    constructor(string memory name_, string memory symbol_)
        ERC721(name_, symbol_)
    {}

    function mint(address to) external returns (uint256 tokenId) {
        tokenId = nextId;
        nextId += 1;
        _safeMint(to, tokenId);
    }

    function setLevel(uint256 tokenId, uint256 lvl) external {
        level[tokenId] = lvl;
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

/// @notice Plain ERC-721 with no royalty and no level getter.
contract MockPlainERC721 is ERC721 {
    uint256 public nextId = 1;

    constructor() ERC721("Plain", "PLN") {}

    function mint(address to) external returns (uint256 tokenId) {
        tokenId = nextId;
        nextId += 1;
        _safeMint(to, tokenId);
    }
}

contract SqueekMarketplaceCollectionOffersTest is Test {
    SqueekMarketplace public market;
    MockLevelledERC721 public collection;
    MockPlainERC721 public plainCollection;

    address public creator = address(0xC0FFEE);
    address public seller = address(0x5E11E2);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    uint64 public expiry;

    function setUp() public {
        market = new SqueekMarketplace();
        collection = new MockLevelledERC721("Mock Squeeks", "MSQK");
        plainCollection = new MockPlainERC721();
        collection.setRoyalty(creator, 500); // 5% to creator
        expiry = uint64(block.timestamp + 7 days);

        vm.deal(seller, 10 ether);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 100 ether);
        vm.deal(creator, 0);

        // Seller holds tokens 1..5 in the levelled collection.
        for (uint256 i = 0; i < 5; i++) collection.mint(seller);
        collection.setLevel(1, 2); // L2
        collection.setLevel(2, 2); // L2
        collection.setLevel(3, 3); // L3
        collection.setLevel(4, 1); // L1
        collection.setLevel(5, 1); // L1
        // Seller holds token 1 in the plain collection.
        plainCollection.mint(seller);
    }

    // --- helpers ---

    function _collectionOffer(
        address bidder,
        address coll,
        uint256 totalPrice,
        uint256 quantity,
        uint256 level
    ) internal returns (uint256) {
        vm.prank(bidder);
        return market.makeCollectionOffer{value: totalPrice}(
            coll, totalPrice, quantity, level, expiry
        );
    }

    function _approve(uint256 tokenId) internal {
        vm.prank(seller);
        collection.approve(address(market), tokenId);
    }

    function _acceptCollection(uint256 offerId, uint256 tokenId) internal {
        _approve(tokenId);
        vm.prank(seller);
        market.acceptCollectionOffer(offerId, tokenId);
    }

    // --- creation ---

    function testMakeCollectionOfferEscrowsTotal() public {
        uint256 id = _collectionOffer(bob, address(collection), 10 ether, 10, 2);
        assertEq(id, 1);
        assertEq(address(market).balance, 10 ether);
        (
            address b,
            address c,
            uint256 total,
            uint256 perItem,
            uint256 qty,
            uint256 filled,
            uint256 lvl,
            uint64 e,
            bool active
        ) = market.collectionOffers(id);
        assertEq(b, bob);
        assertEq(c, address(collection));
        assertEq(total, 10 ether);
        assertEq(perItem, 1 ether);
        assertEq(qty, 10);
        assertEq(filled, 0);
        assertEq(lvl, 2);
        assertEq(e, expiry);
        assertTrue(active);
    }

    function testMakeCollectionOfferPerItemMath() public {
        uint256 id = _collectionOffer(bob, address(collection), 1 ether, 100, 0);
        (, , , uint256 perItem, , , , , ) = market.collectionOffers(id);
        assertEq(perItem, 0.01 ether);
    }

    function testMakeCollectionOfferWrongValueReverts() public {
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                SqueekMarketplace.IncorrectPayment.selector, 10 ether, 9 ether
            )
        );
        market.makeCollectionOffer{value: 9 ether}(
            address(collection), 10 ether, 10, 0, expiry
        );
    }

    function testMakeCollectionOfferZeroQuantityReverts() public {
        vm.prank(bob);
        vm.expectRevert(SqueekMarketplace.InvalidQuantity.selector);
        market.makeCollectionOffer{value: 1 ether}(
            address(collection), 1 ether, 0, 0, expiry
        );
    }

    function testMakeCollectionOfferZeroTotalReverts() public {
        vm.prank(bob);
        vm.expectRevert(SqueekMarketplace.InvalidPrice.selector);
        market.makeCollectionOffer{value: 0}(
            address(collection), 0, 10, 0, expiry
        );
    }

    function testMakeCollectionOfferZeroPerItemReverts() public {
        // 1 wei for 2 items = 0 wei each — pointless, must revert.
        vm.prank(bob);
        vm.expectRevert(SqueekMarketplace.InvalidPrice.selector);
        market.makeCollectionOffer{value: 1}(
            address(collection), 1, 2, 0, expiry
        );
    }

    function testMakeCollectionOfferExpiredReverts() public {
        vm.prank(bob);
        vm.expectRevert(SqueekMarketplace.InvalidExpiry.selector);
        market.makeCollectionOffer{value: 1 ether}(
            address(collection), 1 ether, 1, 0, uint64(block.timestamp)
        );
    }

    // --- acceptance: fills ---

    function testAcceptCollectionOfferPartialFill() public {
        uint256 id = _collectionOffer(bob, address(collection), 3 ether, 3, 0);
        uint256 sellerBefore = seller.balance;
        uint256 creatorBefore = creator.balance;

        _acceptCollection(id, 1);
        _acceptCollection(id, 2);

        assertEq(collection.ownerOf(1), bob);
        assertEq(collection.ownerOf(2), bob);
        // 1 ETH per item minus 5% royalty = 0.95 to seller, 0.05 to creator.
        assertEq(seller.balance, sellerBefore + 1.9 ether);
        assertEq(creator.balance, creatorBefore + 0.1 ether);
        (, , , , , uint256 filled, , , bool active) =
            market.collectionOffers(id);
        assertEq(filled, 2);
        assertTrue(active);
        assertEq(address(market).balance, 1 ether);
    }

    function testAcceptCollectionOfferFullFillClosesAndRefundsDust() public {
        // 1 ether + 1 wei for 3 items: per-item 333333333333333333 wei,
        // dust 2 wei. Filling all three closes the offer and refunds dust.
        uint256 id = _collectionOffer(
            bob, address(collection), 1 ether + 1 wei, 3, 0
        );
        uint256 bobBefore = bob.balance;

        _acceptCollection(id, 1);
        _acceptCollection(id, 2);
        _acceptCollection(id, 4);

        (, , , , , uint256 filled, , , bool active) =
            market.collectionOffers(id);
        assertEq(filled, 3);
        assertFalse(active);
        assertEq(address(market).balance, 0);
        // Bob spent the total, got exactly the 2 wei dust back. (bobBefore
        // is measured after the offer escrowed the total, so only the dust
        // comes back here.)
        assertEq(bob.balance, bobBefore + 2 wei);
    }

    function testAcceptCollectionOfferPaysSellerInFullWithoutRoyalty() public {
        uint256 id = _collectionOffer(
            bob, address(plainCollection), 2 ether, 2, 0
        );
        vm.prank(seller);
        plainCollection.approve(address(market), 1);
        uint256 sellerBefore = seller.balance;
        vm.prank(seller);
        market.acceptCollectionOffer(id, 1);

        assertEq(plainCollection.ownerOf(1), bob);
        assertEq(seller.balance, sellerBefore + 1 ether);
    }

    // --- acceptance: level enforcement ---

    function testAcceptCollectionOfferWrongLevelReverts() public {
        uint256 id = _collectionOffer(bob, address(collection), 3 ether, 3, 2);
        _approve(3);
        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(
                SqueekMarketplace.WrongLevel.selector, 2, 3
            )
        );
        market.acceptCollectionOffer(id, 3);
    }

    function testAcceptCollectionOfferLevelNotSupportedReverts() public {
        // Plain collection has no level() getter: an L2-only offer on it
        // can never be accepted.
        uint256 id = _collectionOffer(
            bob, address(plainCollection), 1 ether, 1, 2
        );
        vm.prank(seller);
        plainCollection.approve(address(market), 1);
        vm.prank(seller);
        vm.expectRevert(SqueekMarketplace.LevelNotSupported.selector);
        market.acceptCollectionOffer(id, 1);
    }

    function testAcceptCollectionOfferAnyLevelOnPlainCollectionWorks() public {
        uint256 id = _collectionOffer(
            bob, address(plainCollection), 1 ether, 1, 0
        );
        vm.prank(seller);
        plainCollection.approve(address(market), 1);
        vm.prank(seller);
        market.acceptCollectionOffer(id, 1);
        assertEq(plainCollection.ownerOf(1), bob);
    }

    function testAcceptCollectionOfferL2OnlyFillsExactlyTwo() public {
        // The user's example: two L2 + one L3; 3 bids of 0.1 ETH on L2 only
        // can accept only the two L2 tokens.
        uint256 id = _collectionOffer(
            bob, address(collection), 0.3 ether, 3, 2
        );
        _acceptCollection(id, 1);
        _acceptCollection(id, 2);

        _approve(3);
        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(
                SqueekMarketplace.WrongLevel.selector, 2, 3
            )
        );
        market.acceptCollectionOffer(id, 3);

        (, , , , , uint256 filled, , , bool active) =
            market.collectionOffers(id);
        assertEq(filled, 2);
        assertTrue(active);
    }

    // --- acceptance: seller rules ---

    function testAcceptCollectionOfferBidderCannotAcceptOwnToken() public {
        // Bob owns token 6 in the levelled collection; he cannot sell it
        // into his own collection offer.
        collection.mint(bob);
        collection.setLevel(6, 2);
        uint256 id = _collectionOffer(bob, address(collection), 1 ether, 1, 2);
        vm.prank(bob);
        collection.approve(address(market), 6);
        vm.prank(bob);
        vm.expectRevert(SqueekMarketplace.CannotBidOwnToken.selector);
        market.acceptCollectionOffer(id, 6);
    }

    function testAcceptCollectionOfferNotSellerReverts() public {
        uint256 id = _collectionOffer(bob, address(collection), 1 ether, 1, 0);
        vm.prank(alice);
        vm.expectRevert(SqueekMarketplace.NotSellerOrOwner.selector);
        market.acceptCollectionOffer(id, 1);
    }

    function testAcceptCollectionOfferOnListedTokenCancelsListing() public {
        vm.prank(seller);
        collection.approve(address(market), 1);
        vm.prank(seller);
        uint256 listingId = market.list(address(collection), 1, 2 ether, 30 days);

        uint256 id = _collectionOffer(bob, address(collection), 1 ether, 1, 0);
        uint256 sellerBefore = seller.balance;
        vm.prank(seller);
        market.acceptCollectionOffer(id, 1);

        assertEq(collection.ownerOf(1), bob);
        assertEq(seller.balance, sellerBefore + 0.95 ether);
        (, , , , , bool listingActive) = market.listings(listingId);
        assertFalse(listingActive);
        assertEq(market.listingOf(address(collection), 1), 0);
    }

    function testAcceptCollectionOfferExpiredReverts() public {
        uint256 id = _collectionOffer(bob, address(collection), 1 ether, 1, 0);
        vm.warp(block.timestamp + 8 days);
        _approve(1);
        vm.prank(seller);
        vm.expectRevert(SqueekMarketplace.CollectionOfferExpired.selector);
        market.acceptCollectionOffer(id, 1);
    }

    function testAcceptInactiveCollectionOfferReverts() public {
        uint256 id = _collectionOffer(bob, address(collection), 1 ether, 1, 0);
        _acceptCollection(id, 1);
        _approve(2);
        vm.prank(seller);
        vm.expectRevert(
            SqueekMarketplace.CollectionOfferNotActive.selector
        );
        market.acceptCollectionOffer(id, 2);
    }

    // --- cancellation ---

    function testCancelCollectionOfferRefundsUnfilledPlusDust() public {
        // 10 ether + 1 wei for 3: per-item 3333333333333333333, dust 2 wei.
        uint256 id = _collectionOffer(
            bob, address(collection), 10 ether + 1 wei, 3, 0
        );
        _acceptCollection(id, 1);

        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        market.cancelCollectionOffer(id);

        // Refund = total - filled * perItem
        // = (10 ether + 1) - 3333333333333333333.
        assertEq(
            bob.balance,
            bobBefore + (10 ether + 1 wei - 3333333333333333333)
        );
        (, , , , , , , , bool active) = market.collectionOffers(id);
        assertFalse(active);
        assertEq(address(market).balance, 0);
    }

    function testCancelCollectionOfferNotBidderReverts() public {
        uint256 id = _collectionOffer(bob, address(collection), 1 ether, 1, 0);
        vm.prank(alice);
        vm.expectRevert(SqueekMarketplace.NotBidder.selector);
        market.cancelCollectionOffer(id);
    }

    function testCancelExpiredCollectionOfferByAnyone() public {
        uint256 id = _collectionOffer(bob, address(collection), 1 ether, 1, 0);
        vm.warp(block.timestamp + 8 days);
        uint256 bobBefore = bob.balance;
        vm.prank(alice);
        market.cancelCollectionOffer(id);
        assertEq(bob.balance, bobBefore + 1 ether);
    }

    // --- batch accept ---

    function _perTokenOffer(
        address bidder,
        uint256 tokenId,
        uint256 price
    ) internal returns (uint256) {
        vm.prank(bidder);
        return market.makeOffer{value: price}(
            address(collection), tokenId, price, expiry
        );
    }

    function testBatchAcceptOffers() public {
        uint256 o1 = _perTokenOffer(bob, 1, 0.8 ether);
        uint256 o2 = _perTokenOffer(bob, 2, 0.7 ether);
        uint256[] memory ids = new uint256[](2);
        ids[0] = o1;
        ids[1] = o2;

        uint256 sellerBefore = seller.balance;
        _approve(1);
        _approve(2);
        vm.prank(seller);
        market.acceptOffers(ids);

        assertEq(collection.ownerOf(1), bob);
        assertEq(collection.ownerOf(2), bob);
        // 0.8 + 0.7 minus 5% royalty on each.
        assertEq(seller.balance, sellerBefore + 0.76 ether + 0.665 ether);
    }

    function testBatchAcceptOffersAllOrNothing() public {
        uint256 o1 = _perTokenOffer(bob, 1, 0.8 ether);
        uint256 o2 = _perTokenOffer(bob, 2, 0.7 ether);
        // Accept o2 first, so the batch's second entry is already inactive.
        _approve(2);
        vm.prank(seller);
        market.acceptOffer(o2);

        uint256[] memory ids = new uint256[](2);
        ids[0] = o1;
        ids[1] = o2;
        _approve(1);
        vm.prank(seller);
        vm.expectRevert(SqueekMarketplace.OfferNotActive.selector);
        market.acceptOffers(ids);

        // Nothing from the batch moved: o1 still active, token 1 still held.
        assertEq(collection.ownerOf(1), seller);
        (, , , , , bool active) = market.offers(o1);
        assertTrue(active);
    }

    function testBatchAcceptCollectionOffers() public {
        uint256 id = _collectionOffer(bob, address(collection), 2 ether, 2, 0);
        uint256[] memory offerIds = new uint256[](2);
        offerIds[0] = id;
        offerIds[1] = id;
        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = 1;
        tokenIds[1] = 2;

        _approve(1);
        _approve(2);
        vm.prank(seller);
        market.acceptCollectionOffers(offerIds, tokenIds);

        assertEq(collection.ownerOf(1), bob);
        assertEq(collection.ownerOf(2), bob);
        (, , , , , uint256 filled, , , bool active) =
            market.collectionOffers(id);
        assertEq(filled, 2);
        assertFalse(active);
    }

    function testBatchAcceptCollectionOffersLengthMismatchReverts() public {
        uint256 id = _collectionOffer(bob, address(collection), 1 ether, 1, 0);
        uint256[] memory offerIds = new uint256[](1);
        offerIds[0] = id;
        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = 1;
        tokenIds[1] = 2;
        vm.prank(seller);
        vm.expectRevert(SqueekMarketplace.ArrayLengthMismatch.selector);
        market.acceptCollectionOffers(offerIds, tokenIds);
    }

    function testBatchAcceptCollectionOffersAllOrNothing() public {
        // Quantity 1: the first entry fills the offer, the second would
        // revert — so the whole batch must revert and nothing moves.
        uint256 id = _collectionOffer(bob, address(collection), 1 ether, 1, 0);
        uint256[] memory offerIds = new uint256[](2);
        offerIds[0] = id;
        offerIds[1] = id;
        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = 1;
        tokenIds[1] = 2;
        _approve(1);
        _approve(2);
        vm.prank(seller);
        vm.expectRevert(
            SqueekMarketplace.CollectionOfferNotActive.selector
        );
        market.acceptCollectionOffers(offerIds, tokenIds);

        assertEq(collection.ownerOf(1), seller);
        assertEq(collection.ownerOf(2), seller);
        (, , , , , uint256 filled, , , bool active) =
            market.collectionOffers(id);
        assertEq(filled, 0);
        assertTrue(active);
    }
}

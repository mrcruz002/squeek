// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Minimal interface for a collection that exposes a per-token level,
///         e.g. Squeek's `level(uint256)` (selector 0x05c58df2, verified on
///         Sepolia: level(67) = 2, level(68) = 2, level(1) = 1). Used only to
///         enforce level-filtered collection offers. Collections without a
///         level getter cannot have a level-filtered offer accepted on them.
interface ILevelled {
    function level(uint256 tokenId) external view returns (uint256);
}

/// @title SqueekMarketplace — escrow marketplace for Squeekchain NFTs (Sepolia testnet)
/// @notice Trades any ERC-721 on Sepolia, whether or not it was launched on the
///         launchpad. Listings escrow the NFT in this contract; offers escrow
///         ETH in this contract, so a listing is only real if the NFT is locked
///         and an offer is only real if the ETH is locked.
/// @dev v3: listings carry an expiry (duration set at list time). A listing
///      past expiry cannot be bought (ListingExpired) and no longer counts
///      as the token's active listing, but the NFT stays in escrow until
///      it is bought via an accepted offer, cancelled, or re-listed — so
///      offer-accepts keep working from escrow on an expired listing.
///      Testnet only, 0% marketplace fee, contracts unaudited. Royalties are
///      paid per ERC-2981 when the collection supports it; collections without
///      ERC-2981 pay no royalty. All payable functions are nonReentrant and
///      follow checks-effects-interactions. There is no owner and no admin:
///      the contract cannot move tokens or funds except as described below.
///      Token IDs are per-collection; a listing/offer is always tied to one
///      (collection, tokenId) pair.
contract SqueekMarketplace is ReentrancyGuard, IERC721Receiver {
    struct Listing {
        address seller;
        address collection;
        uint256 tokenId;
        uint256 price;
        uint64 expiry;
        bool active;
    }

    struct Offer {
        address bidder;
        address collection;
        uint256 tokenId;
        uint256 price;
        uint64 expiry;
        bool active;
    }

    /// @notice A bid on a whole collection. The bidder enters a TOTAL price
    ///         and a quantity; the per-item price is totalPrice / quantity
    ///         (integer division). The full total is escrowed up front.
    ///         `level` 0 means any level; otherwise only tokens at that
    ///         level may be sold into the offer. `filled` counts accepted
    ///         items; the offer closes when filled == quantity.
    struct CollectionOffer {
        address bidder;
        address collection;
        uint256 totalPrice;
        uint256 pricePerItem;
        uint256 quantity;
        uint256 filled;
        uint256 level;
        uint64 expiry;
        bool active;
    }

    uint256 public nextListingId = 1;
    uint256 public nextOfferId = 1;
    uint256 public nextCollectionOfferId = 1;

    mapping(uint256 => Listing) public listings;
    mapping(uint256 => Offer) public offers;
    mapping(uint256 => CollectionOffer) public collectionOffers;

    /// @notice Active listing id for a token, 0 when not listed.
    mapping(address => mapping(uint256 => uint256)) public listingOf;

    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        address indexed collection,
        uint256 tokenId,
        uint256 price,
        uint64 expiry
    );
    event ListingCancelled(
        uint256 indexed listingId,
        address indexed seller,
        address indexed collection,
        uint256 tokenId
    );
    event ListingSold(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed collection,
        uint256 tokenId,
        uint256 price,
        uint256 royaltyPaid,
        address royaltyReceiver
    );
    event OfferCreated(
        uint256 indexed offerId,
        address indexed bidder,
        address indexed collection,
        uint256 tokenId,
        uint256 price,
        uint64 expiry
    );
    event OfferAccepted(
        uint256 indexed offerId,
        address indexed seller,
        address indexed bidder,
        address collection,
        uint256 tokenId,
        uint256 price,
        uint256 royaltyPaid,
        address royaltyReceiver
    );
    event OfferCancelled(
        uint256 indexed offerId,
        address indexed bidder,
        address indexed collection,
        uint256 tokenId
    );
    event CollectionOfferCreated(
        uint256 indexed collectionOfferId,
        address indexed bidder,
        address indexed collection,
        uint256 totalPrice,
        uint256 pricePerItem,
        uint256 quantity,
        uint256 level,
        uint64 expiry
    );
    event CollectionOfferAccepted(
        uint256 indexed collectionOfferId,
        address indexed seller,
        address indexed bidder,
        address collection,
        uint256 tokenId,
        uint256 pricePerItem,
        uint256 royaltyPaid,
        address royaltyReceiver
    );
    event CollectionOfferCancelled(
        uint256 indexed collectionOfferId,
        address indexed bidder,
        address indexed collection
    );

    error InvalidPrice();
    error InvalidExpiry();
    error InvalidQuantity();
    error WrongLevel(uint256 expected, uint256 actual);
    error LevelNotSupported();
    error CollectionOfferNotActive();
    error CollectionOfferExpired();
    error ArrayLengthMismatch();
    error NotTokenOwner();
    error AlreadyListed();
    error ListingNotActive();
    error ListingExpired();
    error OfferNotActive();
    error OfferExpired();
    error CannotBuyOwnListing();
    error CannotBidOwnToken();
    error IncorrectPayment(uint256 expected, uint256 received);
    error NotSeller();
    error NotBidder();
    error NotSellerOrOwner();
    error PaymentFailed();

    // --- Listings ---

    /// @notice List a token for sale at a fixed price for `durationSeconds`.
    ///         The NFT moves into escrow here until it is bought, the listing
    ///         is cancelled, or the listing expires (expiry does not return
    ///         the NFT on its own — the seller cancels, or re-lists, or an
    ///         offer-accept still sells it from escrow). Re-listing after
    ///         expiry needs no separate cancel: an expired `listingOf`
    ///         entry is cleared here and the NFT stays in escrow (no second
    ///         transfer). An active unexpired listing still reverts
    ///         AlreadyListed.
    function list(
        address collection,
        uint256 tokenId,
        uint256 price,
        uint64 durationSeconds
    ) external nonReentrant returns (uint256 listingId) {
        if (price == 0) revert InvalidPrice();
        if (durationSeconds == 0) revert InvalidExpiry();
        bool alreadyInEscrow = false;
        uint256 existingId = listingOf[collection][tokenId];
        if (existingId != 0) {
            Listing storage existing = listings[existingId];
            if (block.timestamp > existing.expiry) {
                // Expired: only its seller may re-list, and the NFT is
                // already in escrow here, so no transfer is needed.
                if (msg.sender != existing.seller) revert NotTokenOwner();
                existing.active = false;
                listingOf[collection][tokenId] = 0;
                alreadyInEscrow = true;
            } else {
                revert AlreadyListed();
            }
        }
        if (!alreadyInEscrow) {
            if (IERC721(collection).ownerOf(tokenId) != msg.sender) {
                revert NotTokenOwner();
            }
        }

        listingId = nextListingId;
        nextListingId += 1;
        uint64 expiry = uint64(block.timestamp + durationSeconds);
        listings[listingId] = Listing({
            seller: msg.sender,
            collection: collection,
            tokenId: tokenId,
            price: price,
            expiry: expiry,
            active: true
        });
        listingOf[collection][tokenId] = listingId;

        if (!alreadyInEscrow) {
            IERC721(collection).safeTransferFrom(
                msg.sender, address(this), tokenId
            );
        }
        emit ListingCreated(
            listingId, msg.sender, collection, tokenId, price, expiry
        );
    }

    /// @notice Buy a listed token. Exact payment required. A listing past
    ///         its expiry cannot be bought (ListingExpired) — the NFT stays
    ///         in escrow until the seller cancels or re-lists, or an offer
    ///         on it is accepted.
    function buy(uint256 listingId) external payable nonReentrant {
        Listing storage listing = listings[listingId];
        if (!listing.active) revert ListingNotActive();
        if (block.timestamp > listing.expiry) revert ListingExpired();
        if (msg.sender == listing.seller) revert CannotBuyOwnListing();
        if (msg.value != listing.price) {
            revert IncorrectPayment(listing.price, msg.value);
        }

        listing.active = false;
        listingOf[listing.collection][listing.tokenId] = 0;

        (address royaltyReceiver, uint256 royalty) =
            _royalty(listing.collection, listing.tokenId, listing.price);
        uint256 sellerProceeds = listing.price - royalty;

        IERC721(listing.collection).safeTransferFrom(
            address(this), msg.sender, listing.tokenId
        );
        _pay(listing.seller, sellerProceeds);
        _pay(royaltyReceiver, royalty);

        emit ListingSold(
            listingId,
            msg.sender,
            listing.collection,
            listing.tokenId,
            listing.price,
            royalty,
            royaltyReceiver
        );
    }

    /// @notice Cancel a listing. The NFT returns to the seller. Works on
    ///         an expired listing too — expiry alone never returns the NFT.
    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        if (!listing.active) revert ListingNotActive();
        if (msg.sender != listing.seller) revert NotSeller();

        listing.active = false;
        listingOf[listing.collection][listing.tokenId] = 0;

        IERC721(listing.collection).safeTransferFrom(
            address(this), listing.seller, listing.tokenId
        );
        emit ListingCancelled(
            listingId, listing.seller, listing.collection, listing.tokenId
        );
    }

    // --- Offers ---

    /// @notice Offer to buy a token. The ETH is escrowed here until the offer
    ///         is accepted, cancelled, or expires. The bidder cannot offer on
    ///         a token they already own.
    function makeOffer(address collection, uint256 tokenId, uint256 price, uint64 expiry)
        external
        payable
        nonReentrant
        returns (uint256 offerId)
    {
        if (price == 0) revert InvalidPrice();
        if (msg.value != price) revert IncorrectPayment(price, msg.value);
        if (expiry <= block.timestamp) revert InvalidExpiry();
        if (IERC721(collection).ownerOf(tokenId) == msg.sender) {
            revert CannotBidOwnToken();
        }

        offerId = nextOfferId;
        nextOfferId += 1;
        offers[offerId] = Offer({
            bidder: msg.sender,
            collection: collection,
            tokenId: tokenId,
            price: price,
            expiry: expiry,
            active: true
        });

        emit OfferCreated(offerId, msg.sender, collection, tokenId, price, expiry);
    }

    /// @notice Accept an offer. The caller must be the token's owner, or the
    ///         seller of an active listing for the token (the NFT is escrowed
    ///         in that case). The NFT goes to the bidder; the ETH goes to the
    ///         seller minus royalty. An accepted offer also cancels the
    ///         token's active listing, if any. A listing past its expiry
    ///         still sells from escrow here: expiry blocks `buy()` only,
    ///         and this reads `listingOf` directly, not `activeListingOf`.
    function acceptOffer(uint256 offerId) external nonReentrant {
        _acceptOffer(offerId);
    }

    /// @notice Accept several per-token offers in one transaction (the Owned
    ///         tab's bulk-accept button). All-or-nothing: a single failing
    ///         accept reverts the whole batch, so no half-sold selection.
    function acceptOffers(uint256[] calldata offerIds) external nonReentrant {
        for (uint256 i = 0; i < offerIds.length; i++) {
            _acceptOffer(offerIds[i]);
        }
    }

    function _acceptOffer(uint256 offerId) internal {
        Offer storage offer = offers[offerId];
        if (!offer.active) revert OfferNotActive();
        if (block.timestamp > offer.expiry) revert OfferExpired();

        uint256 activeListingId = listingOf[offer.collection][offer.tokenId];
        address seller;
        bool fromEscrow;
        if (activeListingId != 0) {
            seller = listings[activeListingId].seller;
            fromEscrow = true;
            if (msg.sender != seller) revert NotSellerOrOwner();
        } else {
            seller = IERC721(offer.collection).ownerOf(offer.tokenId);
            if (msg.sender != seller) revert NotSellerOrOwner();
        }

        offer.active = false;
        if (fromEscrow) {
            listings[activeListingId].active = false;
            listingOf[offer.collection][offer.tokenId] = 0;
        }

        (address royaltyReceiver, uint256 royalty) =
            _royalty(offer.collection, offer.tokenId, offer.price);
        uint256 sellerProceeds = offer.price - royalty;

        if (fromEscrow) {
            IERC721(offer.collection).safeTransferFrom(
                address(this), offer.bidder, offer.tokenId
            );
        } else {
            IERC721(offer.collection).safeTransferFrom(
                seller, offer.bidder, offer.tokenId
            );
        }
        _pay(seller, sellerProceeds);
        _pay(royaltyReceiver, royalty);

        emit OfferAccepted(
            offerId,
            seller,
            offer.bidder,
            offer.collection,
            offer.tokenId,
            offer.price,
            royalty,
            royaltyReceiver
        );
    }

    /// @notice Cancel an offer. The escrowed ETH is refunded to the bidder.
    ///         Anyone can cancel an expired offer; only the bidder can cancel
    ///         a live one.
    function cancelOffer(uint256 offerId) external nonReentrant {
        Offer storage offer = offers[offerId];
        if (!offer.active) revert OfferNotActive();
        if (msg.sender != offer.bidder && block.timestamp <= offer.expiry) {
            revert NotBidder();
        }

        offer.active = false;
        _pay(offer.bidder, offer.price);

        emit OfferCancelled(
            offerId, offer.bidder, offer.collection, offer.tokenId
        );
    }

    // --- Collection offers ---

    /// @notice Offer to buy up to `quantity` items from a collection. The
    ///         bidder enters a TOTAL price; the per-item price is
    ///         totalPrice / quantity (integer division). The full total is
    ///         escrowed here. `level` 0 means any level; otherwise only
    ///         tokens at that level may be sold into the offer.
    function makeCollectionOffer(
        address collection,
        uint256 totalPrice,
        uint256 quantity,
        uint256 level,
        uint64 expiry
    ) external payable nonReentrant returns (uint256 collectionOfferId) {
        if (totalPrice == 0) revert InvalidPrice();
        if (quantity == 0) revert InvalidQuantity();
        if (msg.value != totalPrice) {
            revert IncorrectPayment(totalPrice, msg.value);
        }
        if (expiry <= block.timestamp) revert InvalidExpiry();
        uint256 pricePerItem = totalPrice / quantity;
        if (pricePerItem == 0) revert InvalidPrice();

        collectionOfferId = nextCollectionOfferId;
        nextCollectionOfferId += 1;
        collectionOffers[collectionOfferId] = CollectionOffer({
            bidder: msg.sender,
            collection: collection,
            totalPrice: totalPrice,
            pricePerItem: pricePerItem,
            quantity: quantity,
            filled: 0,
            level: level,
            expiry: expiry,
            active: true
        });

        emit CollectionOfferCreated(
            collectionOfferId,
            msg.sender,
            collection,
            totalPrice,
            pricePerItem,
            quantity,
            level,
            expiry
        );
    }

    /// @notice Sell one token into a collection offer. Same seller rule as
    ///         acceptOffer (token owner, or the seller of its active listing).
    ///         A listing past its expiry still sells from escrow here, as
    ///         with acceptOffer. The bidder may not sell their own token into their own offer.
    ///         Pays pricePerItem minus royalty; fills one slot; the offer
    ///         closes when filled == quantity (any division dust returns to
    ///         the bidder). A level-filtered offer reverts on a wrong level,
    ///         and reverts LevelNotSupported when the collection has no level
    ///         getter at all.
    function acceptCollectionOffer(uint256 collectionOfferId, uint256 tokenId)
        external
        nonReentrant
    {
        _acceptCollectionOffer(collectionOfferId, tokenId);
    }

    /// @notice Sell several tokens into collection offers in one transaction
    ///         (the Owned tab's bulk-accept button). `tokenIds[i]` is the
    ///         token sold into `collectionOfferIds[i]`. All-or-nothing.
    function acceptCollectionOffers(
        uint256[] calldata collectionOfferIds,
        uint256[] calldata tokenIds
    ) external nonReentrant {
        if (collectionOfferIds.length != tokenIds.length) {
            revert ArrayLengthMismatch();
        }
        for (uint256 i = 0; i < collectionOfferIds.length; i++) {
            _acceptCollectionOffer(collectionOfferIds[i], tokenIds[i]);
        }
    }

    function _acceptCollectionOffer(uint256 collectionOfferId, uint256 tokenId)
        internal
    {
        CollectionOffer storage offer = collectionOffers[collectionOfferId];
        if (!offer.active) revert CollectionOfferNotActive();
        if (block.timestamp > offer.expiry) revert CollectionOfferExpired();

        uint256 activeListingId = listingOf[offer.collection][tokenId];
        address seller;
        bool fromEscrow;
        if (activeListingId != 0) {
            seller = listings[activeListingId].seller;
            fromEscrow = true;
            if (msg.sender != seller) revert NotSellerOrOwner();
        } else {
            seller = IERC721(offer.collection).ownerOf(tokenId);
            if (msg.sender != seller) revert NotSellerOrOwner();
        }
        if (seller == offer.bidder) revert CannotBidOwnToken();

        // Level enforcement runs after the seller is resolved, so a
        // nonexistent token reverts naturally from ownerOf above instead of
        // being misreported as a level problem. The WrongLevel check must
        // sit OUTSIDE the try block: a revert inside try is caught by catch
        // and would be misreported as LevelNotSupported.
        if (offer.level > 0) {
            uint256 actual;
            bool supported;
            try ILevelled(offer.collection).level(tokenId) returns (
                uint256 v
            ) {
                actual = v;
                supported = true;
            } catch {
                supported = false;
            }
            if (!supported) revert LevelNotSupported();
            if (actual != offer.level) revert WrongLevel(offer.level, actual);
        }

        offer.filled += 1;
        if (offer.filled == offer.quantity) {
            offer.active = false;
            // Return any division dust (totalPrice - quantity * pricePerItem,
            // at most quantity - 1 wei) to the bidder now that the offer is
            // closed; otherwise it would be stuck in the contract.
            uint256 dust =
                offer.totalPrice - offer.quantity * offer.pricePerItem;
            _pay(offer.bidder, dust);
        }
        if (fromEscrow) {
            listings[activeListingId].active = false;
            listingOf[offer.collection][tokenId] = 0;
        }

        (address royaltyReceiver, uint256 royalty) =
            _royalty(offer.collection, tokenId, offer.pricePerItem);
        uint256 sellerProceeds = offer.pricePerItem - royalty;

        if (fromEscrow) {
            IERC721(offer.collection).safeTransferFrom(
                address(this), offer.bidder, tokenId
            );
        } else {
            IERC721(offer.collection).safeTransferFrom(
                seller, offer.bidder, tokenId
            );
        }
        _pay(seller, sellerProceeds);
        _pay(royaltyReceiver, royalty);

        emit CollectionOfferAccepted(
            collectionOfferId,
            seller,
            offer.bidder,
            offer.collection,
            tokenId,
            offer.pricePerItem,
            royalty,
            royaltyReceiver
        );
    }

    /// @notice Cancel a collection offer. The unfilled part plus any division
    ///         dust is refunded to the bidder. Anyone can cancel an expired
    ///         offer; only the bidder can cancel a live one.
    function cancelCollectionOffer(uint256 collectionOfferId)
        external
        nonReentrant
    {
        CollectionOffer storage offer = collectionOffers[collectionOfferId];
        if (!offer.active) revert CollectionOfferNotActive();
        if (msg.sender != offer.bidder && block.timestamp <= offer.expiry) {
            revert NotBidder();
        }

        offer.active = false;
        uint256 refund = offer.totalPrice - offer.filled * offer.pricePerItem;
        _pay(offer.bidder, refund);

        emit CollectionOfferCancelled(
            collectionOfferId, offer.bidder, offer.collection
        );
    }

    // --- Views ---

    /// @notice The active listing for a token, or id 0 when not listed.
    ///         An expired listing counts as not listed (id 0) even though
    ///         the NFT is still in escrow — offer-accepts read `listingOf`
    ///         directly, not this view, so they keep selling from escrow.
    function activeListingOf(address collection, uint256 tokenId)
        external
        view
        returns (uint256)
    {
        uint256 listingId = listingOf[collection][tokenId];
        if (listingId == 0) return 0;
        if (block.timestamp > listings[listingId].expiry) return 0;
        return listingId;
    }

    // --- Internal ---

    /// @notice ERC-2981 royalty for a sale, or (0, 0) when the collection
    ///         does not support it. The amount is capped at the sale price.
    function _royalty(address collection, uint256 tokenId, uint256 salePrice)
        internal
        view
        returns (address receiver, uint256 amount)
    {
        try IERC2981(collection).royaltyInfo(tokenId, salePrice) returns (
            address r,
            uint256 a
        ) {
            if (r != address(0) && a > 0) {
                if (a > salePrice) a = salePrice;
                return (r, a);
            }
        } catch {}
        return (address(0), 0);
    }

    function _pay(address to, uint256 amount) internal {
        if (amount == 0 || to == address(0)) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert PaymentFailed();
    }

    /// @notice Required to receive NFTs via safeTransferFrom (listings).
    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return this.onERC721Received.selector;
    }
}

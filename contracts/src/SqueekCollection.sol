// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/// @title SqueekCollection — ERC-721 drop collection for the Squeekchain launchpad
/// @notice One collection per launch. Deployed as an EIP-1167 minimal-proxy clone
///         behind CollectionFactory. Payment is Sepolia ETH while Squeekchain is on
///         Sepolia testnet (chain ID 11155111).
/// @dev `initialize` may only run once. The implementation contract disables
///      initializers in its constructor, so the implementation itself can never
///      be claimed or used directly — only clones created by the factory work.
///      Token IDs start at 1 and are minted sequentially.
///      There are deliberately no admin powers over holders: the owner can only
///      withdraw sale proceeds and (before the sale starts) fix the base URI.
///      The owner cannot freeze, burn, or seize anyone's tokens.
contract SqueekCollection is ERC721, ERC721Enumerable, ERC2981, ReentrancyGuard, Initializable {
    /// @notice Maximum royalty: 10% (1000 basis points).
    uint256 public constant MAX_ROYALTY_BPS = 1000;

    /// @notice Parameters for `initialize`. Passed as one struct to keep the
    ///         factory call readable and to avoid stack-too-deep errors.
    struct InitParams {
        address creator; // collection owner; receives sale proceeds
        string name; // ERC-721 name
        string symbol; // ERC-721 symbol
        string baseURI; // e.g. "ipfs://<cid>/" — tokenURI is baseURI + tokenId
        uint256 maxSupply; // hard cap, > 0
        uint256 mintPrice; // wei per token, Sepolia ETH
        uint256 maxPerWallet; // mint cap per wallet, > 0 and <= maxSupply
        uint64 saleStart; // unix timestamp, saleStart < saleEnd
        uint64 saleEnd; // unix timestamp
        address royaltyReceiver; // required when royaltyBps > 0
        uint96 royaltyBps; // ERC-2981 fee, 0–1000
    }

    /// @notice The collection creator. Set once in `initialize`.
    address public owner;

    string private _collectionName;
    string private _collectionSymbol;
    string private _baseTokenURI;

    uint256 public maxSupply;
    uint256 public mintPrice;
    uint256 public maxPerWallet;
    uint64 public saleStart;
    uint64 public saleEnd;

    /// @notice Number of tokens minted so far. The next token ID is totalMinted + 1.
    uint256 public totalMinted;
    mapping(address => uint256) public mintedBy;

    event CollectionInitialized(
        address indexed creator,
        string name,
        string symbol,
        uint256 maxSupply,
        uint256 mintPrice,
        uint256 maxPerWallet,
        uint64 saleStart,
        uint64 saleEnd
    );
    event Minted(address indexed minter, uint256 indexed tokenId);
    event BaseURIUpdated(string baseURI);
    event Withdrawn(address indexed owner, uint256 amount);

    error NotOwner();
    error InvalidQuantity();
    error SaleNotActive();
    error SaleAlreadyStarted();
    error IncorrectPayment(uint256 expected, uint256 received);
    error ExceedsMaxSupply(uint256 requested, uint256 available);
    error ExceedsMaxPerWallet(uint256 requested, uint256 allowed);
    error InvalidMaxSupply();
    error InvalidMaxPerWallet();
    error InvalidSaleWindow();
    error RoyaltyTooHigh(uint96 royaltyBps);
    error RoyaltyReceiverZero();
    error CreatorZero();
    error NothingToWithdraw();
    error WithdrawFailed();

    /// @dev Locks the implementation contract so it can never be initialized directly.
    constructor() ERC721("SqueekCollection (implementation - do not use)", "SQK-IMPL") {
        _disableInitializers();
    }

    /// @notice One-time setup, called by CollectionFactory right after cloning.
    function initialize(InitParams calldata params) external initializer {
        if (params.creator == address(0)) revert CreatorZero();
        if (params.maxSupply == 0) revert InvalidMaxSupply();
        if (params.maxPerWallet == 0 || params.maxPerWallet > params.maxSupply) revert InvalidMaxPerWallet();
        if (params.saleStart >= params.saleEnd) revert InvalidSaleWindow();
        if (params.royaltyBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh(params.royaltyBps);
        if (params.royaltyBps > 0 && params.royaltyReceiver == address(0)) revert RoyaltyReceiverZero();

        owner = params.creator;
        _collectionName = params.name;
        _collectionSymbol = params.symbol;
        _baseTokenURI = params.baseURI;
        maxSupply = params.maxSupply;
        mintPrice = params.mintPrice;
        maxPerWallet = params.maxPerWallet;
        saleStart = params.saleStart;
        saleEnd = params.saleEnd;

        if (params.royaltyBps > 0) {
            _setDefaultRoyalty(params.royaltyReceiver, params.royaltyBps);
        }

        emit CollectionInitialized(
            params.creator,
            params.name,
            params.symbol,
            params.maxSupply,
            params.mintPrice,
            params.maxPerWallet,
            params.saleStart,
            params.saleEnd
        );
    }

    /// @notice Mint `quantity` tokens. Exact payment required: mintPrice * quantity.
    /// @dev Non-reentrant: `_safeMint` calls the receiver's `onERC721Received`,
    ///      which must not be able to re-enter and mint again.
    function mint(uint256 quantity) external payable nonReentrant {
        if (quantity == 0) revert InvalidQuantity();
        if (block.timestamp < saleStart || block.timestamp > saleEnd) revert SaleNotActive();
        if (totalMinted + quantity > maxSupply) {
            revert ExceedsMaxSupply(totalMinted + quantity, maxSupply);
        }
        if (mintedBy[msg.sender] + quantity > maxPerWallet) {
            revert ExceedsMaxPerWallet(mintedBy[msg.sender] + quantity, maxPerWallet);
        }
        uint256 expected = mintPrice * quantity;
        if (msg.value != expected) revert IncorrectPayment(expected, msg.value);

        mintedBy[msg.sender] += quantity;
        for (uint256 i = 0; i < quantity; i++) {
            totalMinted += 1;
            _safeMint(msg.sender, totalMinted);
            emit Minted(msg.sender, totalMinted);
        }
    }

    /// @notice Pull-payment: the creator withdraws all sale proceeds. Only the
    ///         owner can call it, and the contract never pushes funds anywhere.
    function withdraw() external nonReentrant {
        if (msg.sender != owner) revert NotOwner();
        uint256 balance = address(this).balance;
        if (balance == 0) revert NothingToWithdraw();
        (bool ok, ) = payable(owner).call{value: balance}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(owner, balance);
    }

    /// @notice Fix the metadata base URI before the sale starts (e.g. reveal
    ///         setup). Locked once the sale window opens.
    function setBaseURI(string calldata newBaseURI) external {
        if (msg.sender != owner) revert NotOwner();
        if (block.timestamp >= saleStart) revert SaleAlreadyStarted();
        _baseTokenURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    // --- ERC-721 metadata (name/symbol/baseURI live in clone storage) ---

    function name() public view override returns (string memory) {
        return _collectionName;
    }

    function symbol() public view override returns (string memory) {
        return _collectionSymbol;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // --- Required overrides (ERC721 + Enumerable + ERC2981) ---

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}

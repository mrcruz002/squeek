// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {SqueekCollection} from "./SqueekCollection.sol";

/// @title CollectionFactory — deploys SqueekCollection clones for the Squeekchain launchpad
/// @notice Permissionless and ownerless by design: anyone can launch a collection,
///         and there is no admin key that can interfere with a launched collection.
///         Each collection is an EIP-1167 minimal-proxy clone of a single
///         implementation, so launching is cheap. The factory only records
///         what was created; it holds no funds and cannot move any tokens.
contract CollectionFactory {
    /// @notice The single SqueekCollection implementation all clones delegate to.
    address public immutable implementation;

    /// @notice Every collection ever created, in creation order.
    address[] public allCollections;

    /// @notice Collections created by a given creator address.
    mapping(address => address[]) public collectionsOfCreator;

    /// @notice True for addresses that are launchpad collections.
    mapping(address => bool) public isCollection;

    event CollectionCreated(
        address indexed creator,
        address indexed collection,
        string name,
        string symbol,
        uint256 maxSupply,
        uint256 mintPrice
    );

    /// @dev Deploys the implementation once. Its constructor disables
    ///      initializers, so the implementation itself can never be used.
    constructor() {
        implementation = address(new SqueekCollection());
    }

    /// @notice Launch a new collection. The caller becomes its creator/owner.
    /// @param params Full collection setup (see SqueekCollection.InitParams).
    /// @return collection The address of the new clone.
    function createCollection(SqueekCollection.InitParams calldata params)
        external
        returns (address collection)
    {
        // The creator must be the caller: nobody can launch a collection
        // in someone else's name, and the creator registry stays truthful.
        require(params.creator == msg.sender, "Factory: creator must be caller");

        collection = Clones.clone(implementation);
        SqueekCollection(collection).initialize(params);

        allCollections.push(collection);
        collectionsOfCreator[params.creator].push(collection);
        isCollection[collection] = true;

        emit CollectionCreated(
            params.creator, collection, params.name, params.symbol, params.maxSupply, params.mintPrice
        );
    }

    /// @notice Total number of collections launched.
    function collectionCount() external view returns (uint256) {
        return allCollections.length;
    }

    /// @notice All collections launched by `creator`, in creation order.
    function collectionsOf(address creator) external view returns (address[] memory) {
        return collectionsOfCreator[creator];
    }
}

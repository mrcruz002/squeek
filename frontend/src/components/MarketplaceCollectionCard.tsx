// Collection card for the marketplace grid — data comes from the indexer,
// so it can show any tracked collection (not just launchpad ones), with its
// floor price and listed count.
import type { IndexerCollection } from '../lib/indexer'
import VerifiedBadge from './VerifiedBadge'

export default function MarketplaceCollectionCard({
  collection,
}: {
  collection: IndexerCollection
}) {
  return (
    <a
      className="card collection-card"
      href={`#/collection/${collection.address}`}
    >
      <h3>
        {collection.name ?? 'Unknown collection'}{' '}
        <VerifiedBadge collection={collection.address as `0x${string}`} />
        <span className="muted">({collection.symbol ?? ''})</span>
      </h3>
      <p className="mono small">{collection.address}</p>
      <p>
        Floor:{' '}
        <strong>
          {collection.floorEth !== null ? `${collection.floorEth} ETH` : '—'}
        </strong>
      </p>
      <p>
        {collection.listedCount} listed · {collection.holders} holder
        {collection.holders === 1 ? '' : 's'} · {collection.totalSupply} tokens
      </p>
      {collection.kind === 'squeek' && (
        <p className="muted small">
          Squeek Levels:{' '}
          {Object.keys(collection.floorByLevel).length > 0
            ? Object.keys(collection.floorByLevel)
                .sort((a, b) => Number(a) - Number(b))
                .map(
                  (lvl) =>
                    `L${lvl} ${collection.floorByLevel[lvl].floorEth} ETH`,
                )
                .join(' · ')
            : 'no level floors yet'}
        </p>
      )}
    </a>
  )
}

import { formatPrice } from '../lib/utils'
import type { CollectionSummary } from '../hooks'

export default function CollectionCard({
  summary,
}: {
  summary: CollectionSummary
}) {
  const soldOut = summary.totalSupply >= summary.maxSupply
  return (
    <a
      className="card collection-card"
      href={`#/collection/${summary.address}`}
    >
      <h3>
        {summary.name}{' '}
        <span className="muted">({summary.symbol})</span>
      </h3>
      <p className="mono small">{summary.address}</p>
      <p>
        Price: <strong>{formatPrice(summary.mintPrice)}</strong>
      </p>
      <p>
        Minted: {summary.totalSupply.toString()} / {summary.maxSupply.toString()}
        {soldOut && ' — sold out'}
      </p>
    </a>
  )
}

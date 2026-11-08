import {
  formatDuration,
  formatPrice,
  saleStatus,
  SALE_STATUS_LABEL,
} from '../lib/utils'
import type { DropSummary } from '../hooks'

/** One drop card: name, price, minted/supply with progress, sale status and countdown. */
export default function DropCard({
  summary,
  nowSeconds,
}: {
  summary: DropSummary
  nowSeconds: number
}) {
  const status = saleStatus(summary.saleStart, summary.saleEnd, nowSeconds)
  const soldOut = summary.totalSupply >= summary.maxSupply
  const mintedPct =
    summary.maxSupply > 0n
      ? Math.round(
          (Number(summary.totalSupply) / Number(summary.maxSupply)) * 100,
        )
      : 0

  const countdown =
    status === 'live'
      ? `Ends in ${formatDuration(Number(summary.saleEnd) * 1000 - nowSeconds * 1000)}`
      : status === 'not-started'
        ? `Starts in ${formatDuration(Number(summary.saleStart) * 1000 - nowSeconds * 1000)}`
        : 'Sale ended'

  return (
    <a
      className="card collection-card drop-card"
      href={`#/collection/${summary.address}`}
    >
      <div className="drop-head">
        <h3>
          {summary.name}{' '}
          <span className="muted">({summary.symbol})</span>
        </h3>
        <span className={`status status-${status}`}>
          {SALE_STATUS_LABEL[status]}
        </span>
      </div>
      <p className="mono small">{summary.address}</p>
      <p>
        Price: <strong>{formatPrice(summary.mintPrice)}</strong>
      </p>
      <p>
        Minted: {summary.totalSupply.toString()} /{' '}
        {summary.maxSupply.toString()}
        {soldOut && ' — sold out'}
      </p>
      <div className="progress">
        <div className="progress-fill" style={{ width: `${mintedPct}%` }} />
      </div>
      <p
        className={`countdown ${status === 'live' ? 'countdown-live' : 'countdown-soon'}`}
      >
        {countdown}
      </p>
    </a>
  )
}

import { useState } from 'react'
import { useTokenMetadata, useTokenUriDirect } from '../hooks'
import type { IndexerToken } from '../lib/indexer'
import { resolveUri } from '../lib/utils'

/**
 * One item in a collection's marketplace grid: art, listing price (or
 * "Not listed"), offer count, and a Make offer action that deep-links to
 * the token page's trade box (`#trade`). Art comes from the tokenURI
 * passed in (already batch-read by the grid); data: URIs decode inline
 * via useTokenMetadata, so Squeek art renders without a fetch.
 *
 * Per-card fallback: if the batch URI is missing once the batch has
 * settled (`batchReady`), this card fetches its own tokenURI with a
 * DIRECT single eth_call (useTokenUriDirect) — deliberately NOT the
 * multicall path: viem schedules concurrent useReadContracts reads into
 * one aggregate3, so a fallback built on useToken would be re-merged
 * into a ~1MB multicall and rejected by the public RPC exactly like the
 * chunk it is meant to rescue. A direct call stays ~100KB on its own, so
 * it passes the RPC even when the chunk fails. No card stays a
 * placeholder just because a big batch failed on the public RPC. The
 * fallback only fires after the batch settles, so a healthy batch costs
 * no extra calls.
 */
export default function MarketplaceItemCard({
  collection,
  token,
  tokenUri,
  batchReady,
  selectable,
  selected,
  onSelect,
}: {
  collection: `0x${string}`
  token: IndexerToken
  tokenUri: string | undefined
  batchReady: boolean
  /** When set, a checkbox appears for Owned bulk-accept selection. */
  selectable?: boolean
  selected?: boolean
  onSelect?: (tokenId: string, checked: boolean) => void
}) {
  const [imgError, setImgError] = useState(false)
  const fallbackUri = useTokenUriDirect(
    collection,
    BigInt(token.tokenId),
    tokenUri === undefined && batchReady,
  )
  const effectiveUri = tokenUri ?? fallbackUri
  const metadata = useTokenMetadata(effectiveUri)

  const image =
    !imgError && metadata.status === 'ok' && metadata.metadata?.image
      ? resolveUri(metadata.metadata.image)
      : undefined
  const name =
    metadata.status === 'ok' && metadata.metadata?.name
      ? metadata.metadata.name
      : `Token #${token.tokenId}`
  const tokenHref = `#/collection/${collection}/token/${token.tokenId}`

  return (
    <article className="card nft-card item-card">
      <a className="nft-image" href={tokenHref}>
        {image ? (
          <img src={image} alt={name} onError={() => setImgError(true)} />
        ) : (
          <div className="nft-image-empty">#{token.tokenId}</div>
        )}
      </a>
      <div className="nft-body">
        <h3>
          <a href={tokenHref}>#{token.tokenId}</a>
          {token.level !== null && (
            <span className="muted small"> · Level {token.level}</span>
          )}
        </h3>
        {selectable && (
          <label className="select-row">
            <input
              type="checkbox"
              checked={selected ?? false}
              onChange={(e) =>
                onSelect?.(token.tokenId, e.target.checked)
              }
            />{' '}
            Select to sell
          </label>
        )}
        <p className="muted small">
          {token.listing ? (
            <>
              Listed — <strong>{token.listing.priceEth} ETH</strong>
            </>
          ) : (
            'Not listed'
          )}
        </p>
        <p className="muted small">
          {token.offerCount} {token.offerCount === 1 ? 'offer' : 'offers'}
        </p>
        <a className="btn btn-primary btn-block" href={`${tokenHref}#trade`}>
          Make offer
        </a>
      </div>
    </article>
  )
}

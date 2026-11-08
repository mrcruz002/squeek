import { useState } from 'react'
import { useToken, useTokenMetadata } from '../hooks'
import { resolveUri } from '../lib/utils'
import VerifiedBadge from './VerifiedBadge'

/** One NFT the connected wallet holds in a launchpad collection. */
export default function OwnedNftCard({
  collection,
  collectionName,
  collectionSymbol,
  tokenId,
}: {
  collection: `0x${string}`
  collectionName: string
  collectionSymbol: string
  tokenId: bigint
}) {
  const [imgError, setImgError] = useState(false)
  const { tokenUri, isLoading } = useToken(collection, tokenId)
  const metadata = useTokenMetadata(tokenUri)

  const image =
    !imgError &&
    metadata.status === 'ok' &&
    metadata.metadata?.image
      ? resolveUri(metadata.metadata.image)
      : undefined
  const name =
    metadata.status === 'ok' && metadata.metadata?.name
      ? metadata.metadata.name
      : `Token #${tokenId.toString()}`

  return (
    <article className="card nft-card">
      <a
        className="nft-image"
        href={`#/collection/${collection}/token/${tokenId}`}
      >
        {image ? (
          <img src={image} alt={name} onError={() => setImgError(true)} />
        ) : (
          <div className="nft-image-empty">
            {isLoading ? '…' : `#${tokenId.toString()}`}
          </div>
        )}
      </a>
      <div className="nft-body">
        <h3>
          <a href={`#/collection/${collection}/token/${tokenId}`}>{name}</a>
        </h3>
        <p className="mono small">
          <a href={`#/collection/${collection}`}>
            {collectionName}
            {collectionSymbol ? ` (${collectionSymbol})` : ''}
          </a>{' '}
          <VerifiedBadge collection={collection} />
        </p>
        <p className="muted small">Token #{tokenId.toString()}</p>
      </div>
    </article>
  )
}

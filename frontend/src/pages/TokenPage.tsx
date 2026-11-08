import { useEffect } from 'react'
import { isAddress } from 'viem'
import { useToken, useTokenMetadata, useIndexerToken } from '../hooks'
import { errorMessage, resolveUri, shortenAddress } from '../lib/utils'
import TradeBox from '../components/TradeBox'

export default function TokenPage({
  collection,
  tokenId,
  scrollToTrade = false,
}: {
  collection: string
  tokenId: string
  scrollToTrade?: boolean
}) {
  const validAddress = isAddress(collection)
  const id = /^\d+$/.test(tokenId) ? BigInt(tokenId) : undefined
  const collectionAddress = validAddress
    ? (collection as `0x${string}`)
    : undefined
  const { owner, tokenUri, exists, isLoading, isError, error } = useToken(
    collectionAddress,
    id,
  )
  const metadata = useTokenMetadata(exists ? tokenUri : undefined)
  const indexerToken = useIndexerToken(
    collectionAddress,
    id !== undefined ? id.toString() : undefined,
  )

  // A "Make offer" deep link (#trade) lands on the trade box instead of
  // the top of the page. App's hashchange handler scrolls to top first, so
  // this runs once the token exists and re-scrolls to the box.
  useEffect(() => {
    if (!scrollToTrade || !exists) return
    const t = setTimeout(() => {
      document
        .getElementById('trade')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 150)
    return () => clearTimeout(t)
  }, [scrollToTrade, exists])

  if (!validAddress || id === undefined) {
    return (
      <div className="card">
        <h1>Invalid token</h1>
        <p>
          Collection <code className="mono">{collection}</code> or token ID{' '}
          <code className="mono">{tokenId}</code> is not valid.
        </p>
        <p>
          <a href="#/">← Back to marketplace</a>
        </p>
      </div>
    )
  }

  if (isLoading) return <p>Loading token…</p>

  if (isError || !exists) {
    return (
      <div className="card">
        <h1>
          Token #{tokenId} does not exist
        </h1>
        <p className="muted">
          {error
            ? `Chain read failed: ${errorMessage(error)}`
            : 'This token has not been minted (yet).'}
        </p>
        <p>
          <a href={`#/collection/${collection}`}>← Back to collection</a>
        </p>
      </div>
    )
  }

  const image =
    metadata.status === 'ok' && metadata.metadata?.image
      ? resolveUri(metadata.metadata.image)
      : undefined

  return (
    <div className="narrow">
      <p>
        <a href={`#/collection/${collection}`}>← Back to collection</a>
      </p>
      <h1>
        {metadata.status === 'ok' && metadata.metadata?.name
          ? metadata.metadata.name
          : `Token #${tokenId}`}
      </h1>
      <p className="muted">
        Collection{' '}
        <code className="mono">{shortenAddress(collection)}</code>
      </p>

      <section className="card">
        <dl className="details">
          <div>
            <dt>Token ID</dt>
            <dd>#{tokenId}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd className="mono small">{owner}</dd>
          </div>
          {indexerToken.data?.level !== null &&
            indexerToken.data?.level !== undefined && (
              <div>
                <dt>Level</dt>
                <dd>
                  <strong>Level {indexerToken.data.level}</strong>{' '}
                  <span className="muted small">
                    (from Merge events — each level is 2.2× the power of the
                    one below)
                  </span>
                </dd>
              </div>
            )}
          <div>
            <dt>tokenURI</dt>
            <dd className="mono small break-all">{tokenUri}</dd>
          </div>
        </dl>

        {image && (
          <img className="token-image" src={image} alt={`Token #${tokenId}`} />
        )}

        {metadata.status === 'loading' && <p>Loading metadata…</p>}
        {metadata.status === 'unsupported' && (
          <p className="muted">
            This tokenURI is not an http(s) or ipfs:// URL, so metadata cannot
            be fetched in the browser.
          </p>
        )}
        {metadata.status === 'error' && (
          <p className="notice">
            Metadata could not be fetched ({metadata.error}). The on-chain
            tokenURI above is still shown.
          </p>
        )}
        {metadata.status === 'ok' && metadata.metadata && (
          <div>
            {metadata.metadata.description && (
              <p>{metadata.metadata.description}</p>
            )}
            {metadata.metadata.attributes &&
              metadata.metadata.attributes.length > 0 && (
                <div>
                  <h3>Attributes</h3>
                  <ul className="sq-list">
                    {metadata.metadata.attributes.map((attr, i) => (
                      <li key={i}>
                        {attr.trait_type ?? 'trait'}:{' '}
                        <strong>{String(attr.value ?? '')}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            <details>
              <summary>Raw metadata JSON</summary>
              <pre className="raw-json">
                {JSON.stringify(metadata.metadata, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </section>

      {collectionAddress !== undefined && id !== undefined && (
        <TradeBox
          collection={collectionAddress}
          tokenId={id}
          owner={owner}
          indexerToken={indexerToken.data}
          onChanged={() => {
            /* listing state is re-read by TradeBox after confirmation */
          }}
        />
      )}
    </div>
  )
}

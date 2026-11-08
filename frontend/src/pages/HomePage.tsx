import { useCollectionAddresses, useCollectionSummaries, useIndexerCollections } from '../hooks'
import { FACTORY_ADDRESS, NETWORK_LABEL, USE_LOCAL } from '../config'
import { errorMessage, shortenAddress } from '../lib/utils'
import CollectionCard from '../components/CollectionCard'
import MarketplaceCollectionCard from '../components/MarketplaceCollectionCard'

export default function HomePage() {
  const { addresses, count, isLoading, isError, error, refetch } =
    useCollectionAddresses()
  const summaries = useCollectionSummaries(addresses)
  const indexed = useIndexerCollections()

  const indexerUp = indexed.data !== null
  const collections = indexed.data ?? []

  return (
    <div>
      <section className="hero">
        <div className="hero-inner">
          <img
            className="hero-hamster"
            src="/hamster.jpg"
            alt="Squeekchain hamster"
          />
          <div>
            <h1>
              <span className="wordmark-orange">Squeekchain</span>{' '}
              <span className="wordmark-blue">Launchpad</span>
            </h1>
            <p>
              Launch an ERC-721 collection, mint from a live drop, or trade
              any Squeekchain NFT on the marketplace. Every block started with
              a wheel turn — everything here is on a test network, no real
              money.
            </p>
            <p>
              <a className="btn btn-primary" href="#/create">
                Create a collection
              </a>{' '}
              <button className="btn" onClick={refetch}>
                Refresh
              </button>
            </p>
          </div>
        </div>
        <div className="counters">
          <div>
            <div className="counter-value">
              {indexerUp ? collections.length : (count ?? '—')}
            </div>
            <div className="counter-label">Collections</div>
          </div>
          <div>
            <div className="counter-value">Sepolia</div>
            <div className="counter-label">Network</div>
          </div>
          <div>
            <div className="counter-value">
              {shortenAddress(FACTORY_ADDRESS)}
            </div>
            <div className="counter-label">Factory</div>
          </div>
        </div>
        <p className="muted small">
          {NETWORK_LABEL}
          {USE_LOCAL && ' · local dev mode (VITE_NETWORK=local)'}
        </p>
      </section>

      <h2>
        Collections{' '}
        {indexerUp ? `(${collections.length})` : count !== undefined && `(${count})`}
      </h2>

      {!indexerUp && !indexed.isLoading && (
        <p className="notice">
          The indexer is unreachable, so floors and listings are hidden.
          Showing launchpad collections from the chain instead.
        </p>
      )}

      {indexerUp && collections.length === 0 && (
        <div className="card empty">
          <p>
            <strong>No collections tracked yet.</strong>
          </p>
          <p>
            The indexer is still syncing, or nothing has been tracked. Be the
            first — <a href="#/create">create one</a>.
          </p>
        </div>
      )}

      {indexerUp && (
        <div className="grid">
          {collections.map((c) => (
            <MarketplaceCollectionCard key={c.address} collection={c} />
          ))}
        </div>
      )}

      {!indexerUp && (
        <>
          {isLoading && <p>Loading collections…</p>}
          {isError && (
            <p className="error">
              Could not load collections: {errorMessage(error)}. Check that the
              factory address is correct and the RPC is reachable.
            </p>
          )}
          {!isLoading && !isError && addresses.length === 0 && (
            <div className="card empty">
              <p>
                <strong>No collections yet.</strong>
              </p>
              <p>
                Nobody has launched a collection through this factory. Be the
                first — <a href="#/create">create one</a>.
              </p>
            </div>
          )}

          {summaries.isLoading && addresses.length > 0 && (
            <p>Loading collection details…</p>
          )}
          {summaries.isError && (
            <p className="error">
              Could not load collection details:{' '}
              {errorMessage(summaries.error)}
            </p>
          )}

          <div className="grid">
            {summaries.summaries.map((s) => (
              <CollectionCard key={s.address} summary={s} />
            ))}
          </div>

          {addresses.length > 0 && (
            <p className="muted small">
              Showing {addresses.length} collection
              {addresses.length === 1 ? '' : 's'} from the factory
              {` ${shortenAddress(FACTORY_ADDRESS)}`}.
            </p>
          )}
        </>
      )}
    </div>
  )
}

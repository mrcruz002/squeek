import { useEffect, useState, type ReactNode } from 'react'
import { isAddress, formatEther } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { factoryAbi } from '../abi'
import { FACTORY_ADDRESS } from '../config'
import { SQUEEK_COLLECTION } from '../marketplace-config'
import {
  useCollection,
  useCollectionOffers,
  useIndexerActivity,
  useIndexerCollection,
  useIndexerHolders,
  useIndexerListings,
  useIndexerOwnerNfts,
  useIndexerTokens,
  useTokenUris,
} from '../hooks'
import {
  SALE_STATUS_LABEL,
  formatDate,
  formatPrice,
  saleStatus,
  errorMessage,
  shortenAddress,
} from '../lib/utils'
import MintBox from '../components/MintBox'
import MarketplaceItemCard from '../components/MarketplaceItemCard'
import VerifiedBadge from '../components/VerifiedBadge'
import {
  CollectionOfferForm,
  CollectionOfferList,
} from '../components/CollectionOffers'
import BulkAcceptPanel from '../components/BulkAcceptPanel'
import BulkListPanel from '../components/BulkListPanel'

type CollectionTab = 'mint' | 'items' | 'owned' | 'holders' | 'activity'

/** Volume as shown in the stats row: "0 ETH" while no sale has happened. */
function formatVolume(eth: string | null | undefined): string {
  if (eth === null || eth === undefined) return '—'
  if (eth === '0.0') return '0 ETH'
  return `${eth} ETH`
}

/**
 * OpenSea-style collection page: a stats row, then tabs. The holders list
 * (500 wallets for Squeek) only renders when the Holders tab is open — it is
 * never shown on page load. Items is the default tab. `mintContent` is only
 * passed for factory collections, which get a Mint tab first.
 */
function MarketplaceSections({
  address,
  mintContent,
}: {
  address: `0x${string}`
  mintContent?: ReactNode
}) {
  const [tab, setTab] = useState<CollectionTab>('items')
  const holders = useIndexerHolders(address)
  const listings = useIndexerListings(address)
  const activity = useIndexerActivity(address)
  const collection = useIndexerCollection(address)
  const tokens = useIndexerTokens(address, 100)
  // Art for the item grid: tokenURIs read in chunks of 10 (a full
  // 100-token multicall is ~10MB for Squeek and public RPCs reject it).
  // A card whose chunk failed falls back to its own single-token read
  // (see MarketplaceItemCard) instead of staying a placeholder.
  const tokenIds = (tokens.data ?? []).map((t) => BigInt(t.tokenId))
  const tokenUris = useTokenUris(address, tokenIds)
  // Owned tab: the connected wallet's items in THIS collection only,
  // from the indexer's owners endpoint (same source as the dashboard).
  const { address: walletAddress, isConnected } = useAccount()
  const owned = useIndexerOwnerNfts(walletAddress)
  const ownedHere = (owned.data ?? []).filter(
    (n) => n.collection.toLowerCase() === address.toLowerCase(),
  )
  const ownedTokenIds = ownedHere.map((n) => BigInt(n.tokenId))
  const ownedTokenUris = useTokenUris(address, ownedTokenIds)
  // Collection offers (chain reads merged with the indexer endpoint when
  // it serves rows) — drives the form/list, the top bid, and bulk accept.
  const collOffers = useCollectionOffers(address)
  // Owned bulk-accept selection (token ids as strings).
  const [selected, setSelected] = useState<Set<string>>(new Set())
  function toggleSelect(tokenId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(tokenId)
      else next.delete(tokenId)
      return next
    })
  }

  const offline =
    holders.isError && listings.isError && activity.isError && !holders.data
  const floorByLevel = collection.data?.floorByLevel ?? {}
  const levelKeys = Object.keys(floorByLevel).sort(
    (a, b) => Number(a) - Number(b),
  )
  const isSqueek = address.toLowerCase() === SQUEEK_COLLECTION
  const holdersCount = collection.data?.holders ?? holders.data?.length ?? 0
  const itemsCount = tokens.data?.length ?? 0
  // Levels: indexer flag when it serves one, else any level seen on the
  // tokens themselves. Squeek is known to have levels even before the
  // first token with a level loads.
  const hasLevels =
    collection.data?.hasLevels ??
    ((tokens.data ?? []).some((t) => t.level !== null) || isSqueek)
  // Levels: the selector always offers 1..MAX_LEVEL on a levelled
  // collection — the options must not depend on which levels happen to
  // exist yet (live Squeek only has L1/L2 so far, so deriving the options
  // from observed tokens hid L3+. L10 is the max level per the official
  // docs (docs.squeekchain.com/developers power table: levels 1–10,
  // power round(1000 × 2.2^(L−1))). The contract itself places no max
  // on the level value (level 0 = any, otherwise exact match via the
  // collection's level() getter).
  const MAX_LEVEL = 10
  const levelOptions = hasLevels
    ? Array.from({ length: MAX_LEVEL }, (_, i) => i + 1)
    : []
  const unit = collection.data?.name
    ? collection.data.name.endsWith('s')
      ? collection.data.name
      : `${collection.data.name}s`
    : (collection.data?.symbol ?? 'items')
  // Top bid is the highest PER-ITEM price: the indexer's topBidWei when
  // it serves one (covers per-token offers too), else the best live
  // collection offer's per-item price.
  const indexerTopBid =
    collection.data?.topBidWei !== null &&
    collection.data?.topBidWei !== undefined
      ? BigInt(collection.data.topBidWei)
      : null
  const offerTopBid = collOffers.offers[0]?.pricePerItem ?? null
  const topBid =
    indexerTopBid !== null && offerTopBid !== null
      ? indexerTopBid > offerTopBid
        ? indexerTopBid
        : offerTopBid
      : (indexerTopBid ?? offerTopBid)

  return (
    <div>
      {offline && (
        <p className="notice">
          The indexer is unreachable, so holders, listings and floors cannot
          be shown. Direct chain data above is unaffected.
        </p>
      )}

      <div className="counters">
        <div>
          <div className="counter-value">
            {collection.data
              ? collection.data.floorEth !== null
                ? `${collection.data.floorEth} ETH`
                : '—'
              : '…'}
          </div>
          <div className="counter-label">Floor price</div>
          {isSqueek && levelKeys.length > 0 && (
            <div className="muted small">
              {levelKeys
                .map((lvl) => `L${lvl} ${floorByLevel[lvl].floorEth} ETH`)
                .join(' · ')}
            </div>
          )}
        </div>
        <div>
          <div className="counter-value">
            {collection.data ? collection.data.listedCount : '…'}
          </div>
          <div className="counter-label">Listed</div>
        </div>
        <div>
          <div className="counter-value">
            {topBid !== null ? `${formatEther(topBid)} ETH` : '—'}
          </div>
          <div className="counter-label">Top bid (per item)</div>
        </div>
        <div>
          <div className="counter-value">
            {collection.data ? collection.data.holders : '…'}
          </div>
          <div className="counter-label">Holders</div>
        </div>
        <div>
          <div className="counter-value">
            {collection.data ? collection.data.totalSupply : '…'}
          </div>
          <div className="counter-label">Total tokens</div>
        </div>
        <div>
          <div className="counter-value">
            {collection.data
              ? formatVolume(collection.data.totalVolumeEth)
              : '…'}
          </div>
          <div className="counter-label">Total volume</div>
        </div>
        <div>
          <div className="counter-value">
            {collection.data
              ? formatVolume(collection.data.volume24hEth)
              : '…'}
          </div>
          <div className="counter-label">24h volume</div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {mintContent !== undefined && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'mint'}
            className={tab === 'mint' ? 'tab active' : 'tab'}
            onClick={() => setTab('mint')}
          >
            Mint
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'items'}
          className={tab === 'items' ? 'tab active' : 'tab'}
          onClick={() => setTab('items')}
        >
          Items ({itemsCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'owned'}
          className={tab === 'owned' ? 'tab active' : 'tab'}
          onClick={() => setTab('owned')}
        >
          Owned
          {isConnected && owned.data ? ` (${ownedHere.length})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'holders'}
          className={tab === 'holders' ? 'tab active' : 'tab'}
          onClick={() => setTab('holders')}
        >
          Holders ({holdersCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'activity'}
          className={tab === 'activity' ? 'tab active' : 'tab'}
          onClick={() => setTab('activity')}
        >
          Activity
        </button>
      </div>

      {tab === 'mint' && mintContent !== undefined && <div>{mintContent}</div>}

      {tab === 'items' && (
        <div>
          <CollectionOfferForm
            collection={address}
            symbol={unit}
            hasLevels={hasLevels}
            levels={levelOptions}
            onPlaced={() => collOffers.refetch()}
          />
          <CollectionOfferList
            offers={collOffers.offers}
            isLoading={collOffers.isLoading}
          />

          <section className="card">
            <h2>Active listings ({listings.data?.length ?? 0})</h2>
            {listings.isLoading && <p>Loading listings…</p>}
            {listings.data && listings.data.length === 0 && (
              <p className="muted">Nothing listed for sale right now.</p>
            )}
            {listings.data && listings.data.length > 0 && (
              <ul className="sq-list">
                {listings.data.map((l) => (
                  <li key={l.listingId}>
                    <a href={`#/collection/${address}/token/${l.tokenId}`}>
                      Token #{l.tokenId}
                    </a>{' '}
                    — <strong>{l.priceEth} ETH</strong> from{' '}
                    <span className="mono small">
                      {shortenAddress(l.seller)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>Items ({tokens.data?.length ?? 0})</h2>
            {tokens.isLoading && <p>Loading items…</p>}
            {tokens.isError && (
              <p className="muted">
                Items come from the indexer — it is unreachable right now.
              </p>
            )}
            {tokens.data && tokens.data.length === 0 && (
              <p className="muted">Nothing minted yet.</p>
            )}
            {tokens.data && tokens.data.length > 0 && (
              <div className="grid">
                {tokens.data.map((t, i) => (
                  <MarketplaceItemCard
                    key={t.tokenId}
                    collection={address}
                    token={t}
                    tokenUri={tokenUris.uris[i]}
                    batchReady={!tokenUris.isLoading}
                  />
                ))}
              </div>
            )}
            <p className="muted small">
              Showing the first {tokens.data?.length ?? 0} tokens by ID.
              Levels come from Merge events. Make offer jumps straight to the
              token's trade box — no listing needed to place a bid.
            </p>
          </section>
        </div>
      )}

      {tab === 'owned' && (
        <section className="card">
          <h2>Owned ({ownedHere.length})</h2>
          {!isConnected && (
            <p className="muted">
              Connect your wallet to see the items you own in this
              collection.
            </p>
          )}
          {isConnected && owned.isLoading && <p>Loading your items…</p>}
          {isConnected && !owned.isLoading && ownedHere.length === 0 && (
            <p className="muted">
              You don&apos;t own any items in this collection yet.
            </p>
          )}
          {isConnected && ownedHere.length > 0 && (
            <>
              <div className="grid">
                {ownedHere.map((n, i) => (
                  <MarketplaceItemCard
                    key={n.tokenId}
                    collection={address}
                    token={{
                      tokenId: n.tokenId,
                      owner: walletAddress ?? '',
                      level: n.level,
                      listing: n.listing,
                      offerCount: n.offerCount,
                    }}
                    tokenUri={ownedTokenUris.uris[i]}
                    batchReady={!ownedTokenUris.isLoading}
                    selectable
                    selected={selected.has(n.tokenId)}
                    onSelect={toggleSelect}
                  />
                ))}
              </div>
              {selected.size > 0 && (
                <div className="grid-two">
                  <BulkListPanel
                    collection={address}
                    selected={[...selected]}
                    onDone={() => collOffers.refetch()}
                  />
                  <BulkAcceptPanel
                    collection={address}
                    selected={[...selected]}
                    collectionOffers={collOffers.offers}
                    onDone={() => collOffers.refetch()}
                  />
                </div>
              )}
            </>
          )}
        </section>
      )}

      {tab === 'holders' && (
        <section className="card">
          <h2>Holders ({holders.data?.length ?? 0})</h2>
          {holders.isLoading && <p>Loading holders…</p>}
          {holders.data && holders.data.length === 0 && (
            <p className="muted">No holders found.</p>
          )}
          {holders.data && holders.data.length > 0 && (
            <ul className="sq-list">
              {holders.data.slice(0, 50).map((h) => (
                <li key={h.holder}>
                  <span className="mono small">{h.holder}</span> —{' '}
                  {h.tokenCount} token{h.tokenCount === 1 ? '' : 's'}
                  <span className="muted small">
                    {' '}
                    (#{h.tokenIds.slice(0, 5).join(', #')}
                    {h.tokenIds.length > 5 ? ', …' : ''})
                  </span>
                </li>
              ))}
            </ul>
          )}
          {holders.data && holders.data.length > 50 && (
            <p className="muted small">Showing the top 50 holders.</p>
          )}
        </section>
      )}

      {tab === 'activity' && (
        <section className="card">
          <h2>Recent activity</h2>
          {activity.isLoading && <p>Loading activity…</p>}
          {activity.data && activity.data.length === 0 && (
            <p className="muted">No recent activity.</p>
          )}
          {activity.data && activity.data.length > 0 && (
            <ul className="sq-list">
              {activity.data.slice(0, 20).map((a, i) => (
                <li key={`${a.txHash}-${i}`}>
                  <strong>{a.type}</strong>
                  {a.tokenId !== null && (
                    <>
                      {' '}
                      <a href={`#/collection/${address}/token/${a.tokenId}`}>
                        #{a.tokenId}
                      </a>
                    </>
                  )}
                  {a.priceEth !== null && <> — {a.priceEth} ETH</>}
                  {a.actor !== null && (
                    <>
                      {' '}
                      <span className="mono small">
                        {shortenAddress(a.actor)}
                      </span>
                    </>
                  )}
                  <span className="muted small"> · block {a.blockNumber}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

export default function CollectionPage({ address }: { address: string }) {
  const valid = isAddress(address)
  const collectionAddress = valid ? (address as `0x${string}`) : undefined

  // True only for collections launched through this factory. Anything else
  // (e.g. the Squeek collection) gets the indexer-driven view, without a
  // mint box — it was not launched here and has no sale window.
  const isCollectionQuery = useReadContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: 'isCollection',
    args: collectionAddress !== undefined ? [collectionAddress] : undefined,
    query: { enabled: collectionAddress !== undefined },
  })
  const isLaunchpad = isCollectionQuery.data === true

  const { details, isLoading, isError, error, refetch } =
    useCollection(isLaunchpad ? collectionAddress : undefined)
  const indexed = useIndexerCollection(collectionAddress)

  // If the factory read is slow or unreachable (slow RPC), do not hold the
  // whole page on it: once the indexer has the collection, show the trading
  // view. A launchpad collection resolves fast on a healthy RPC and then
  // re-renders with its mint box; a non-launchpad one never resolves true.
  const [factoryTimedOut, setFactoryTimedOut] = useState(false)
  useEffect(() => {
    if (!isCollectionQuery.isLoading) {
      setFactoryTimedOut(false)
      return undefined
    }
    const t = setTimeout(() => setFactoryTimedOut(true), 8000)
    return () => clearTimeout(t)
  }, [isCollectionQuery.isLoading])

  if (!valid) {
    return (
      <div className="card">
        <h1>Invalid collection address</h1>
        <p>
          <code className="mono">{address}</code> is not a valid address.
        </p>
        <p>
          <a href="#/">← Back to browse</a>
        </p>
      </div>
    )
  }

  // Non-launchpad collection: indexer view (Squeek and anything else the
  // indexer tracks). No mint box, no sale window — trading only. Also used
  // when the factory read errors or times out but the indexer knows the
  // collection, so a dead RPC does not blank the page.
  if (
    isCollectionQuery.data === false ||
    (indexed.data != null &&
      (isCollectionQuery.isError || factoryTimedOut))
  ) {
    const c = indexed.data
    return (
      <div>
        <p>
          <a href="#/">← All collections</a>
        </p>
        <h1>
          {c?.name ?? 'Collection'}{' '}
          <VerifiedBadge
            collection={collectionAddress as `0x${string}`}
          />{' '}
          <span className="muted">({c?.symbol ?? ''})</span>
        </h1>
        <p className="mono small">{address}</p>
        <p className="muted">
          {c?.kind === 'squeek'
            ? 'Squeekchain Genesis collection — Squeeks start at Level 1 and gain a level when two of the same level are merged.'
            : 'Tracked by the marketplace indexer. Not launched on this launchpad.'}
        </p>
        {collectionAddress !== undefined && (
          <MarketplaceSections
            key={collectionAddress}
            address={collectionAddress}
          />
        )}
      </div>
    )
  }

  if (isLoading || isCollectionQuery.isLoading) return <p>Loading collection…</p>
  if (isError || !details) {
    return (
      <div className="card">
        <h1>Could not load this collection</h1>
        <p className="error">
          {error ? errorMessage(error) : 'No data returned.'}
        </p>
        <p className="muted small">
          The address may not be a collection from this factory, or the RPC
          may be unreachable.
        </p>
        <p>
          <a href="#/">← Back to browse</a>
        </p>
      </div>
    )
  }

  const status = saleStatus(details.saleStart, details.saleEnd)
  const soldOut = details.totalSupply >= details.maxSupply
  const mintedPct =
    details.maxSupply > 0n
      ? Math.round(
          (Number(details.totalSupply) / Number(details.maxSupply)) * 100,
        )
      : 0

  return (
    <div>
      <p>
        <a href="#/">← All collections</a>
      </p>
      <h1>
        {details.name}{' '}
        <VerifiedBadge
          collection={collectionAddress as `0x${string}`}
        />{' '}
        <span className="muted">({details.symbol})</span>
      </h1>
      <p className="mono small">{details.address}</p>

      {collectionAddress !== undefined && (
        <MarketplaceSections
          key={collectionAddress}
          address={collectionAddress}
          mintContent={
            <div className="grid-two">
              <section className="card">
                <h2>Details</h2>
                <dl className="details">
                  <div>
                    <dt>Mint price</dt>
                    <dd>{formatPrice(details.mintPrice)}</dd>
                  </div>
                  <div>
                    <dt>Supply</dt>
                    <dd>
                      {details.totalSupply.toString()} /{' '}
                      {details.maxSupply.toString()} minted ({mintedPct}%)
                    </dd>
                  </div>
                  <div>
                    <dt>Sale status</dt>
                    <dd>
                      <span className={`status status-${status}`}>
                        {SALE_STATUS_LABEL[status]}
                      </span>
                      {soldOut && ' · Sold out'}
                    </dd>
                  </div>
                  <div>
                    <dt>Sale start</dt>
                    <dd>{formatDate(details.saleStart)}</dd>
                  </div>
                  <div>
                    <dt>Sale end</dt>
                    <dd>{formatDate(details.saleEnd)}</dd>
                  </div>
                  <div>
                    <dt>Max per wallet</dt>
                    <dd>{details.maxPerWallet.toString()}</dd>
                  </div>
                  <div>
                    <dt>Royalty (ERC-2981)</dt>
                    <dd>
                      {(Number(details.royaltyBps) / 100).toString()}% to{' '}
                      {shortenAddress(details.royaltyReceiver)}
                    </dd>
                  </div>
                  <div>
                    <dt>Creator / owner</dt>
                    <dd className="mono small">{details.owner}</dd>
                  </div>
                </dl>
                <div className="progress">
                  <div
                    className="progress-fill"
                    style={{ width: `${mintedPct}%` }}
                  />
                </div>
                <button className="btn" onClick={refetch}>
                  Refresh
                </button>
              </section>

              <MintBox collection={details} onMinted={refetch} />
            </div>
          }
        />
      )}
    </div>
  )
}

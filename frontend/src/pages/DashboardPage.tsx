import { useAccount } from 'wagmi'
import { formatEther } from 'viem'
import {
  useChainCollectionOffersByBidder,
  useCollectionAddresses,
  useCollectionSummaries,
  useCreatorCollections,
  useOwnedTokens,
  useIndexerCollections,
  useIndexerOwnerListings,
  useIndexerOwnerNfts,
  useIndexerOwnerOffers,
  type CollectionOffer,
} from '../hooks'
import { errorMessage, formatExpiry, shortenAddress } from '../lib/utils'
import CollectionCard from '../components/CollectionCard'
import OwnedNftCard from '../components/OwnedNftCard'
import ConnectButton from '../components/ConnectButton'
import { CancelCollectionOfferButton } from '../components/CollectionOffers'

/**
 * An indexer /owners/:address/offers row for a collection offer, normalised
 * to the chain CollectionOffer shape. Defensive: the endpoint does not serve
 * collection offers yet, so field names are read leniently — per-item price
 * from pricePerItemWei when present, else priceWei.
 */
function indexerRowToCollectionOffer(
  row: {
    offerId: number | string
    collection: string
    priceWei: string
    pricePerItemWei?: string
    quantity?: number
    filled?: number
    remaining?: number
    level?: number | null
    expiry: number
    /** The indexer serves the id as `id` (older code expected
     *  `collectionOfferId`); both are read. */
    id?: number | string
    collectionOfferId?: number | string
  },
  bidder: `0x${string}`,
): CollectionOffer | undefined {
  try {
    const perItem = BigInt(row.pricePerItemWei ?? row.priceWei)
    const quantity = BigInt(
      row.quantity ?? ((row.remaining ?? 0) + (row.filled ?? 0) || 1),
    )
    return {
      id: BigInt(row.collectionOfferId ?? row.id ?? row.offerId),
      bidder,
      collection: row.collection as `0x${string}`,
      totalPrice: perItem * quantity,
      pricePerItem: perItem,
      quantity,
      filled: BigInt(row.filled ?? 0),
      level: BigInt(row.level ?? 0),
      expiry: BigInt(row.expiry),
      active: true,
    }
  } catch {
    return undefined
  }
}

export default function DashboardPage() {
  const { address, isConnected } = useAccount()
  const { addresses } = useCollectionAddresses()
  const summaries = useCollectionSummaries(addresses)
  const owned = useOwnedTokens(addresses, address)
  const created = useCreatorCollections(address)
  const idxCollections = useIndexerCollections()
  const idxNfts = useIndexerOwnerNfts(address)
  const idxListings = useIndexerOwnerListings(address)
  const idxOffers = useIndexerOwnerOffers(address)
  const chainCollOffers = useChainCollectionOffersByBidder(address)

  // "Your offers": per-token offers stay in the existing list; collection
  // offers (chain scan merged with indexer rows by id) get their own list
  // with per-item price, wanted/filled, level, expiry and cancel.
  const tokenOffers = (idxOffers.data ?? []).filter(
    (o) => o.kind !== 'collection' && o.tokenId !== null,
  )
  const collById = new Map<string, CollectionOffer>()
  for (const o of chainCollOffers.offers) collById.set(o.id.toString(), o)
  if (address !== undefined) {
    for (const o of idxOffers.data ?? []) {
      if (o.kind !== 'collection' && o.tokenId !== null) continue
      const converted = indexerRowToCollectionOffer(o, address)
      if (converted !== undefined && !collById.has(converted.id.toString())) {
        collById.set(converted.id.toString(), converted)
      }
    }
  }
  const collectionOffers = [...collById.values()].sort((a, b) =>
    a.pricePerItem > b.pricePerItem ? -1 : a.pricePerItem < b.pricePerItem ? 1 : 0,
  )

  const summaryByAddress = new Map(
    summaries.summaries.map((s) => [s.address, s]),
  )
  const idxCollectionByAddress = new Map(
    (idxCollections.data ?? []).map((c) => [
      c.address.toLowerCase(),
      c,
    ]),
  )
  const indexerUp = idxNfts.data !== null

  return (
    <div>
      <h1>Dashboard</h1>

      {!isConnected || !address ? (
        <div className="card empty">
          <p>
            <strong>Connect your wallet to see your NFTs.</strong>
          </p>
          <p>
            Your dashboard shows the NFTs you hold across all tracked
            collections, the collections you launched, and your listings and
            offers.
          </p>
          <ConnectButton />
        </div>
      ) : (
        <>
          <p className="mono small">{address}</p>

          <h2>Your NFTs</h2>
          {indexerUp && idxNfts.data !== null && idxNfts.data.length === 0 && (
            <div className="card empty">
              <p>
                <strong>You don&apos;t hold any NFTs yet.</strong>
              </p>
              <p>
                Mint one from a <a href="#/drops">live drop</a>, or browse the{' '}
                <a href="#/">marketplace</a>.
              </p>
            </div>
          )}
          {indexerUp && idxNfts.data !== null && idxNfts.data.length > 0 && (
            <div className="grid">
              {idxNfts.data.map((t) => {
                const c = idxCollectionByAddress.get(t.collection.toLowerCase())
                return (
                  <OwnedNftCard
                    key={`${t.collection}-${t.tokenId}`}
                    collection={t.collection as `0x${string}`}
                    collectionName={c?.name ?? 'Unknown collection'}
                    collectionSymbol={c?.symbol ?? ''}
                    tokenId={BigInt(t.tokenId)}
                  />
                )
              })}
            </div>
          )}
          {indexerUp && idxNfts.data !== null && idxNfts.data.length > 0 && (
            <p className="muted small">
              Levels (Squeek) and listing state come from the indexer. Click a
              card to trade it.
            </p>
          )}
          {!indexerUp && (
            <>
              {owned.isLoading && <p>Loading your NFTs…</p>}
              {owned.isError && (
                <p className="error">
                  Could not load your NFTs: {errorMessage(owned.error)}
                </p>
              )}
              {!owned.isLoading && !owned.isError && owned.tokens.length === 0 && (
                <div className="card empty">
                  <p>
                    <strong>You don&apos;t hold any NFTs yet.</strong>
                  </p>
                  <p>
                    Mint one from a <a href="#/drops">live drop</a>, or browse
                    the <a href="#/">marketplace</a>.
                  </p>
                </div>
              )}
              <div className="grid">
                {owned.tokens.map((t) => {
                  const s = summaryByAddress.get(t.collection)
                  return (
                    <OwnedNftCard
                      key={`${t.collection}-${t.tokenId.toString()}`}
                      collection={t.collection}
                      collectionName={s?.name ?? 'Unknown collection'}
                      collectionSymbol={s?.symbol ?? ''}
                      tokenId={t.tokenId}
                    />
                  )
                })}
              </div>
              {owned.capped && (
                <p className="muted small">
                  Showing the first 50 NFTs per collection.
                </p>
              )}
              <p className="muted small">
                The indexer is unreachable, so only launchpad collections are
                shown here.
              </p>
            </>
          )}

          <h2>Your listings</h2>
          {idxListings.data !== null && idxListings.data.length === 0 && (
            <p className="muted">You have no active listings.</p>
          )}
          {idxListings.data !== null && idxListings.data.length > 0 && (
            <ul className="sq-list">
              {idxListings.data.map((l) => (
                <li key={l.listingId}>
                  <a
                    href={`#/collection/${l.collection}/token/${l.tokenId}`}
                  >
                    Token #{l.tokenId}
                  </a>{' '}
                  — <strong>{l.priceEth} ETH</strong>{' '}
                  <span className="mono small">
                    {shortenAddress(l.collection)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {idxListings.data === null && (
            <p className="muted small">
              Listings come from the indexer — it is unreachable right now.
            </p>
          )}

          <h2>Your offers</h2>
          {idxOffers.data !== null && tokenOffers.length === 0 && collectionOffers.length === 0 && (
            <p className="muted">You have no active offers.</p>
          )}
          {tokenOffers.length > 0 && (
            <ul className="sq-list">
              {tokenOffers.map((o) => (
                <li key={o.offerId}>
                  <a
                    href={`#/collection/${o.collection}/token/${o.tokenId}`}
                  >
                    Token #{o.tokenId}
                  </a>{' '}
                  — <strong>{o.priceEth} ETH</strong>{' '}
                  <span className="mono small">
                    {shortenAddress(o.collection)}
                  </span>{' '}
                  <span className="muted small">
                    · expires in {Math.max(0, Math.floor(o.expiresInSec / 3600))}h
                  </span>
                </li>
              ))}
            </ul>
          )}
          {collectionOffers.length > 0 && (
            <>
              <h3>Collection offers</h3>
              <ul className="sq-list">
                {collectionOffers.map((o) => (
                  <li key={o.id.toString()}>
                    <a href={`#/collection/${o.collection}`}>
                      {shortenAddress(o.collection)}
                    </a>{' '}
                    — <strong>{formatEther(o.pricePerItem)} ETH each</strong>{' '}
                    <span className="muted small">
                      ({formatEther(o.totalPrice)} ETH total · wants{' '}
                      {Number(o.quantity - o.filled)} of {o.quantity.toString()} ·{' '}
                      filled {o.filled.toString()}
                      {Number(o.level) > 0 && ` · Level ${Number(o.level)}`}
                      {' · '}expires {formatExpiry(Number(o.expiry))}
                    </span>{' '}
                    <CancelCollectionOfferButton offerId={o.id} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {idxOffers.data === null && chainCollOffers.isError && (
            <p className="muted small">
              Offers come from the indexer — it is unreachable right now.
            </p>
          )}

          <h2>Your collections</h2>
          {created.isLoading && <p>Loading your collections…</p>}
          {created.isError && (
            <p className="error">
              Could not load your collections: {errorMessage(created.error)}
            </p>
          )}
          {!created.isLoading &&
            !created.isError &&
            created.addresses.length === 0 && (
              <div className="card empty">
                <p>
                  <strong>You haven&apos;t launched a collection yet.</strong>
                </p>
                <p>
                  <a href="#/create">Create one</a> — set the price, supply
                  and sale window, and it shows up here.
                </p>
              </div>
            )}
          <div className="grid">
            {created.addresses.map((a) => {
              const s = summaryByAddress.get(a)
              return s ? (
                <CollectionCard key={a} summary={s} />
              ) : null
            })}
          </div>

          <p className="muted small">
            Your NFTs, listings and offers cover every collection the indexer
            tracks — including the Squeek collection — not just launchpad ones.
          </p>
        </>
      )}
    </div>
  )
}

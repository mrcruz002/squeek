// TradeBox — buy / list / cancel / offer UI for one token (Phase 4).
// Reads the listing state from the marketplace contract; bids come from the
// indexer. All writes go through the connected wallet. When the marketplace
// is not deployed yet (no VITE_MARKETPLACE_ADDRESS), trading is disabled and
// the box says so.

import { useEffect, useRef, useState } from 'react'
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { formatEther, parseEther } from 'viem'
import { collectionAbi, marketplaceAbi } from '../abi'
import { MARKETPLACE_ADDRESS, MARKETPLACE_DEPLOYED } from '../marketplace-config'
import {
  useActiveListing,
  useCollectionOffers,
  useTokenLevel,
  useWrongNetwork,
  type IndexerTokenDetail,
} from '../hooks'
import { errorMessage, formatExpiry, formatPrice, shortenAddress } from '../lib/utils'
import WrongNetworkNote from './WrongNetworkNote'

/** One row in the bids list: a per-token offer or a matching collection offer. */
interface BidRow {
  key: string
  kind: 'token' | 'collection'
  id: bigint
  bidder: string
  /** Per-item price for a collection offer, the offer price otherwise. */
  priceWei: bigint
  expiry: number
  remaining?: number
  level?: number | null
}

export default function TradeBox({
  collection,
  tokenId,
  owner,
  indexerToken,
  onChanged,
}: {
  collection: `0x${string}`
  tokenId: bigint
  owner: `0x${string}` | undefined
  indexerToken: IndexerTokenDetail | null
  onChanged: () => void
}) {
  const { address, isConnected } = useAccount()
  const wrongNetwork = useWrongNetwork()
  const { listing, isLoading: listingLoading, refetch } = useActiveListing(
    collection,
    tokenId,
  )
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash })
  const [action, setAction] = useState<string>('')
  const [listPrice, setListPrice] = useState('0.01')
  const [listDays, setListDays] = useState(30)
  const [offerPrice, setOfferPrice] = useState('0.01')
  const [offerDays, setOfferDays] = useState(7)

  const approvedQuery = useReadContract({
    address: collection,
    abi: collectionAbi,
    functionName: 'getApproved',
    args: [tokenId],
    query: { enabled: isConnected && owner !== undefined },
  })

  // Same staleness as BulkAcceptPanel: getApproved does not refetch on
  // new blocks, so after the single-token approval lands the "List it"
  // form would not appear until a page reload. Refresh it the moment the
  // approval receipt succeeds. The per-hash guard makes the refresh run
  // exactly once per approval transaction; other actions (buy / offer /
  // accept) do not touch this query.
  const approvalRefreshDone = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (action !== 'approve') return
    if (receipt.data?.status !== 'success' || !hash) return
    if (approvalRefreshDone.current === hash) return
    approvalRefreshDone.current = hash
    void approvedQuery.refetch()
  }, [action, receipt.data?.status, hash, approvedQuery])
  const approved =
    typeof approvedQuery.data === 'string'
      ? (approvedQuery.data as string).toLowerCase()
      : undefined
  const isApproved =
    MARKETPLACE_ADDRESS !== undefined &&
    approved === MARKETPLACE_ADDRESS.toLowerCase()

  const isOwner = isConnected && address !== undefined && owner !== undefined &&
    address.toLowerCase() === owner.toLowerCase()
  const isSeller = isConnected && listing !== undefined && address !== undefined &&
    address.toLowerCase() === listing.seller.toLowerCase()
  const busy = isPending || receipt.isLoading

  // Bids: per-token offers from the indexer plus matching collection
  // offers (direct chain reads merged with the indexer endpoint). A
  // collection offer matches when its level is "any" or equals this
  // token's level, and the bidder does not own the token. The token's
  // level comes from the indexer, falling back to a direct level() read
  // on the collection; when neither knows it, only any-level offers match.
  const collOffers = useCollectionOffers(collection)
  const chainLevel = useTokenLevel(collection, tokenId)
  const tokenLevel: number | null =
    indexerToken?.level ??
    (chainLevel.level !== undefined ? Number(chainLevel.level) : null)
  const rows: BidRow[] = []
  const seenCollectionIds = new Set<string>()
  for (const o of indexerToken?.offers ?? []) {
    if (o.kind === 'collection') {
      // Indexer-served collection offer — the API carries the id in `id`
      // (an older draft expected `collectionOfferId`). pricePerItemWei
      // carries the per-item price. A row that cannot be parsed is
      // skipped instead of crashing the whole token page.
      const rawId = o.collectionOfferId ?? o.id ?? o.offerId
      const rawPerItem = o.pricePerItemWei ?? o.priceWei
      if (rawId === undefined || rawPerItem === undefined) continue
      const id = BigInt(rawId)
      seenCollectionIds.add(id.toString())
      const perItem = BigInt(rawPerItem)
      rows.push({
        key: `collection-${id}`,
        kind: 'collection',
        id,
        bidder: o.bidder,
        priceWei: perItem,
        expiry: o.expiry,
        remaining: o.remaining,
        level: o.level ?? null,
      })
    } else {
      rows.push({
        key: `token-${o.offerId}`,
        kind: 'token',
        id: BigInt(o.offerId),
        bidder: o.bidder,
        priceWei: BigInt(o.priceWei),
        expiry: o.expiry,
      })
    }
  }
  for (const o of collOffers.offers) {
    if (seenCollectionIds.has(o.id.toString())) continue
    if (owner !== undefined && o.bidder.toLowerCase() === owner.toLowerCase()) continue
    if (
      Number(o.level) !== 0 &&
      (tokenLevel === null || Number(o.level) !== tokenLevel)
    ) {
      continue
    }
    rows.push({
      key: `collection-${o.id}`,
      kind: 'collection',
      id: o.id,
      bidder: o.bidder,
      priceWei: o.pricePerItem,
      expiry: Number(o.expiry),
      remaining: Number(o.quantity - o.filled),
      level: Number(o.level) === 0 ? null : Number(o.level),
    })
  }
  rows.sort((a, b) => (a.priceWei > b.priceWei ? -1 : a.priceWei < b.priceWei ? 1 : 0))

  function run(label: string, fn: () => void) {
    setAction(label)
    reset()
    fn()
  }

  function approve() {
    const market = MARKETPLACE_ADDRESS
    if (!market) return
    run('approve', () =>
      writeContract({
        address: collection,
        abi: collectionAbi,
        functionName: 'approve',
        args: [market, tokenId],
      }),
    )
  }

  function listToken() {
    const market = MARKETPLACE_ADDRESS
    if (!market) return
    const price = parseEther(listPrice || '0')
    if (price <= 0n) return
    const durationSeconds = BigInt(
      Math.max(1, listDays || 30) * 24 * 60 * 60,
    )
    run('list', () =>
      writeContract({
        address: market,
        abi: marketplaceAbi,
        functionName: 'list',
        args: [collection, tokenId, price, durationSeconds],
      }),
    )
  }

  function buyToken() {
    const market = MARKETPLACE_ADDRESS
    if (!market || !listing) return
    run('buy', () =>
      writeContract({
        address: market,
        abi: marketplaceAbi,
        functionName: 'buy',
        args: [listing.listingId],
        value: listing.price,
      }),
    )
  }

  function cancelListing() {
    const market = MARKETPLACE_ADDRESS
    if (!market || !listing) return
    run('cancel-listing', () =>
      writeContract({
        address: market,
        abi: marketplaceAbi,
        functionName: 'cancelListing',
        args: [listing.listingId],
      }),
    )
  }

  function makeOffer() {
    const market = MARKETPLACE_ADDRESS
    if (!market) return
    const price = parseEther(offerPrice || '0')
    if (price <= 0n) return
    const expiry = BigInt(
      Math.floor(Date.now() / 1000) + offerDays * 24 * 60 * 60,
    )
    run('offer', () =>
      writeContract({
        address: market,
        abi: marketplaceAbi,
        functionName: 'makeOffer',
        args: [collection, tokenId, price, expiry],
        value: price,
      }),
    )
  }

  function acceptOffer(offerId: number | string | bigint) {
    const market = MARKETPLACE_ADDRESS
    if (!market) return
    run('accept-offer', () =>
      writeContract({
        address: market,
        abi: marketplaceAbi,
        functionName: 'acceptOffer',
        args: [BigInt(offerId)],
      }),
    )
  }

  function acceptCollectionOffer(collectionOfferId: bigint) {
    const market = MARKETPLACE_ADDRESS
    if (!market) return
    run('accept-collection-offer', () =>
      writeContract({
        address: market,
        abi: marketplaceAbi,
        functionName: 'acceptCollectionOffer',
        args: [collectionOfferId, tokenId],
      }),
    )
  }

  function acceptBid(row: BidRow) {
    if (row.kind === 'collection') acceptCollectionOffer(row.id)
    else acceptOffer(row.id)
  }

  function cancelOffer(offerId: number | string | bigint) {
    const market = MARKETPLACE_ADDRESS
    if (!market) return
    run('cancel-offer', () =>
      writeContract({
        address: market,
        abi: marketplaceAbi,
        functionName: 'cancelOffer',
        args: [BigInt(offerId)],
      }),
    )
  }

  function cancelCollectionOffer(collectionOfferId: bigint) {
    const market = MARKETPLACE_ADDRESS
    if (!market) return
    run('cancel-collection-offer', () =>
      writeContract({
        address: market,
        abi: marketplaceAbi,
        functionName: 'cancelCollectionOffer',
        args: [collectionOfferId],
      }),
    )
  }

  function cancelBid(row: BidRow) {
    if (row.kind === 'collection') cancelCollectionOffer(row.id)
    else cancelOffer(row.id)
  }

  // Confirmed only when the receipt itself succeeded — a reverted
  // transaction must not show the "Confirmed!" box.
  const done = receipt.data?.status === 'success' && hash

  return (
    <section className="card" id="trade">
      <h2>Trade</h2>

      {!MARKETPLACE_DEPLOYED && (
        <p className="notice">
          Trading opens once the marketplace contract is deployed. Listing,
          buying and offers are disabled until then.
        </p>
      )}

      {MARKETPLACE_DEPLOYED && listingLoading && <p>Loading listing…</p>}

      {MARKETPLACE_DEPLOYED && !listingLoading && (
        <>
          {listing ? (
            <div>
              <p>
                Listed for <strong>{formatPrice(listing.price)}</strong> by{' '}
                <span className="mono small">{shortenAddress(listing.seller)}</span>{' '}
                <span className="muted small">
                  · expires {formatExpiry(Number(listing.expiry))}
                </span>
              </p>
              {isConnected && !isSeller && (
                <button
                  className="btn btn-primary btn-block"
                  disabled={busy || wrongNetwork}
                  onClick={buyToken}
                >
                  {busy && action === 'buy'
                    ? 'Confirm in wallet…'
                    : `Buy for ${formatPrice(listing.price)}`}
                </button>
              )}
              {isSeller && (
                <button
                  className="btn btn-warn"
                  disabled={busy || wrongNetwork}
                  onClick={cancelListing}
                >
                  Cancel listing (NFT returns to you)
                </button>
              )}
              {isSeller && (
                <p className="muted small">
                  Your NFT is held in escrow by the marketplace while listed.
                </p>
              )}
            </div>
          ) : (
            <p className="muted">Not listed for sale.</p>
          )}

          {!isConnected && <p className="notice">Connect your wallet to trade.</p>}
          {isConnected && wrongNetwork && (
            <WrongNetworkNote action="trade" />
          )}

          {isConnected && isOwner && !listing && (
            <div className="form">
              <h3>List for sale</h3>
              <p className="muted small">
                Listing moves the NFT into marketplace escrow until it sells
                or you cancel. Royalties are paid per the collection&apos;s
                ERC-2981 setting. The listing expires after the duration
                below — it can no longer be bought then, but the NFT stays
                in escrow until you cancel, re-list, or accept an offer
                on it.
              </p>
              {/* Price and duration are set BEFORE approval: the approve
                  step only authorises the marketplace to move the NFT,
                  it does not lock in a price. */}
              <div className="qty-row">
                <label htmlFor="list-price">Price (ETH)</label>
                <input
                  id="list-price"
                  type="number"
                  min="0"
                  step="0.001"
                  value={listPrice}
                  onChange={(e) => setListPrice(e.target.value)}
                />
                <label htmlFor="list-days">Days</label>
                <input
                  id="list-days"
                  type="number"
                  min="1"
                  max="365"
                  value={listDays}
                  onChange={(e) =>
                    setListDays(
                      Math.max(1, Math.min(365, Number(e.target.value) || 30)),
                    )
                  }
                />
              </div>
              {!isApproved ? (
                <button
                  className="btn btn-primary"
                  disabled={busy || wrongNetwork}
                  onClick={approve}
                >
                  {busy && action === 'approve'
                    ? 'Confirm in wallet…'
                    : '1. Approve marketplace to move this NFT'}
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  disabled={busy || wrongNetwork}
                  onClick={listToken}
                >
                  {busy && action === 'list'
                    ? 'Confirm in wallet…'
                    : `2. List it for ${listPrice || '0'} ETH, ${listDays} days`}
                </button>
              )}
            </div>
          )}

          {isConnected && !isOwner && (
            <div className="form">
              <h3>Make an offer</h3>
              <p className="muted small">
                Your ETH is locked in the marketplace until the seller accepts,
                you cancel, or the offer expires.
              </p>
              <div className="qty-row">
                <label htmlFor="offer-price">Price (ETH)</label>
                <input
                  id="offer-price"
                  type="number"
                  min="0"
                  step="0.001"
                  value={offerPrice}
                  onChange={(e) => setOfferPrice(e.target.value)}
                />
                <label htmlFor="offer-days">Days</label>
                <input
                  id="offer-days"
                  type="number"
                  min="1"
                  max="30"
                  value={offerDays}
                  onChange={(e) =>
                    setOfferDays(Math.max(1, Math.min(30, Number(e.target.value) || 7)))
                  }
                />
                <button
                  className="btn btn-primary"
                  disabled={busy || wrongNetwork}
                  onClick={makeOffer}
                >
                  {busy && action === 'offer'
                    ? 'Confirm in wallet…'
                    : 'Place offer'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <h3>Bids ({rows.length})</h3>
      {indexerToken === null && rows.length === 0 && (
        <p className="muted small">
          Bids come from the indexer — it is unreachable right now, so bids
          cannot be shown.
        </p>
      )}
      {indexerToken !== null && rows.length === 0 && (
        <p className="muted">No active bids on this token.</p>
      )}
      {rows.length > 0 && (
        <ul className="sq-list">
          {rows.map((row) => {
            const mine =
              isConnected && address !== undefined &&
              address.toLowerCase() === row.bidder.toLowerCase()
            return (
              <li key={row.key}>
                {row.kind === 'collection' && (
                  <span className="muted small">Collection offer — </span>
                )}
                <strong>{formatEther(row.priceWei)} ETH</strong>
                {row.kind === 'collection' && (
                  <span className="muted small"> each</span>
                )}{' '}
                from{' '}
                <span className="mono small">{shortenAddress(row.bidder)}</span>{' '}
                <span className="muted small">
                  · expires {formatExpiry(row.expiry)}
                  {row.kind === 'collection' &&
                    row.remaining !== undefined &&
                    ` · wants ${row.remaining} more`}
                  {row.kind === 'collection' &&
                    row.level !== null &&
                    row.level !== undefined &&
                    ` · Level ${row.level} only`}
                </span>
                {(isOwner || isSeller) && (
                  <button
                    className="btn btn-small"
                    disabled={busy || wrongNetwork || !MARKETPLACE_DEPLOYED}
                    onClick={() => acceptBid(row)}
                  >
                    Accept
                  </button>
                )}
                {mine && (
                  <button
                    className="btn btn-small"
                    disabled={busy || wrongNetwork || !MARKETPLACE_DEPLOYED}
                    onClick={() => cancelBid(row)}
                  >
                    Cancel my bid
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {error && <p className="error">Trade failed: {errorMessage(error)}</p>}
      {hash && (
        <p className="small">
          Transaction: <code className="mono">{hash}</code>
        </p>
      )}
      {done && (
        <div className="success-box">
          <p>
            <strong>Confirmed!</strong>
          </p>
          <button
            className="btn"
            onClick={() => {
              reset()
              setAction('')
              refetch()
              onChanged()
            }}
          >
            Refresh
          </button>
        </div>
      )}
    </section>
  )
}

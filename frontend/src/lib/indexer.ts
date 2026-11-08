// Minimal client for the marketplace indexer API (see indexer/).
// All reads are plain fetch; a failure returns null so callers can fall back
// to direct chain reads or show an indexer-offline note. Prices arrive as
// decimal wei strings plus an eth string; the frontend displays the eth string.

import { INDEXER_URL } from '../marketplace-config'

export interface IndexerCollection {
  address: string
  name: string | null
  symbol: string | null
  kind: 'squeek' | 'launchpad' | 'registry'
  totalSupply: number
  holders: number
  listedCount: number
  floorWei: string | null
  floorEth: string | null
  floorByLevel: Record<string, { floorWei: string; floorEth: string }>
  totalVolumeWei: string
  totalVolumeEth: string
  volume24hWei: string
  volume24hEth: string
  // Collection-offers additions (indexer build in progress — absent until
  // it lands; every reader treats them as optional).
  /** Highest per-item price among live offers (per-token + collection). */
  topBidWei?: string | null
  topBidEth?: string | null
  /** True when at least one token in the collection has a level. */
  hasLevels?: boolean
}

export interface IndexerHolder {
  holder: string
  tokenCount: number
  tokenIds: string[]
}

export interface IndexerListing {
  listingId: number | string
  tokenId: string
  seller: string
  priceWei: string
  priceEth: string
  /** Unix seconds (v3); null for legacy v2 rows, which never expire. */
  expiry?: number | null
  expiresInSec?: number | null
  createdBlock: number
}

export interface IndexerOffer {
  offerId: number | string
  bidder: string
  priceWei: string
  priceEth: string
  expiry: number
  expiresInSec: number
  // Collection-offer fields (only when kind === 'collection'; the indexer
  // build that serves them is in progress — all optional, read defensively).
  kind?: 'token' | 'collection'
  /** Per-item price for a collection offer (priceWei stays the total). */
  pricePerItemWei?: string
  pricePerItemEth?: string
  /** Items still wanted (quantity - filled) for a collection offer. */
  remaining?: number
  quantity?: number
  filled?: number
  /** 0 = any level, otherwise the required level. */
  level?: number | null
  /** Collection-offer id — the indexer serves it as `id` (an older
   *  draft expected `collectionOfferId`; both are read). */
  id?: number | string
  collectionOfferId?: number | string
}

/** One live collection offer, as served by GET /collections/:address/collection-offers. */
export interface IndexerCollectionOffer {
  /** The indexer serves the id as `id` (an older draft expected
   *  `collectionOfferId`; both are read). */
  id: number | string
  collectionOfferId?: number | string
  bidder: string
  collection: string
  totalPriceWei: string
  totalPriceEth: string
  pricePerItemWei: string
  pricePerItemEth: string
  quantity: number
  filled: number
  remaining: number
  level: number | null
  expiry: number
  expiresInSec: number | null
}

export interface IndexerToken {
  tokenId: string
  owner: string
  level: number | null
  listing: IndexerListing | null
  offerCount: number
}

export interface IndexerTokenDetail extends IndexerToken {
  burned: boolean
  offers: IndexerOffer[]
}

export interface IndexerActivity {
  type: string
  collection: string
  tokenId: string | null
  actor: string | null
  priceWei: string | null
  priceEth: string | null
  blockNumber: number
  txHash: string
}

export interface IndexerOwnedNft {
  collection: string
  tokenId: string
  level: number | null
  listing: IndexerListing | null
  offerCount: number
}

export interface IndexerStatus {
  chainId: number
  latestBlock: number
  indexedBlock: number
  indexedBlockHash: string | null
  collectionsTracked: number
  tokensTracked: number
  ok: boolean
  startedAt: string
  gaps: string[]
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${INDEXER_URL}${path}`)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export const indexerApi = {
  status: () => get<IndexerStatus>('/status'),
  collections: () => get<IndexerCollection[]>('/collections'),
  collection: (address: string) =>
    get<IndexerCollection>(`/collections/${address}`),
  holders: (address: string) =>
    get<IndexerHolder[]>(`/collections/${address}/holders`),
  tokens: (address: string, limit = 100, offset = 0) =>
    get<IndexerToken[]>(`/collections/${address}/tokens?limit=${limit}&offset=${offset}`),
  listings: (address: string) =>
    get<IndexerListing[]>(`/collections/${address}/listings`),
  activity: (address: string, limit = 50) =>
    get<IndexerActivity[]>(`/collections/${address}/activity?limit=${limit}`),
  allActivity: (limit = 50) => get<IndexerActivity[]>(`/activity?limit=${limit}`),
  token: (collection: string, tokenId: string) =>
    get<IndexerTokenDetail>(`/tokens/${collection}/${tokenId}`),
  ownerNfts: (address: string) =>
    get<IndexerOwnedNft[]>(`/owners/${address}/nfts`),
  ownerListings: (address: string) =>
    get<(IndexerListing & { collection: string })[]>(`/owners/${address}/listings`),
  ownerOffers: (address: string) =>
    get<
      (IndexerOffer & {
        collection: string
        /** Null for a collection offer (it covers no single token). */
        tokenId: string | null
      })[]
    >(`/owners/${address}/offers`),
  /** Live collection offers on one collection (null = endpoint not served yet). */
  collectionOffers: (address: string) =>
    get<IndexerCollectionOffer[]>(`/collections/${address}/collection-offers`),
}

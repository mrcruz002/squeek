import { useEffect, useState } from 'react'
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useReadContracts,
} from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { decodeFunctionResult, encodeFunctionData, parseEther } from 'viem'
import { collectionAbi, factoryAbi } from './abi'
import { activeChain, FACTORY_ADDRESS } from './config'
import { isFetchableMetadataUri, resolveUri } from './lib/utils'

export interface CollectionSummary {
  address: `0x${string}`
  name: string
  symbol: string
  mintPrice: bigint
  maxSupply: bigint
  totalSupply: bigint
}

export interface CollectionDetails extends CollectionSummary {
  maxPerWallet: bigint
  saleStart: bigint
  saleEnd: bigint
  owner: `0x${string}`
  royaltyReceiver: `0x${string}`
  royaltyBps: bigint
}

function asBigInt(v: unknown): bigint | undefined {
  return typeof v === 'bigint' ? v : undefined
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asAddress(v: unknown): `0x${string}` | undefined {
  return typeof v === 'string' && v.startsWith('0x')
    ? (v as `0x${string}`)
    : undefined
}

/** All collection addresses from the factory, in creation order. */
export function useCollectionAddresses() {
  const countQuery = useReadContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: 'collectionCount',
  })
  const count =
    typeof countQuery.data === 'bigint' ? Number(countQuery.data) : undefined

  const listQuery = useReadContracts({
    contracts:
      count === undefined
        ? []
        : Array.from({ length: count }, (_, i) => ({
            address: FACTORY_ADDRESS,
            abi: factoryAbi,
            functionName: 'allCollections',
            args: [BigInt(i)],
          })),
    query: { enabled: count !== undefined && count > 0 },
  })

  const addresses: `0x${string}`[] = (listQuery.data ?? [])
    .map((r) => asAddress(r.result))
    .filter((a): a is `0x${string}` => a !== undefined)

  return {
    addresses,
    count,
    isLoading: countQuery.isLoading || listQuery.isLoading,
    isError: countQuery.isError || listQuery.isError,
    error: countQuery.error ?? listQuery.error,
    refetch: () => {
      void countQuery.refetch()
      void listQuery.refetch()
    },
  }
}

/** Name/symbol/price/supply for a list of collections (one batched call). */
export function useCollectionSummaries(addresses: `0x${string}`[]) {
  const query = useReadContracts({
    contracts: addresses.flatMap((address) => [
      { address, abi: collectionAbi, functionName: 'name' },
      { address, abi: collectionAbi, functionName: 'symbol' },
      { address, abi: collectionAbi, functionName: 'mintPrice' },
      { address, abi: collectionAbi, functionName: 'maxSupply' },
      { address, abi: collectionAbi, functionName: 'totalSupply' },
    ]),
    query: { enabled: addresses.length > 0 },
  })

  const summaries: CollectionSummary[] = addresses.map((address, i) => {
    const r = (k: number) => query.data?.[i * 5 + k]?.result
    return {
      address,
      name: asString(r(0)) ?? 'Unknown collection',
      symbol: asString(r(1)) ?? '',
      mintPrice: asBigInt(r(2)) ?? 0n,
      maxSupply: asBigInt(r(3)) ?? 0n,
      totalSupply: asBigInt(r(4)) ?? 0n,
    }
  })

  return {
    summaries,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  }
}

/** Full on-chain details for one collection. */
export function useCollection(address: `0x${string}` | undefined) {
  const query = useReadContracts({
    contracts:
      address === undefined
        ? []
        : [
            { address, abi: collectionAbi, functionName: 'name' },
            { address, abi: collectionAbi, functionName: 'symbol' },
            { address, abi: collectionAbi, functionName: 'mintPrice' },
            { address, abi: collectionAbi, functionName: 'maxSupply' },
            { address, abi: collectionAbi, functionName: 'totalSupply' },
            { address, abi: collectionAbi, functionName: 'maxPerWallet' },
            { address, abi: collectionAbi, functionName: 'saleStart' },
            { address, abi: collectionAbi, functionName: 'saleEnd' },
            { address, abi: collectionAbi, functionName: 'owner' },
            {
              address,
              abi: collectionAbi,
              functionName: 'royaltyInfo',
              args: [1n, parseEther('1')],
            },
          ],
    query: { enabled: address !== undefined },
  })

  const r = (k: number) => query.data?.[k]?.result
  const royalty = r(9) as readonly [`0x${string}`, bigint] | undefined

  const details: CollectionDetails | undefined =
    address === undefined
      ? undefined
      : {
          address,
          name: asString(r(0)) ?? 'Unknown collection',
          symbol: asString(r(1)) ?? '',
          mintPrice: asBigInt(r(2)) ?? 0n,
          maxSupply: asBigInt(r(3)) ?? 0n,
          totalSupply: asBigInt(r(4)) ?? 0n,
          maxPerWallet: asBigInt(r(5)) ?? 0n,
          saleStart: asBigInt(r(6)) ?? 0n,
          saleEnd: asBigInt(r(7)) ?? 0n,
          owner: asAddress(r(8)) ?? '0x0000000000000000000000000000000000000000',
          royaltyReceiver: royalty?.[0] ?? '0x0000000000000000000000000000000000000000',
          // royaltyInfo(1 ETH) returns the royalty amount on 1 ETH; bps = amount / 1 ETH * 10000.
          royaltyBps:
            royalty !== undefined
              ? (royalty[1] * 10000n) / parseEther('1')
              : 0n,
        }

  // True only once every read has returned a value.
  const loaded =
    query.data !== undefined && query.data.every((x) => x.status === 'success')

  return {
    details: loaded ? details : undefined,
    isLoading: query.isLoading || (!loaded && !query.isError),
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  }
}

export interface DropSummary extends CollectionSummary {
  saleStart: bigint
  saleEnd: bigint
}

/** Name/symbol/price/supply/sale window for a list of collections (one batched call). */
export function useDropSummaries(addresses: `0x${string}`[]) {
  const query = useReadContracts({
    contracts: addresses.flatMap((address) => [
      { address, abi: collectionAbi, functionName: 'name' },
      { address, abi: collectionAbi, functionName: 'symbol' },
      { address, abi: collectionAbi, functionName: 'mintPrice' },
      { address, abi: collectionAbi, functionName: 'maxSupply' },
      { address, abi: collectionAbi, functionName: 'totalSupply' },
      { address, abi: collectionAbi, functionName: 'saleStart' },
      { address, abi: collectionAbi, functionName: 'saleEnd' },
    ]),
    query: { enabled: addresses.length > 0 },
  })

  const summaries: DropSummary[] = addresses.map((address, i) => {
    const r = (k: number) => query.data?.[i * 7 + k]?.result
    return {
      address,
      name: asString(r(0)) ?? 'Unknown collection',
      symbol: asString(r(1)) ?? '',
      mintPrice: asBigInt(r(2)) ?? 0n,
      maxSupply: asBigInt(r(3)) ?? 0n,
      totalSupply: asBigInt(r(4)) ?? 0n,
      saleStart: asBigInt(r(5)) ?? 0n,
      saleEnd: asBigInt(r(6)) ?? 0n,
    }
  })

  return {
    summaries,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  }
}

/** All collection addresses launched by one creator, in creation order. */
export function useCreatorCollections(creator: `0x${string}` | undefined) {
  const query = useReadContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: 'collectionsOf',
    args: creator !== undefined ? [creator] : undefined,
    query: { enabled: creator !== undefined },
  })

  const addresses = ((query.data ?? []) as unknown[]).filter(
    (a): a is `0x${string}` =>
      typeof a === 'string' && a.startsWith('0x'),
  )

  return {
    addresses,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  }
}

export interface OwnedToken {
  collection: `0x${string}`
  tokenId: bigint
}

/** Cap on tokens read per collection (guards against unbounded reads). */
const MAX_TOKENS_PER_COLLECTION = 50

/**
 * Tokens owned by `owner` across launchpad collections.
 * Stage 1 reads balanceOf per collection; stage 2 reads tokenOfOwnerByIndex
 * for each owned index. Launchpad collections are Enumerable, so this works
 * with direct chain reads — no indexer needed. It only covers collections
 * launched through this factory, not other chains' NFTs.
 */
export function useOwnedTokens(
  addresses: `0x${string}`[],
  owner: `0x${string}` | undefined,
) {
  const balancesQuery = useReadContracts({
    contracts:
      owner === undefined
        ? []
        : addresses.map((address) => ({
            address,
            abi: collectionAbi,
            functionName: 'balanceOf',
            args: [owner],
          })),
    query: { enabled: addresses.length > 0 && owner !== undefined },
  })

  const balances = addresses.map((_, i) => {
    const v = balancesQuery.data?.[i]?.result
    return typeof v === 'bigint' ? v : undefined
  })

  const tokenCalls = addresses.flatMap((address, i) => {
    const bal = balances[i]
    if (bal === undefined || owner === undefined) return []
    const n = Math.min(Number(bal), MAX_TOKENS_PER_COLLECTION)
    return Array.from({ length: n }, (_, j) => ({
      address,
      abi: collectionAbi,
      functionName: 'tokenOfOwnerByIndex',
      args: [owner, BigInt(j)] as const,
    }))
  })

  const tokensQuery = useReadContracts({
    contracts: tokenCalls,
    query: { enabled: tokenCalls.length > 0 },
  })

  const tokens: OwnedToken[] = []
  let k = 0
  addresses.forEach((address, i) => {
    const bal = balances[i]
    if (bal === undefined || owner === undefined) return
    const n = Math.min(Number(bal), MAX_TOKENS_PER_COLLECTION)
    for (let j = 0; j < n; j++) {
      const v = tokensQuery.data?.[k]?.result
      if (typeof v === 'bigint') {
        tokens.push({ collection: address, tokenId: v })
      }
      k++
    }
  })

  const capped = balances.some(
    (b) => b !== undefined && b > BigInt(MAX_TOKENS_PER_COLLECTION),
  )

  return {
    tokens,
    capped,
    isLoading: balancesQuery.isLoading || tokensQuery.isLoading,
    isError: balancesQuery.isError || tokensQuery.isError,
    error: balancesQuery.error ?? tokensQuery.error,
  }
}

/** Owner + tokenURI for one token. ownerOf reverts for nonexistent tokens.
 * `enabled` lets a caller (e.g. a grid card's fallback) keep the read
 * dormant until it is actually needed. */
export function useToken(
  collection: `0x${string}` | undefined,
  tokenId: bigint | undefined,
  enabled = true,
) {
  const query = useReadContracts({
    contracts:
      collection === undefined || tokenId === undefined
        ? []
        : [
            {
              address: collection,
              abi: collectionAbi,
              functionName: 'ownerOf',
              args: [tokenId],
            },
            {
              address: collection,
              abi: collectionAbi,
              functionName: 'tokenURI',
              args: [tokenId],
            },
          ],
    query: {
      enabled:
        enabled && collection !== undefined && tokenId !== undefined,
    },
  })

  const owner = asAddress(query.data?.[0]?.result)
  const tokenUri = asString(query.data?.[1]?.result)
  const exists =
    query.data !== undefined && query.data.every((x) => x.status === 'success')

  return {
    owner: exists ? owner : undefined,
    tokenUri: exists ? tokenUri : undefined,
    exists,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  }
}

/**
 * tokenURI for ONE token via a direct eth_call — deliberately NOT the
 * multicall path. In this wagmi setup the client has batch.multicall
 * enabled, so even the singular useReadContract is routed through
 * Multicall3 by viem's `call` action, and concurrent reads are scheduled
 * into ONE aggregate3: a per-card fallback built on useReadContract would
 * be re-merged into a ~1MB multicall and rejected by the public RPC
 * exactly like the chunk it is meant to rescue. This hook calls the
 * public client's `call` action with `batch: false`, which skips the
 * multicall routing entirely, so the read stays one ~100KB eth_call on
 * its own and passes the RPC even when the chunk fails. This is the
 * per-card fallback used by MarketplaceItemCard.
 */
export function useTokenUriDirect(
  collection: `0x${string}` | undefined,
  tokenId: bigint | undefined,
  enabled = true,
) {
  const publicClient = usePublicClient()
  const query = useQuery({
    queryKey: ['tokenUriDirect', collection, tokenId?.toString()],
    queryFn: async () => {
      if (!publicClient || !collection || tokenId === undefined)
        return undefined
      const { data } = await publicClient.call({
        to: collection,
        data: encodeFunctionData({
          abi: collectionAbi,
          functionName: 'tokenURI',
          args: [tokenId],
        }),
        batch: false,
      })
      if (!data) return undefined
      return decodeFunctionResult({
        abi: collectionAbi,
        functionName: 'tokenURI',
        data,
      }) as string
    },
    enabled:
      enabled &&
      publicClient !== undefined &&
      collection !== undefined &&
      tokenId !== undefined,
  })
  return asString(query.data)
}

export interface TokenMetadata {
  name?: string
  description?: string
  image?: string
  attributes?: { trait_type?: string; value?: string | number }[]
  [key: string]: unknown
}

/**
 * Decode a `data:application/json` tokenURI inline (no fetch). Handles a
 * base64 payload (`;base64`) and a plain URL-encoded payload. The Squeek
 * collection's tokenURIs are data: URIs whose `image` is itself a
 * `data:image/svg+xml;base64,...` URI (the art is a ~72KB on-chain SVG), so
 * they can never be fetched — they must be decoded here. The `<img>` can
 * use the data-URI image directly.
 */
export function decodeDataJsonMetadata(uri: string): TokenMetadata {
  const comma = uri.indexOf(',')
  if (comma === -1) throw new Error('Malformed data: metadata URI')
  const header = uri.slice(0, comma)
  const payload = uri.slice(comma + 1)
  let json: string
  if (header.endsWith(';base64')) {
    const binary = atob(payload)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    json = new TextDecoder().decode(bytes)
  } else {
    json = decodeURIComponent(payload)
  }
  return JSON.parse(json) as TokenMetadata
}

/** Size of one tokenURI multicall chunk. Squeek tokenURIs are ~100KB
 * each, so a full 100-token multicall returns ~10MB and public RPCs
 * reject it; 10-call chunks are ~1MB each and go through. */
const TOKEN_URI_CHUNK_SIZE = 10

/** Minimal shape of one chunk query (only what useTokenUris reads). */
interface TokenUriChunkQuery {
  data: readonly { result?: unknown; status: string }[] | undefined
  isLoading: boolean
  isError: boolean
  error: Error | null
}

/** One 10-tokenURI chunk of the batch, as its own hook so useTokenUris
 * can call it a fixed 10 times (no hook call inside a loop). */
function useTokenUriChunk(
  collection: `0x${string}` | undefined,
  tokenIds: bigint[],
  chunkIndex: number,
): TokenUriChunkQuery {
  const chunk = tokenIds.slice(
    chunkIndex * TOKEN_URI_CHUNK_SIZE,
    (chunkIndex + 1) * TOKEN_URI_CHUNK_SIZE,
  )
  return useReadContracts({
    contracts:
      collection === undefined
        ? []
        : chunk.map((tokenId) => ({
            address: collection,
            abi: collectionAbi,
            functionName: 'tokenURI',
            args: [tokenId] as const,
          })),
    query: { enabled: collection !== undefined && chunk.length > 0 },
  })
}

/**
 * tokenURI for a list of tokens in one collection, read in fixed chunks
 * of 10 multicalls instead of one giant batch. Returns an array aligned
 * with `tokenIds`; an entry is undefined while loading or when its chunk
 * failed — callers must not leave the card a placeholder on undefined
 * (see MarketplaceItemCard's per-card fallback).
 */
export function useTokenUris(
  collection: `0x${string}` | undefined,
  tokenIds: bigint[],
) {
  const chunkQueries: TokenUriChunkQuery[] = [
    useTokenUriChunk(collection, tokenIds, 0),
    useTokenUriChunk(collection, tokenIds, 1),
    useTokenUriChunk(collection, tokenIds, 2),
    useTokenUriChunk(collection, tokenIds, 3),
    useTokenUriChunk(collection, tokenIds, 4),
    useTokenUriChunk(collection, tokenIds, 5),
    useTokenUriChunk(collection, tokenIds, 6),
    useTokenUriChunk(collection, tokenIds, 7),
    useTokenUriChunk(collection, tokenIds, 8),
    useTokenUriChunk(collection, tokenIds, 9),
  ]

  const uris = tokenIds.map((_, i) => {
    const chunk = Math.floor(i / TOKEN_URI_CHUNK_SIZE)
    const j = i % TOKEN_URI_CHUNK_SIZE
    return asString(chunkQueries[chunk]?.data?.[j]?.result)
  })

  return {
    uris,
    isLoading: chunkQueries.some((q) => q.isLoading),
    isError: chunkQueries.some((q) => q.isError),
    error: chunkQueries.find((q) => q.error)?.error,
  }
}

/** Fetch tokenURI JSON (http(s) or ipfs://), or decode data: URIs inline. Failures are reported, not fatal. */
export function useTokenMetadata(tokenUri: string | undefined) {
  const [state, setState] = useState<{
    status: 'idle' | 'loading' | 'ok' | 'error' | 'unsupported'
    metadata?: TokenMetadata
    error?: string
  }>({ status: 'idle' })

  useEffect(() => {
    if (!tokenUri) {
      setState({ status: 'idle' })
      return
    }
    // Squeek tokenURIs are data:application/json;base64,... — decode
    // inline instead of fetching (a data: URI cannot be fetched).
    if (tokenUri.startsWith('data:application/json;')) {
      try {
        setState({ status: 'ok', metadata: decodeDataJsonMetadata(tokenUri) })
      } catch (err: unknown) {
        setState({
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return
    }
    if (!isFetchableMetadataUri(tokenUri)) {
      setState({ status: 'unsupported' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    fetch(resolveUri(tokenUri))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<TokenMetadata>
      })
      .then((metadata) => {
        if (!cancelled) setState({ status: 'ok', metadata })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [tokenUri])

  return state
}

/**
 * True when a wallet is connected to a chain other than the site's target
 * chain (Sepolia, or the local anvil in dev). Every write button in the app
 * is disabled while this is true — signing on the wrong chain is how real
 * mainnet ETH got spent from a testnet site. Read-only browsing is
 * unaffected.
 */
export function useWrongNetwork() {
  // NOTE: useAccount().chainId, NOT useChainId(). wagmi's useChainId()
  // returns the app's *configured* chain (state.chainId, initialised to
  // the first chain in the config) — it does NOT follow the wallet when
  // the wallet is on a chain that is not in the config (e.g. mainnet).
  // useAccount().chainId is the connection's chain: the wallet's actual
  // chain at connect time and on every chainChanged event. Using
  // useChainId() here meant a wallet connected on mainnet looked "on
  // Sepolia" and every write button stayed enabled — the exact failure
  // this feature exists to prevent (proven by the headless fixture).
  const { isConnected, chainId } = useAccount()
  return isConnected && chainId !== activeChain.id
}

// --- Marketplace + indexer hooks (Phase 4) ---

import { marketplaceAbi, verifiedRegistryAbi } from './abi'
import {
  MARKETPLACE_ADDRESS,
  MARKETPLACE_DEPLOYED,
  VERIFIED_REGISTRY_ADDRESS,
  VERIFIED_REGISTRY_DEPLOYED,
} from './marketplace-config'

/**
 * Whether a collection is verified in the on-chain VerifiedRegistry.
 * Returns false (without making any chain read) while the registry is not
 * configured — the badge is simply hidden until it is deployed and set.
 */
export function useVerified(collection: `0x${string}` | undefined) {
  const query = useReadContract({
    address: VERIFIED_REGISTRY_ADDRESS,
    abi: verifiedRegistryAbi,
    functionName: 'isVerified',
    args: collection !== undefined ? [collection] : undefined,
    query: {
      enabled: VERIFIED_REGISTRY_DEPLOYED && collection !== undefined,
    },
  })
  return {
    verified: query.data === true,
    isLoading: query.isLoading,
    isError: query.isError,
  }
}
import {
  indexerApi,
  type IndexerActivity,
  type IndexerCollection,
  type IndexerCollectionOffer,
  type IndexerHolder,
  type IndexerListing,
  type IndexerOwnedNft,
  type IndexerToken,
  type IndexerTokenDetail,
  type IndexerOffer,
} from './lib/indexer'

export type {
  IndexerActivity,
  IndexerCollection,
  IndexerCollectionOffer,
  IndexerHolder,
  IndexerListing,
  IndexerOwnedNft,
  IndexerToken,
  IndexerTokenDetail,
  IndexerOffer,
}

/** Generic indexer fetch: data, loading, error, and a manual refetch. */
function useIndexerFetch<T>(
  fetcher: () => Promise<T | null>,
  deps: unknown[],
) {
  const [state, setState] = useState<{
    data: T | null
    isLoading: boolean
    isError: boolean
  }>({ data: null, isLoading: true, isError: false })

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, isLoading: true, isError: false }))
    fetcher()
      .then((data) => {
        if (!cancelled) {
          setState({ data, isLoading: false, isError: data === null })
        }
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, isLoading: false, isError: true })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}

/** All tracked collections from the indexer (null = indexer unreachable). */
export function useIndexerCollections() {
  return useIndexerFetch(() => indexerApi.collections(), [])
}

/** One tracked collection from the indexer. */
export function useIndexerCollection(address: string | undefined) {
  return useIndexerFetch(
    () => (address ? indexerApi.collection(address) : Promise.resolve(null)),
    [address],
  )
}

/** Holders of one collection, from the indexer. */
export function useIndexerHolders(address: string | undefined) {
  return useIndexerFetch(
    () => (address ? indexerApi.holders(address) : Promise.resolve(null)),
    [address],
  )
}

/** Active listings of one collection, from the indexer. */
export function useIndexerListings(address: string | undefined) {
  return useIndexerFetch(
    () => (address ? indexerApi.listings(address) : Promise.resolve(null)),
    [address],
  )
}

/** Recent activity of one collection, from the indexer. */
export function useIndexerActivity(address: string | undefined) {
  return useIndexerFetch(
    () => (address ? indexerApi.activity(address) : Promise.resolve(null)),
    [address],
  )
}

/** Token detail (owner, level, listing, offers) from the indexer. */
export function useIndexerToken(
  collection: string | undefined,
  tokenId: string | undefined,
) {
  return useIndexerFetch(
    () =>
      collection && tokenId
        ? indexerApi.token(collection, tokenId)
        : Promise.resolve(null),
    [collection, tokenId],
  )
}

/** NFTs owned by an address across all tracked collections, from the indexer. */
export function useIndexerOwnerNfts(owner: string | undefined) {
  return useIndexerFetch(
    () => (owner ? indexerApi.ownerNfts(owner) : Promise.resolve(null)),
    [owner],
  )
}

/** Active listings by a seller, from the indexer. */
export function useIndexerOwnerListings(owner: string | undefined) {
  return useIndexerFetch(
    () => (owner ? indexerApi.ownerListings(owner) : Promise.resolve(null)),
    [owner],
  )
}

/** Active offers by a bidder, from the indexer. */
export function useIndexerOwnerOffers(owner: string | undefined) {
  return useIndexerFetch(
    () => (owner ? indexerApi.ownerOffers(owner) : Promise.resolve(null)),
    [owner],
  )
}

export interface MarketplaceListing {
  listingId: bigint
  seller: `0x${string}`
  collection: `0x${string}`
  tokenId: bigint
  price: bigint
  /** Unix seconds; v3 listings always carry one. */
  expiry: bigint
  active: boolean
}

/** Active listing for a token, read directly from the marketplace contract.
 * An expired listing counts as not listed — same read-time expiry check
 * as the collection-offer liveness filter (isLiveOffer). The contract's
 * activeListingOf already returns 0 past expiry; this is belt and
 * braces for a stale or legacy read. */
export function useActiveListing(
  collection: `0x${string}` | undefined,
  tokenId: bigint | undefined,
) {
  const idQuery = useReadContract({
    address: MARKETPLACE_ADDRESS,
    abi: marketplaceAbi,
    functionName: 'activeListingOf',
    args:
      collection !== undefined && tokenId !== undefined
        ? [collection, tokenId]
        : undefined,
    query: {
      enabled:
        MARKETPLACE_DEPLOYED && collection !== undefined && tokenId !== undefined,
    },
  })
  const listingId =
    typeof idQuery.data === 'bigint' ? idQuery.data : undefined

  const listingQuery = useReadContract({
    address: MARKETPLACE_ADDRESS,
    abi: marketplaceAbi,
    functionName: 'listings',
    args: listingId !== undefined ? [listingId] : undefined,
    query: {
      enabled: MARKETPLACE_DEPLOYED && listingId !== undefined && listingId > 0n,
    },
  })

  const raw = listingQuery.data as
    | readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, boolean]
    | undefined
  const listing: MarketplaceListing | undefined =
    raw !== undefined && listingId !== undefined
      ? {
          listingId,
          seller: raw[0],
          collection: raw[1],
          tokenId: raw[2],
          price: raw[3],
          expiry: raw[4],
          active: raw[5],
        }
      : undefined

  // The v3 `listings` getter returns a 6-tuple with expiry; the check
  // mirrors the collection-offer liveness filter (isLiveOffer).
  const nowSec = Math.floor(Date.now() / 1000)
  const live = listing?.active && Number(listing.expiry) > nowSec

  return {
    listing: live ? listing : undefined,
    isLoading: idQuery.isLoading || listingQuery.isLoading,
    isError: idQuery.isError || listingQuery.isError,
    error: idQuery.error ?? listingQuery.error,
    refetch: () => {
      void idQuery.refetch()
      void listingQuery.refetch()
    },
  }
}

/** Live tokens of one collection (paginated), from the indexer. */
export function useIndexerTokens(
  address: string | undefined,
  limit = 100,
) {
  return useIndexerFetch(
    () =>
      address
        ? indexerApi.tokens(address, limit, 0)
        : Promise.resolve(null),
    [address, limit],
  )
}

// --- Collection offers (Phase 5) ---
//
// The indexer build that serves collection offers (GET
// /collections/:address/collection-offers, topBidWei, hasLevels, kind:
// "collection" in token/owner offers) runs in parallel with this frontend
// work and may not have landed yet. Everything below therefore reads the
// marketplace contract DIRECTLY first (the useVerified pattern) and only
// uses indexer fields when they are actually present — a missing endpoint
// or field is treated as absent, never as an error. When the indexer
// lands, its rows are merged in by id (chain rows win on conflicts).

export interface CollectionOffer {
  id: bigint
  bidder: `0x${string}`
  collection: `0x${string}`
  totalPrice: bigint
  pricePerItem: bigint
  quantity: bigint
  filled: bigint
  level: bigint // 0 = any level
  expiry: bigint // unix seconds
  active: boolean
}

/** Cap on collection-offer ids scanned in one multicall. */
const COLLECTION_OFFER_SCAN_CAP = 200

function chainCollectionOffer(
  id: bigint,
  raw: readonly unknown[] | undefined,
): CollectionOffer | undefined {
  if (raw === undefined || raw.length < 9) return undefined
  const [bidder, collection, totalPrice, pricePerItem, quantity, filled, level, expiry, active] =
    raw as readonly [
      `0x${string}`,
      `0x${string}`,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      boolean,
    ]
  return {
    id,
    bidder,
    collection,
    totalPrice,
    pricePerItem,
    quantity,
    filled,
    level,
    expiry,
    active,
  }
}

function isLiveOffer(o: CollectionOffer, nowSec: number): boolean {
  return o.active && Number(o.expiry) > nowSec
}

/** Live collection offers on one collection, read directly from the contract. */
export function useChainCollectionOffers(collection: `0x${string}` | undefined) {
  const nextQuery = useReadContract({
    address: MARKETPLACE_ADDRESS,
    abi: marketplaceAbi,
    functionName: 'nextCollectionOfferId',
    query: { enabled: MARKETPLACE_DEPLOYED && collection !== undefined },
  })
  const next =
    typeof nextQuery.data === 'bigint' ? nextQuery.data : undefined
  const count =
    next === undefined
      ? 0
      : Math.min(Number(next - 1n), COLLECTION_OFFER_SCAN_CAP)

  const offersQuery = useReadContracts({
    contracts:
      collection === undefined || count === 0
        ? []
        : Array.from({ length: count }, (_, i) => ({
            address: MARKETPLACE_ADDRESS as `0x${string}`,
            abi: marketplaceAbi,
            functionName: 'collectionOffers',
            args: [BigInt(i + 1)],
          })),
    query: { enabled: MARKETPLACE_DEPLOYED && collection !== undefined && count > 0 },
  })

  const nowSec = Math.floor(Date.now() / 1000)
  const offers: CollectionOffer[] = (offersQuery.data ?? [])
    .map((r, i) =>
      chainCollectionOffer(BigInt(i + 1), r.result as readonly unknown[] | undefined),
    )
    .filter((o): o is CollectionOffer => o !== undefined)
    .filter(
      (o) =>
        o.collection.toLowerCase() === collection?.toLowerCase() &&
        isLiveOffer(o, nowSec),
    )

  return {
    offers,
    isLoading: nextQuery.isLoading || offersQuery.isLoading,
    isError: nextQuery.isError || offersQuery.isError,
    error: nextQuery.error ?? offersQuery.error,
    refetch: () => {
      void nextQuery.refetch()
      void offersQuery.refetch()
    },
  }
}

/** Live collection offers on one collection, from the indexer (null = endpoint not served yet). */
export function useIndexerCollectionOffers(address: string | undefined) {
  return useIndexerFetch(
    () =>
      address
        ? indexerApi.collectionOffers(address)
        : Promise.resolve(null),
    [address],
  )
}

function indexerCollectionOffer(
  row: IndexerCollectionOffer,
): CollectionOffer | undefined {
  try {
    return {
      // The indexer serves the id as `id` (older code expected
      // `collectionOfferId`); read both.
      id: BigInt(row.collectionOfferId ?? row.id),
      bidder: row.bidder as `0x${string}`,
      collection: row.collection as `0x${string}`,
      totalPrice: BigInt(row.totalPriceWei),
      pricePerItem: BigInt(row.pricePerItemWei),
      quantity: BigInt(row.quantity),
      filled: BigInt(row.filled),
      level: BigInt(row.level ?? 0),
      expiry: BigInt(row.expiry),
      active: true,
    }
  } catch {
    return undefined
  }
}

/**
 * Live collection offers on one collection: chain reads merged with the
 * indexer's endpoint when it serves rows. Chain rows are the source of
 * truth; indexer rows only add ids the chain scan did not return (e.g.
 * while the chain read is still loading, or past the scan cap).
 */
export function useCollectionOffers(collection: `0x${string}` | undefined) {
  const chain = useChainCollectionOffers(collection)
  const indexer = useIndexerCollectionOffers(
    collection === undefined ? undefined : collection.toLowerCase(),
  )

  const nowSec = Math.floor(Date.now() / 1000)
  const byId = new Map<string, CollectionOffer>()
  for (const o of chain.offers) byId.set(o.id.toString(), o)
  for (const row of indexer.data ?? []) {
    const o = indexerCollectionOffer(row)
    if (
      o !== undefined &&
      !byId.has(o.id.toString()) &&
      o.collection.toLowerCase() === collection?.toLowerCase() &&
      isLiveOffer(o, nowSec)
    ) {
      byId.set(o.id.toString(), o)
    }
  }
  const offers = [...byId.values()].sort((a, b) =>
    a.pricePerItem > b.pricePerItem ? -1 : a.pricePerItem < b.pricePerItem ? 1 : 0,
  )

  return {
    offers,
    isLoading: chain.isLoading || indexer.isLoading,
    isError: chain.isError && indexer.isError,
    refetch: () => {
      chain.refetch()
    },
  }
}

/** Minimal ABI for a Squeek-style `level(uint256)` getter. */
const levelAbi = [
  {
    name: 'level',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

/**
 * A token's level read directly from the collection contract.
 * `supported` is false when the collection has no level getter (plain
 * collections) — callers then only match "any level" offers. No retry:
 * a missing getter reverts on every call.
 */
export function useTokenLevel(
  collection: `0x${string}` | undefined,
  tokenId: bigint | undefined,
) {
  const query = useReadContract({
    address: collection,
    abi: levelAbi,
    functionName: 'level',
    args: tokenId !== undefined ? [tokenId] : undefined,
    query: {
      enabled: collection !== undefined && tokenId !== undefined,
      retry: false,
    },
  })
  return {
    level: typeof query.data === 'bigint' ? query.data : undefined,
    supported: query.data !== undefined,
    isLoading: query.isLoading,
  }
}

/**
 * Indexer token details for a list of token ids in one collection, as a
 * map keyed by token id. Used by the Owned bulk-accept panel to find each
 * selected token's live per-token offers. Tokens the indexer does not
 * know map to null.
 */
export function useIndexerTokenDetails(
  collection: `0x${string}` | undefined,
  tokenIds: string[],
) {
  const key = tokenIds.join(',')
  const [state, setState] = useState<{
    details: Map<string, IndexerTokenDetail | null>
    isLoading: boolean
  }>({ details: new Map(), isLoading: tokenIds.length > 0 })

  useEffect(() => {
    if (!collection || tokenIds.length === 0) {
      setState({ details: new Map(), isLoading: false })
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, isLoading: true }))
    Promise.all(
      tokenIds.map((id) =>
        indexerApi
          .token(collection.toLowerCase(), id)
          .catch(() => null),
      ),
    ).then((rows) => {
      if (cancelled) return
      const details = new Map<string, IndexerTokenDetail | null>()
      tokenIds.forEach((id, i) => details.set(id, rows[i] ?? null))
      setState({ details, isLoading: false })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, key])

  return state
}

/**
 * Live collection offers placed by one bidder, read directly from the
 * contract (scan of nextCollectionOfferId, capped). Merged with the
 * indexer's /owners/:address/offers rows by the caller.
 */
export function useChainCollectionOffersByBidder(
  bidder: `0x${string}` | undefined,
) {
  const publicClient = usePublicClient()
  const query = useQuery({
    queryKey: ['chainCollectionOffersByBidder', bidder?.toLowerCase()],
    queryFn: async () => {
      if (!publicClient || !bidder || !MARKETPLACE_ADDRESS) return []
      const next = (await publicClient.readContract({
        address: MARKETPLACE_ADDRESS,
        abi: marketplaceAbi,
        functionName: 'nextCollectionOfferId',
      })) as bigint
      const count = Math.min(Number(next - 1n), 500)
      if (count <= 0) return []
      // multicallAddress is passed explicitly: the local anvil chain
      // (config.ts) does not declare a multicall3 contract, so viem's
      // multicall action would otherwise throw "chain does not support
      // contract multicall3" there. The canonical address is deployed on
      // the fixture (and on Sepolia) via anvil_setCode / natively.
      const results = await publicClient.multicall({
        multicallAddress:
          '0xcA11bde05977b3631167028862bE2a173976CA11' as `0x${string}`,
        contracts: Array.from({ length: count }, (_, i) => ({
          address: MARKETPLACE_ADDRESS as `0x${string}`,
          abi: marketplaceAbi,
          functionName: 'collectionOffers',
          args: [BigInt(i + 1)],
        })),
      })
      const nowSec = Math.floor(Date.now() / 1000)
      const offers: CollectionOffer[] = []
      results.forEach((r, i) => {
        if (r.status !== 'success') return
        const o = chainCollectionOffer(
          BigInt(i + 1),
          r.result as readonly unknown[],
        )
        if (
          o !== undefined &&
          o.bidder.toLowerCase() === bidder.toLowerCase() &&
          isLiveOffer(o, nowSec)
        ) {
          offers.push(o)
        }
      })
      return offers
    },
    enabled:
      MARKETPLACE_DEPLOYED && bidder !== undefined && publicClient !== undefined,
  })
  return {
    offers: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  }
}

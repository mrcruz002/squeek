// BulkAcceptPanel — the Owned tab's "Accept N offer(s)" button (Phase 5).
// For each selected NFT it takes the HIGHEST-price live offer (per-token
// or collection offer, whichever pays more) and accepts them in batch:
// acceptOffers for the per-token ones, acceptCollectionOffers for the
// collection ones — one transaction per kind, attempted in that order, so
// a failure in one batch does not block the other. Each batch is
// all-or-nothing on-chain, so per-NFT results are reported per batch:
// every NFT in a confirmed batch is sold, every NFT in a failed batch is
// reported failed with the error. A token that is not listed needs the
// marketplace approved first — an Approve button (setApprovalForAll, one
// transaction for the whole collection) gates the accept button until then.

import { useEffect, useRef, useState } from 'react'
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWalletClient,
  useWriteContract,
} from 'wagmi'
import { formatEther } from 'viem'
import { collectionAbi, marketplaceAbi } from '../abi'
import { activeChain } from '../config'
import { MARKETPLACE_ADDRESS, MARKETPLACE_DEPLOYED } from '../marketplace-config'
import {
  useIndexerTokenDetails,
  useWrongNetwork,
  type CollectionOffer,
  type IndexerTokenDetail,
} from '../hooks'
import { errorMessage, shortenAddress } from '../lib/utils'
import WrongNetworkNote from './WrongNetworkNote'

export interface BestOffer {
  tokenId: string
  kind: 'token' | 'collection'
  /** Offer id (per-token) or collection-offer id. */
  id: bigint
  priceWei: bigint
  bidder: `0x${string}`
  level: number | null
}

export interface AcceptResult {
  tokenId: string
  kind: 'token' | 'collection'
  priceWei: bigint
  status: 'sold' | 'failed'
  message?: string
}

/** Highest live offer on each token, or undefined when it has none. */
export function bestOffersForTokens(
  tokenIds: string[],
  details: Map<string, IndexerTokenDetail | null>,
  collectionOffers: CollectionOffer[],
  owner: `0x${string}` | undefined,
): Map<string, BestOffer> {
  const best = new Map<string, BestOffer>()
  for (const tokenId of tokenIds) {
    const detail = details.get(tokenId)
    const level = detail?.level ?? null
    let top: BestOffer | undefined
    // Per-token offers from the indexer. Collection offers also appear
    // in this list (kind 'collection', priced per-item in
    // pricePerItemWei, not priceWei) — skip them here; the matching
    // collection-offers loop below handles them. Reading priceWei on one
    // would crash the Owned tab (BigInt(undefined)).
    for (const o of detail?.offers ?? []) {
      if (o.kind === 'collection') continue
      const price = BigInt(o.priceWei)
      if (top === undefined || price > top.priceWei) {
        top = {
          tokenId,
          kind: 'token',
          id: BigInt(o.offerId),
          priceWei: price,
          bidder: o.bidder as `0x${string}`,
          level: null,
        }
      }
    }
    // Matching collection offers: level must match (or be any level) and
    // the bidder must not own the token. When the token's level is
    // unknown, only any-level offers match.
    for (const o of collectionOffers) {
      if (
        owner !== undefined &&
        o.bidder.toLowerCase() === owner.toLowerCase()
      ) {
        continue
      }
      if (Number(o.level) !== 0 && (level === null || Number(o.level) !== level)) {
        continue
      }
      if (top === undefined || o.pricePerItem > top.priceWei) {
        top = {
          tokenId,
          kind: 'collection',
          id: o.id,
          priceWei: o.pricePerItem,
          bidder: o.bidder,
          level: Number(o.level) === 0 ? null : Number(o.level),
        }
      }
    }
    if (top !== undefined) best.set(tokenId, top)
  }
  return best
}

export default function BulkAcceptPanel({
  collection,
  selected,
  collectionOffers,
  onDone,
}: {
  collection: `0x${string}`
  /** Selected token ids (strings). */
  selected: string[]
  collectionOffers: CollectionOffer[]
  onDone: () => void
}) {
  const { address: owner } = useAccount()
  const wrongNetwork = useWrongNetwork()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { details, isLoading: detailsLoading } = useIndexerTokenDetails(
    collection,
    selected,
  )
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<AcceptResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const best = bestOffersForTokens(selected, details, collectionOffers, owner)
  const withOffer = selected.filter((id) => best.has(id))

  // Approval: a token needs no approval while listed (escrow) or when the
  // marketplace is approved for it (single approval or operator-wide).
  const approvedForAllQuery = useReadContract({
    address: collection,
    abi: collectionAbi,
    functionName: 'isApprovedForAll',
    args:
      owner !== undefined && MARKETPLACE_ADDRESS !== undefined
        ? [owner, MARKETPLACE_ADDRESS]
        : undefined,
    query: {
      enabled: owner !== undefined && MARKETPLACE_DEPLOYED,
    },
  })
  const approvedForAll = approvedForAllQuery.data === true
  const getApprovedQuery = useReadContracts({
    contracts: withOffer.map((tokenId) => ({
      address: collection,
      abi: collectionAbi,
      functionName: 'getApproved',
      args: [BigInt(tokenId)],
    })),
    query: { enabled: withOffer.length > 0 },
  })
  const needsApproval = withOffer.some((tokenId, i) => {
    const detail = details.get(tokenId)
    if (detail?.listing) return false // in escrow — no approval needed
    if (approvedForAll) return false
    const approved = getApprovedQuery.data?.[i]?.result
    return (
      typeof approved !== 'string' ||
      approved.toLowerCase() !== MARKETPLACE_ADDRESS?.toLowerCase()
    )
  })

  const {
    writeContract: approveWrite,
    data: approveHash,
    isPending: approvePending,
    error: approveError,
    reset: approveReset,
  } = useWriteContract()
  const approveReceipt = useWaitForTransactionReceipt({ hash: approveHash })

  // The approval reads (isApprovedForAll / getApproved) do not refetch
  // on new blocks, so after the approval lands needsApproval stays true
  // and the Accept button stays disabled until a page reload. Refresh
  // them the moment the approval receipt succeeds. The per-hash guard
  // makes the refresh run exactly once per approval transaction.
  const approvalRefreshDone = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (approveReceipt.data?.status !== 'success' || !approveHash) return
    if (approvalRefreshDone.current === approveHash) return
    approvalRefreshDone.current = approveHash
    void approvedForAllQuery.refetch()
    void getApprovedQuery.refetch()
  }, [
    approveReceipt.data?.status,
    approveHash,
    approvedForAllQuery,
    getApprovedQuery,
  ])

  if (selected.length === 0) return null

  async function acceptAll() {
    // Belt and braces: the button is disabled on the wrong network, and
    // this guard stops any other caller from signing there either.
    if (wrongNetwork) return
    if (
      !MARKETPLACE_ADDRESS ||
      !walletClient ||
      !publicClient ||
      !owner ||
      withOffer.length === 0
    ) {
      return
    }
    setBusy(true)
    setError(null)
    setResults(null)
    // Narrowed by the guard above; captured by the batch closures below.
    const market: `0x${string}` = MARKETPLACE_ADDRESS
    const tokenBests = withOffer
      .map((id) => best.get(id))
      .filter((b): b is BestOffer => b !== undefined)
    const perToken = tokenBests.filter((b) => b.kind === 'token')
    const perCollection = tokenBests.filter((b) => b.kind === 'collection')
    const out: AcceptResult[] = []

    async function runBatch(
      label: string,
      fn: () => Promise<`0x${string}`>,
      items: BestOffer[],
    ) {
      try {
        const hash = await fn()
        const receipt = await publicClient!.waitForTransactionReceipt({ hash })
        if (receipt.status === 'reverted') {
          throw new Error('transaction reverted on-chain')
        }
        for (const b of items) {
          out.push({ tokenId: b.tokenId, kind: b.kind, priceWei: b.priceWei, status: 'sold' })
        }
      } catch (err: unknown) {
        for (const b of items) {
          out.push({
            tokenId: b.tokenId,
            kind: b.kind,
            priceWei: b.priceWei,
            status: 'failed',
            message: `${label} failed: ${errorMessage(err)}`,
          })
        }
      }
    }

    if (perToken.length > 0) {
      await runBatch(
        'Per-token batch',
        () =>
          walletClient.writeContract({
            address: market,
            abi: marketplaceAbi,
            functionName: 'acceptOffers',
            args: [perToken.map((b) => b.id)],
            account: owner,
            chain: activeChain,
          }),
        perToken,
      )
    }
    if (perCollection.length > 0) {
      await runBatch(
        'Collection batch',
        () =>
          walletClient.writeContract({
            address: market,
            abi: marketplaceAbi,
            functionName: 'acceptCollectionOffers',
            args: [
              perCollection.map((b) => b.id),
              perCollection.map((b) => BigInt(b.tokenId)),
            ],
            account: owner,
            chain: activeChain,
          }),
        perCollection,
      )
    }
    setResults(out)
    setBusy(false)
    onDone()
  }

  const sold = results?.filter((r) => r.status === 'sold') ?? []

  return (
    <div className="card">
      <p>
        <strong>
          {withOffer.length} of {selected.length} selected{' '}
          {selected.length === 1 ? 'NFT has' : 'NFTs have'} a live offer
        </strong>
        {detailsLoading && <span className="muted"> — checking offers…</span>}
      </p>
      {withOffer.length > 0 && (
        <ul className="sq-list">
          {withOffer.map((tokenId) => {
            const b = best.get(tokenId)
            if (!b) return null
            return (
              <li key={tokenId}>
                Token #{tokenId} — best{' '}
                {b.kind === 'collection' ? 'collection offer' : 'offer'}{' '}
                <strong>{formatEther(b.priceWei)} ETH</strong>
                {b.level !== null && (
                  <span className="muted small"> · Level {b.level}</span>
                )}{' '}
                from{' '}
                <span className="mono small">{shortenAddress(b.bidder)}</span>
              </li>
            )
          })}
        </ul>
      )}
      {wrongNetwork && withOffer.length > 0 && (
        <WrongNetworkNote action="accept offers" />
      )}
      {needsApproval && withOffer.length > 0 && (
        <p className="notice">
          These NFTs are not listed, so the marketplace needs your approval
          to move them on a sale. Approve once for the whole collection,
          then accept.
        </p>
      )}
      {needsApproval && withOffer.length > 0 && (
        <button
          className="btn btn-primary"
          disabled={
            approvePending || approveReceipt.isLoading || busy || wrongNetwork
          }
          onClick={() => {
            if (!MARKETPLACE_ADDRESS) return
            approveReset()
            approveWrite({
              address: collection,
              abi: collectionAbi,
              functionName: 'setApprovalForAll',
              args: [MARKETPLACE_ADDRESS, true],
            })
          }}
        >
          {approvePending || approveReceipt.isLoading
            ? 'Confirm in wallet…'
            : '1. Approve marketplace for these NFTs'}
        </button>
      )}
      {approveError && (
        <p className="error">Approval failed: {errorMessage(approveError)}</p>
      )}
      {approveReceipt.data?.status === 'reverted' && (
        <p className="error">
          Approval failed: the transaction was reverted on-chain. The Accept
          button stays disabled — try approving again.
        </p>
      )}
      {approveReceipt.data?.status === 'success' && (
        <p className="success-box">Approved — you can accept the offers now.</p>
      )}
      <button
        className="btn btn-primary btn-block"
        disabled={
          busy ||
          withOffer.length === 0 ||
          needsApproval ||
          wrongNetwork ||
          !MARKETPLACE_DEPLOYED
        }
        onClick={() => void acceptAll()}
      >
        {busy
          ? 'Accepting…'
          : `Accept ${withOffer.length} offer${withOffer.length === 1 ? '' : 's'}`}
      </button>
      {error && <p className="error">{error}</p>}
      {results !== null && (
        <div>
          <h3>Results</h3>
          <ul className="sq-list">
            {results.map((r) => (
              <li key={`${r.kind}-${r.tokenId}`}>
                Token #{r.tokenId} —{' '}
                {r.status === 'sold' ? (
                  <>
                    <strong>sold</strong> for {formatEther(r.priceWei)} ETH (
                    {r.kind === 'collection' ? 'collection offer' : 'offer'})
                  </>
                ) : (
                  <>
                    <strong>failed</strong> — {r.message ?? 'unknown error'}
                  </>
                )}
              </li>
            ))}
          </ul>
          {sold.length > 0 && (
            <p className="muted small">
              Sold NFTs leave your Owned tab once the indexer catches up.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// BulkListPanel — the Owned tab's "List NFT" panel (Phase 5b).
// Next to BulkAcceptPanel ("Accept offer"): when the user selects NFTs
// they hold, this lists each UNLISTED one at one price for one duration
// (marketplace v3: list(collection, tokenId, price, durationSeconds)).
// Flow mirrors BulkAcceptPanel: setApprovalForAll once for the whole
// collection first (if needed), then list each selected unlisted NFT
// sequentially, reporting per-NFT results (listed / failed + reason) the
// way BulkAcceptPanel reports per-NFT accept results. NFTs already listed
// are skipped with a note — approval is not needed for them anyway, since
// they are already in escrow. An expired listing does not count as
// listed (the indexer filters it, and the contract's activeListingOf
// returns 0 past expiry), so such a token is re-listed straight from
// escrow by the contract, no cancel needed.

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
import { formatEther, parseEther } from 'viem'
import { collectionAbi, marketplaceAbi } from '../abi'
import { activeChain } from '../config'
import { MARKETPLACE_ADDRESS, MARKETPLACE_DEPLOYED } from '../marketplace-config'
import { useIndexerTokenDetails, useWrongNetwork } from '../hooks'
import { errorMessage } from '../lib/utils'
import WrongNetworkNote from './WrongNetworkNote'

export interface ListResult {
  tokenId: string
  priceWei: bigint
  status: 'listed' | 'skipped' | 'failed'
  message?: string
}

export default function BulkListPanel({
  collection,
  selected,
  onDone,
}: {
  collection: `0x${string}`
  /** Selected token ids (strings). */
  selected: string[]
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
  const [price, setPrice] = useState('0.01')
  const [days, setDays] = useState(30)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<ListResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Live listed check, direct from the contract: activeListingOf returns
  // 0 for an unlisted token AND for one whose listing has expired (v3),
  // so an expired listing is re-listable, not skipped. The indexer
  // detail is a second source (it also filters expired listings) for
  // the brief window before the chain read lands.
  const activeListingQuery = useReadContracts({
    contracts: selected.map((tokenId) => ({
      address: MARKETPLACE_ADDRESS as `0x${string}`,
      abi: marketplaceAbi,
      functionName: 'activeListingOf',
      args: [collection, BigInt(tokenId)],
    })),
    query: { enabled: MARKETPLACE_DEPLOYED && selected.length > 0 },
  })
  const isListed = (tokenId: string, i: number) => {
    if (details.get(tokenId)?.listing) return true
    const id = activeListingQuery.data?.[i]?.result
    return typeof id === 'bigint' && id > 0n
  }
  const listed = selected.filter((id, i) => isListed(id, i))
  const toList = selected.filter((id, i) => !isListed(id, i))

  // Approval: setApprovalForAll once for the whole collection, same as
  // BulkAcceptPanel. Listed tokens are skipped, so they never need it.
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
  const needsApproval = toList.length > 0 && !approvedForAll

  const {
    writeContract: approveWrite,
    data: approveHash,
    isPending: approvePending,
    error: approveError,
    reset: approveReset,
  } = useWriteContract()
  const approveReceipt = useWaitForTransactionReceipt({ hash: approveHash })

  // Same staleness as BulkAcceptPanel: isApprovedForAll does not refetch
  // on new blocks, so after the approval lands the List button would
  // stay disabled until a page reload. Refresh it the moment the
  // approval receipt succeeds. The per-hash guard makes the refresh run
  // exactly once per approval transaction.
  const approvalRefreshDone = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (approveReceipt.data?.status !== 'success' || !approveHash) return
    if (approvalRefreshDone.current === approveHash) return
    approvalRefreshDone.current = approveHash
    void approvedForAllQuery.refetch()
  }, [approveReceipt.data?.status, approveHash, approvedForAllQuery])

  if (selected.length === 0) return null

  const priceWei = (() => {
    try {
      return parseEther(price || '0')
    } catch {
      return 0n
    }
  })()
  const durationSeconds = BigInt(Math.max(1, days || 30) * 24 * 60 * 60)
  const priceValid = priceWei > 0n

  async function listAll() {
    // Belt and braces: the button is disabled on the wrong network, and
    // this guard stops any other caller from signing there either.
    if (wrongNetwork) return
    if (
      !MARKETPLACE_ADDRESS ||
      !walletClient ||
      !publicClient ||
      !owner ||
      toList.length === 0 ||
      !priceValid
    ) {
      return
    }
    setBusy(true)
    setError(null)
    setResults(null)
    // Narrowed by the guard above; captured by the loop below.
    const market: `0x${string}` = MARKETPLACE_ADDRESS
    const out: ListResult[] = []
    // Already-listed tokens are reported as skipped, not attempted.
    for (const tokenId of listed) {
      out.push({
        tokenId,
        priceWei,
        status: 'skipped',
        message: 'already listed',
      })
    }
    // One transaction per NFT, in selection order. A failure on one
    // token is reported per-NFT and does not block the rest (unlike the
    // all-or-nothing accept batches — a list has no shared escrow to
    // keep atomic).
    for (const tokenId of toList) {
      try {
        const hash = await walletClient.writeContract({
          address: market,
          abi: marketplaceAbi,
          functionName: 'list',
          args: [collection, BigInt(tokenId), priceWei, durationSeconds],
          account: owner,
          chain: activeChain,
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status === 'reverted') {
          throw new Error('transaction reverted on-chain')
        }
        out.push({ tokenId, priceWei, status: 'listed' })
      } catch (err: unknown) {
        out.push({
          tokenId,
          priceWei,
          status: 'failed',
          message: errorMessage(err),
        })
      }
    }
    setResults(out)
    setBusy(false)
    onDone()
  }

  const listedCount = results?.filter((r) => r.status === 'listed').length ?? 0

  return (
    <div className="card">
      <h3>List NFT</h3>
      <p>
        <strong>
          {toList.length} of {selected.length} selected{' '}
          {selected.length === 1 ? 'NFT is' : 'NFTs are'} unlisted
        </strong>
        {detailsLoading && <span className="muted"> — checking listings…</span>}
      </p>
      {listed.length > 0 && (
        <p className="muted small">
          Already listed (skipped):{' '}
          {listed.map((id) => `#${id}`).join(', ')} — those NFTs are in
          marketplace escrow already.
        </p>
      )}
      <div className="qty-row">
        <label htmlFor="bulk-list-price">Price (ETH)</label>
        <input
          id="bulk-list-price"
          type="number"
          min="0"
          step="0.001"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <label htmlFor="bulk-list-days">Days</label>
        <input
          id="bulk-list-days"
          type="number"
          min="1"
          max="365"
          value={days}
          onChange={(e) =>
            setDays(Math.max(1, Math.min(365, Number(e.target.value) || 30)))
          }
        />
      </div>
      <p className="muted small">
        Each NFT is listed for {price || '0'} ETH and expires after {days}{' '}
        {days === 1 ? 'day' : 'days'}. An expired listing can no longer be
        bought, but the NFT stays in escrow until you cancel, re-list, or
        accept an offer on it.
      </p>
      {wrongNetwork && toList.length > 0 && (
        <WrongNetworkNote action="list NFTs" />
      )}
      {needsApproval && (
        <p className="notice">
          These NFTs are not listed, so the marketplace needs your approval
          to move them into escrow. Approve once for the whole collection,
          then list.
        </p>
      )}
      {needsApproval && (
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
            : '1. Approve marketplace to list these NFTs'}
        </button>
      )}
      {approveError && (
        <p className="error">Approval failed: {errorMessage(approveError)}</p>
      )}
      {approveReceipt.data?.status === 'reverted' && (
        <p className="error">
          Approval failed: the transaction was reverted on-chain. The List
          button stays disabled — try approving again.
        </p>
      )}
      {approveReceipt.data?.status === 'success' && (
        <p className="success-box">Approved — you can list the NFTs now.</p>
      )}
      <button
        className="btn btn-primary btn-block"
        disabled={
          busy ||
          toList.length === 0 ||
          needsApproval ||
          !priceValid ||
          wrongNetwork ||
          !MARKETPLACE_DEPLOYED
        }
        onClick={() => void listAll()}
      >
        {busy
          ? 'Listing…'
          : `List ${toList.length} NFT${toList.length === 1 ? '' : 's'}`}
      </button>
      {error && <p className="error">{error}</p>}
      {results !== null && (
        <div>
          <h3>Results</h3>
          <ul className="sq-list">
            {results.map((r) => (
              <li key={r.tokenId}>
                Token #{r.tokenId} —{' '}
                {r.status === 'listed' ? (
                  <>
                    <strong>listed</strong> for {formatEther(r.priceWei)} ETH
                  </>
                ) : r.status === 'skipped' ? (
                  <>
                    <strong>skipped</strong> — {r.message ?? 'already listed'}
                  </>
                ) : (
                  <>
                    <strong>failed</strong> — {r.message ?? 'unknown error'}
                  </>
                )}
              </li>
            ))}
          </ul>
          {listedCount > 0 && (
            <p className="muted small">
              Listed NFTs leave your Owned tab once the indexer catches up
              (they move into marketplace escrow).
            </p>
          )}
        </div>
      )}
    </div>
  )
}

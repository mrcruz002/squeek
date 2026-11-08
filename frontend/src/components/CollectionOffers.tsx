// Collection offers — form + live list for a collection page (Phase 5).
// A bidder enters a TOTAL in ETH and a quantity (no maximum); the per-item
// price is total / quantity and is shown live as they type. The whole
// total is escrowed up front (msg.value == total). Level selector only
// appears when the collection has levels. All reads come from
// useCollectionOffers (direct chain reads merged with the indexer endpoint
// when it serves rows); writes go through the connected wallet.

import { useState } from 'react'
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { formatEther, parseEther } from 'viem'
import { marketplaceAbi } from '../abi'
import { activeChain } from '../config'
import { MARKETPLACE_ADDRESS, MARKETPLACE_DEPLOYED } from '../marketplace-config'
import type { CollectionOffer } from '../hooks'
import { useWrongNetwork } from '../hooks'
import { errorMessage, formatExpiry, shortenAddress } from '../lib/utils'
import WrongNetworkNote from './WrongNetworkNote'

export function formatLevel(level: bigint | number): string {
  return Number(level) === 0 ? 'Any level' : `Level ${Number(level)}`
}

/** Live per-item price line: "1 ETH for 100 Squeeks = 0.01 ETH each". */
export function perItemLine(
  totalEth: string,
  quantity: number,
  symbol: string,
): string | null {
  let total: bigint
  try {
    total = parseEther(totalEth || '0')
  } catch {
    return null
  }
  if (total <= 0n || quantity < 1) return null
  const perItem = total / BigInt(quantity)
  return `${totalEth} ETH for ${quantity} ${symbol} = ${formatEther(perItem)} ETH each`
}

export function CancelCollectionOfferButton({
  offerId,
  disabled,
}: {
  offerId: bigint
  disabled?: boolean
}) {
  const wrongNetwork = useWrongNetwork()
  const { writeContract, data: hash, isPending, error, reset } =
    useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash })
  const busy = isPending || receipt.isLoading
  return (
    <>
      <button
        className="btn btn-small"
        disabled={disabled || busy || wrongNetwork || !MARKETPLACE_DEPLOYED}
        onClick={() => {
          if (!MARKETPLACE_ADDRESS) return
          reset()
          writeContract({
            address: MARKETPLACE_ADDRESS,
            abi: marketplaceAbi,
            functionName: 'cancelCollectionOffer',
            args: [offerId],
          })
        }}
      >
        {busy ? 'Confirm in wallet…' : 'Cancel offer'}
      </button>
      {receipt.isSuccess && (
        <span className="muted small"> Cancelled — refund on its way.</span>
      )}
      {error && (
        <span className="error small"> {errorMessage(error)}</span>
      )}
    </>
  )
}

export function CollectionOfferForm({
  collection,
  symbol,
  hasLevels,
  levels,
  onPlaced,
}: {
  collection: `0x${string}`
  symbol: string
  hasLevels: boolean
  levels: number[]
  onPlaced: () => void
}) {
  // chainId from useAccount (wallet's actual chain), not useChainId()
  // (the app's configured chain — see useWrongNetwork in hooks.ts).
  const { address, isConnected, chainId } = useAccount()
  const { writeContract, data: hash, isPending, error, reset } =
    useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash })
  const [totalEth, setTotalEth] = useState('1')
  const [quantity, setQuantity] = useState(10)
  const [days, setDays] = useState(7)
  const [level, setLevel] = useState(0)

  const wrongNetwork = isConnected && chainId !== activeChain.id
  const busy = isPending || receipt.isLoading

  let totalWei: bigint | null = null
  try {
    totalWei = parseEther(totalEth || '0')
  } catch {
    totalWei = null
  }
  const valid =
    totalWei !== null &&
    totalWei > 0n &&
    quantity >= 1 &&
    totalWei / BigInt(quantity) > 0n
  const line = perItemLine(totalEth, quantity, symbol)

  function placeOffer() {
    if (!MARKETPLACE_ADDRESS || !valid || totalWei === null) return
    const expiry = BigInt(
      Math.floor(Date.now() / 1000) + days * 24 * 60 * 60,
    )
    reset()
    writeContract({
      address: MARKETPLACE_ADDRESS,
      abi: marketplaceAbi,
      functionName: 'makeCollectionOffer',
      args: [collection, totalWei, BigInt(quantity), BigInt(level), expiry],
      value: totalWei,
    })
  }

  const done = receipt.isSuccess && hash

  return (
    <section className="card">
      <h2>Make a collection offer</h2>
      <p className="muted small">
        Bid on the whole collection at once: your total is locked in the
        marketplace up front, and any owner can sell you one item at the
        per-item price until the quantity is filled. No maximum quantity.
      </p>
      {!MARKETPLACE_DEPLOYED && (
        <p className="notice">
          Collection offers open once the marketplace contract is deployed.
        </p>
      )}
      {MARKETPLACE_DEPLOYED && !isConnected && (
        <p className="notice">Connect your wallet to place an offer.</p>
      )}
      {MARKETPLACE_DEPLOYED && isConnected && wrongNetwork && (
        <WrongNetworkNote action="place an offer" />
      )}
      {MARKETPLACE_DEPLOYED && isConnected && (
        <div className="form">
          <div className="qty-row">
            <label htmlFor="coll-offer-total">Total offer (ETH)</label>
            <input
              id="coll-offer-total"
              type="number"
              min="0"
              step="0.001"
              value={totalEth}
              onChange={(e) => setTotalEth(e.target.value)}
            />
            <label htmlFor="coll-offer-qty">Items</label>
            <input
              id="coll-offer-qty"
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) =>
                setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))
              }
            />
            <label htmlFor="coll-offer-days">Days</label>
            <input
              id="coll-offer-days"
              type="number"
              min="1"
              max="30"
              value={days}
              onChange={(e) =>
                setDays(Math.max(1, Math.min(30, Number(e.target.value) || 7)))
              }
            />
          </div>
          {hasLevels && (
            <div className="qty-row">
              <label htmlFor="coll-offer-level">Level</label>
              <select
                id="coll-offer-level"
                value={level}
                onChange={(e) => setLevel(Number(e.target.value))}
              >
                <option value={0}>Any level</option>
                {levels.map((l) => (
                  <option key={l} value={l}>
                    Level {l} only
                  </option>
                ))}
              </select>
              <span className="muted small">
                A level-filtered offer can only be accepted on tokens at that
                level — the contract checks it on-chain.
              </span>
            </div>
          )}
          {line !== null && (
            <p>
              <strong>{line}</strong>
            </p>
          )}
          {totalWei !== null && totalWei > 0n && totalWei / BigInt(quantity) === 0n && (
            <p className="error small">
              Total too small — the per-item price would be 0 wei.
            </p>
          )}
          <button
            className="btn btn-primary"
            disabled={busy || !valid || wrongNetwork}
            onClick={placeOffer}
          >
            {busy ? 'Confirm in wallet…' : 'Place collection offer'}
          </button>
          {error && (
            <p className="error">Offer failed: {errorMessage(error)}</p>
          )}
          {hash && (
            <p className="small">
              Transaction: <code className="mono">{hash}</code>
            </p>
          )}
          {done && (
            <div className="success-box">
              <p>
                <strong>Offer placed!</strong> Your {totalEth} ETH is escrowed
                until it fills, you cancel, or it expires.
              </p>
              <button
                className="btn"
                onClick={() => {
                  reset()
                  onPlaced()
                }}
              >
                Refresh offers
              </button>
            </div>
          )}
          {address !== undefined && (
            <p className="muted small">
              Offering as <span className="mono">{shortenAddress(address)}</span>
            </p>
          )}
        </div>
      )}
    </section>
  )
}

export function CollectionOfferList({
  offers,
  isLoading,
}: {
  offers: CollectionOffer[]
  isLoading: boolean
}) {
  const { address, isConnected } = useAccount()
  return (
    <section className="card">
      <h2>Collection offers ({offers.length})</h2>
      {isLoading && <p>Loading collection offers…</p>}
      {!isLoading && offers.length === 0 && (
        <p className="muted">
          No live collection offers — be the first to bid on the whole
          collection.
        </p>
      )}
      {offers.length > 0 && (
        <ul className="sq-list">
          {offers.map((o) => {
            const remaining = Number(o.quantity - o.filled)
            const mine =
              isConnected &&
              address !== undefined &&
              address.toLowerCase() === o.bidder.toLowerCase()
            return (
              <li key={o.id.toString()}>
                <strong>{formatEther(o.pricePerItem)} ETH each</strong>{' '}
                <span className="muted small">
                  ({formatEther(o.totalPrice)} ETH total · wants {remaining} of{' '}
                  {o.quantity.toString()} · filled {o.filled.toString()})
                </span>{' '}
                {Number(o.level) > 0 && (
                  <span className="muted small">
                    · {formatLevel(o.level)}
                  </span>
                )}{' '}
                from{' '}
                <span className="mono small">{shortenAddress(o.bidder)}</span>{' '}
                <span className="muted small">
                  · expires {formatExpiry(Number(o.expiry))}
                </span>
                {mine && (
                  <>
                    {' '}
                    <CancelCollectionOfferButton offerId={o.id} />
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="muted small">
        Prices shown are per item — the top bid is the highest per-item
        price, not the biggest total.
      </p>
    </section>
  )
}

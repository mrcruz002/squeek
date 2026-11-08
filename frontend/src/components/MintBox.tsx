import { useState } from 'react'
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { collectionAbi } from '../abi'
import { activeChain } from '../config'
import { formatPrice, saleStatus, errorMessage } from '../lib/utils'
import WrongNetworkNote from './WrongNetworkNote'
import type { CollectionDetails } from '../hooks'

export default function MintBox({
  collection,
  onMinted,
}: {
  collection: CollectionDetails
  onMinted: () => void
}) {
  // chainId from useAccount (wallet's actual chain), not useChainId()
  // (the app's configured chain — see useWrongNetwork in hooks.ts).
  const { address, isConnected, chainId } = useAccount()
  const [quantity, setQuantity] = useState(1)
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash })

  const mintedByQuery = useReadContract({
    address: collection.address,
    abi: collectionAbi,
    functionName: 'mintedBy',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })
  const alreadyMinted =
    typeof mintedByQuery.data === 'bigint' ? mintedByQuery.data : 0n

  const status = saleStatus(collection.saleStart, collection.saleEnd)
  const remaining = collection.maxSupply - collection.totalSupply
  const remainingForWallet = collection.maxPerWallet - alreadyMinted
  const maxQty = Number(
    remainingForWallet < remaining ? remainingForWallet : remaining,
  )
  const clampedQty = Math.max(1, Math.min(quantity, Math.max(1, maxQty)))
  const totalPrice = collection.mintPrice * BigInt(clampedQty)
  const wrongNetwork = isConnected && chainId !== activeChain.id
  const soldOut = remaining <= 0n
  const canMint =
    isConnected &&
    !wrongNetwork &&
    status === 'live' &&
    !soldOut &&
    maxQty > 0 &&
    !isPending &&
    !receipt.isLoading

  // Token IDs are sequential starting at 1, so a successful mint of N tokens
  // starting from the pre-mint supply mints IDs totalSupply+1 … totalSupply+N.
  const newTokenIds =
    receipt.isSuccess && hash
      ? Array.from(
          { length: clampedQty },
          (_, i) => collection.totalSupply + BigInt(i + 1),
        )
      : []

  function mint() {
    reset()
    writeContract({
      address: collection.address,
      abi: collectionAbi,
      functionName: 'mint',
      args: [BigInt(clampedQty)],
      value: totalPrice,
    })
  }

  return (
    <section className="card mint-box">
      <h2>Mint</h2>
      {status !== 'live' && (
        <p className="notice">
          {status === 'not-started'
            ? 'Sale has not started yet.'
            : 'Sale has ended.'}
        </p>
      )}
      {soldOut && <p className="notice">Sold out.</p>}
      {!isConnected && (
        <p className="notice">Connect your wallet to mint.</p>
      )}
      {isConnected && wrongNetwork && (
        <WrongNetworkNote action="mint" />
      )}
      {isConnected && !wrongNetwork && maxQty <= 0 && !soldOut && status === 'live' && (
        <p className="notice">
          You have already minted your full per-wallet allowance (
          {alreadyMinted.toString()} / {collection.maxPerWallet.toString()}).
        </p>
      )}

      <div className="qty-row">
        <label htmlFor="qty">Quantity</label>
        <button
          className="btn btn-small"
          disabled={clampedQty <= 1}
          onClick={() => setQuantity(clampedQty - 1)}
        >
          −
        </button>
        <input
          id="qty"
          type="number"
          min={1}
          max={Math.max(1, maxQty)}
          value={clampedQty}
          onChange={(e) =>
            setQuantity(
              Math.max(1, Math.min(Number(e.target.value) || 1, Math.max(1, maxQty))),
            )
          }
        />
        <button
          className="btn btn-small"
          disabled={clampedQty >= maxQty}
          onClick={() => setQuantity(clampedQty + 1)}
        >
          +
        </button>
        <span className="muted">
          max {Math.max(0, maxQty)} for you · {remaining.toString()} left
        </span>
      </div>

      <p className="total">
        Total: <strong>{formatPrice(totalPrice)}</strong>
        {collection.mintPrice > 0n && (
          <span className="muted">
            {' '}
            ({formatPrice(collection.mintPrice)} × {clampedQty})
          </span>
        )}
      </p>
      <p className="muted small">
        Exact payment required — underpaying or overpaying reverts. You have
        minted {alreadyMinted.toString()} / {collection.maxPerWallet.toString()}{' '}
        (per-wallet cap).
      </p>

      <button className="btn btn-primary btn-block" disabled={!canMint} onClick={mint}>
        {isPending
          ? 'Confirm in wallet…'
          : receipt.isLoading
            ? 'Minting… waiting for confirmation'
            : `Mint ${clampedQty} token${clampedQty > 1 ? 's' : ''}`}
      </button>

      {error && <p className="error">Mint failed: {errorMessage(error)}</p>}

      {hash && (
        <p className="small">
          Transaction:{' '}
          <code className="mono">{hash}</code>
        </p>
      )}

      {receipt.isSuccess && (
        <div className="success-box">
          <p>
            <strong>Mint confirmed!</strong>
          </p>
          {newTokenIds.length > 0 && (
            <p>
              Your new token{newTokenIds.length > 1 ? 's' : ''}:{' '}
              {newTokenIds.map((id, i) => (
                <span key={id.toString()}>
                  {i > 0 && ', '}
                  <a href={`#/collection/${collection.address}/token/${id}`}>
                    #{id.toString()}
                  </a>
                </span>
              ))}
            </p>
          )}
          <button
            className="btn"
            onClick={() => {
              reset()
              onMinted()
            }}
          >
            Mint more / refresh
          </button>
        </div>
      )}
    </section>
  )
}

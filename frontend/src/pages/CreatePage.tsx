import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { decodeEventLog, parseEther } from 'viem'
import { factoryAbi } from '../abi'
import { FACTORY_ADDRESS, activeChain } from '../config'
import {
  datetimeLocalToUnix,
  errorMessage,
  unixToDatetimeLocal,
} from '../lib/utils'
import WrongNetworkNote from '../components/WrongNetworkNote'

const DEFAULT_BASE_URI = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/'

export default function CreatePage() {
  // chainId from useAccount (wallet's actual chain), not useChainId()
  // (the app's configured chain — see useWrongNetwork in hooks.ts).
  const { address, isConnected, chainId } = useAccount()
  const now = Math.floor(Date.now() / 1000)

  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [maxSupply, setMaxSupply] = useState('100')
  const [priceEth, setPriceEth] = useState('0.01')
  const [maxPerWallet, setMaxPerWallet] = useState('3')
  const [saleStart, setSaleStart] = useState(
    unixToDatetimeLocal(now + 60),
  )
  const [saleEnd, setSaleEnd] = useState(unixToDatetimeLocal(now + 7 * 86400))
  const [baseUri, setBaseUri] = useState(DEFAULT_BASE_URI)
  const [royaltyPct, setRoyaltyPct] = useState('5')
  const [formError, setFormError] = useState<string | null>(null)

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash })

  // The new collection address comes from the CollectionCreated event log.
  let newCollection: `0x${string}` | undefined
  if (receipt.isSuccess && receipt.data) {
    for (const log of receipt.data.logs) {
      try {
        const decoded = decodeEventLog({
          abi: factoryAbi,
          data: log.data,
          topics: log.topics,
        })
        if (decoded.eventName === 'CollectionCreated') {
          const args = decoded.args as { collection?: `0x${string}` }
          newCollection = args.collection
        }
      } catch {
        // Not a CollectionCreated log — ignore.
      }
    }
  }

  const wrongNetwork = isConnected && chainId !== activeChain.id

  function submit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    reset()
    if (!address) {
      setFormError('Connect your wallet first.')
      return
    }
    const start = datetimeLocalToUnix(saleStart)
    const end = datetimeLocalToUnix(saleEnd)
    if (!name.trim() || !symbol.trim()) {
      setFormError('Name and symbol are required.')
      return
    }
    const supply = Number(maxSupply)
    const perWallet = Number(maxPerWallet)
    const royalty = Number(royaltyPct)
    if (!Number.isInteger(supply) || supply <= 0) {
      setFormError('Max supply must be a positive whole number.')
      return
    }
    if (!Number.isInteger(perWallet) || perWallet <= 0 || perWallet > supply) {
      setFormError('Max per wallet must be a positive whole number no larger than max supply.')
      return
    }
    if (start >= end) {
      setFormError('Sale end must be after sale start.')
      return
    }
    if (royalty < 0 || royalty > 10) {
      setFormError('Royalty must be between 0% and 10%.')
      return
    }
    let price: bigint
    try {
      price = parseEther(priceEth || '0')
    } catch {
      setFormError('Mint price is not a valid ETH amount.')
      return
    }
    if (price < 0n) {
      setFormError('Mint price cannot be negative.')
      return
    }

    writeContract({
      address: FACTORY_ADDRESS,
      abi: factoryAbi,
      functionName: 'createCollection',
      args: [
        {
          creator: address,
          name: name.trim(),
          symbol: symbol.trim().toUpperCase(),
          baseURI: baseUri.trim(),
          maxSupply: BigInt(supply),
          mintPrice: price,
          maxPerWallet: BigInt(perWallet),
          saleStart: BigInt(start),
          saleEnd: BigInt(end),
          royaltyReceiver: address,
          royaltyBps: BigInt(Math.round(royalty * 100)),
        },
      ],
    })
  }

  return (
    <div className="narrow">
      <h1>Create a collection</h1>
      <p className="muted">
        This deploys a new ERC-721 collection (an EIP-1167 clone) through the
        factory. You are the creator and royalty receiver. Price, supply,
        per-wallet cap and sale window cannot be changed after creation; the
        base URI can only be changed before the sale starts.
      </p>

      {!isConnected && (
        <p className="notice">Connect your wallet to create a collection.</p>
      )}
      {isConnected && wrongNetwork && (
        <WrongNetworkNote action="create a collection" />
      )}

      <form className="card form" onSubmit={submit}>
        <label>
          Collection name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Demo Squeeks"
            required
          />
        </label>
        <label>
          Symbol
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="e.g. DSQK"
            required
          />
        </label>
        <label>
          Max supply
          <input
            type="number"
            min={1}
            value={maxSupply}
            onChange={(e) => setMaxSupply(e.target.value)}
            required
          />
        </label>
        <label>
          Mint price (ETH)
          <input
            type="text"
            inputMode="decimal"
            value={priceEth}
            onChange={(e) => setPriceEth(e.target.value)}
            required
          />
        </label>
        <label>
          Max mints per wallet
          <input
            type="number"
            min={1}
            value={maxPerWallet}
            onChange={(e) => setMaxPerWallet(e.target.value)}
            required
          />
        </label>
        <label>
          Sale start
          <input
            type="datetime-local"
            value={saleStart}
            onChange={(e) => setSaleStart(e.target.value)}
            required
          />
        </label>
        <label>
          Sale end
          <input
            type="datetime-local"
            value={saleEnd}
            onChange={(e) => setSaleEnd(e.target.value)}
            required
          />
        </label>
        <label>
          Base URI
          <input
            type="text"
            value={baseUri}
            onChange={(e) => setBaseUri(e.target.value)}
            placeholder="ipfs://…/ or https://…/"
          />
          <span className="muted small">
            tokenURI(tokenId) = base URI + token ID. Leave as-is for a test
            collection, or point it at your own metadata folder.
          </span>
        </label>
        <label>
          Royalty % (ERC-2981, 0–10, default 5)
          <input
            type="number"
            min={0}
            max={10}
            step={0.1}
            value={royaltyPct}
            onChange={(e) => setRoyaltyPct(e.target.value)}
            required
          />
        </label>

        {formError && <p className="error">{formError}</p>}
        {error && <p className="error">Create failed: {errorMessage(error)}</p>}

        <button
          className="btn btn-primary btn-block"
          type="submit"
          disabled={!isConnected || wrongNetwork || isPending || receipt.isLoading}
        >
          {isPending
            ? 'Confirm in wallet…'
            : receipt.isLoading
              ? 'Creating… waiting for confirmation'
              : 'Create collection'}
        </button>
      </form>

      {hash && (
        <p className="small">
          Transaction: <code className="mono">{hash}</code>
        </p>
      )}

      {receipt.isSuccess && (
        <div className="success-box">
          <p>
            <strong>Collection created!</strong>
          </p>
          {newCollection ? (
            <p>
              Address:{' '}
              <code className="mono">{newCollection}</code>{' '}
              <a href={`#/collection/${newCollection}`}>View collection →</a>
            </p>
          ) : (
            <p>
              Confirmed, but the new address could not be read from the
              transaction logs — check the{' '}
              <a href="#/">browse page</a> (refresh) for your new collection.
            </p>
          )}
          <button
            className="btn"
            onClick={() => {
              reset()
              setName('')
              setSymbol('')
            }}
          >
            Create another
          </button>
        </div>
      )}
    </div>
  )
}

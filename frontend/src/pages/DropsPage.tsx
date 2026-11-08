import { useEffect, useState } from 'react'
import { useCollectionAddresses, useDropSummaries } from '../hooks'
import { errorMessage, saleStatus } from '../lib/utils'
import DropCard from '../components/DropCard'

/** Ticking "now" (unix seconds), refreshed so countdowns move. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      intervalMs,
    )
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export default function DropsPage() {
  const { addresses, isLoading, isError, error, refetch } =
    useCollectionAddresses()
  const drops = useDropSummaries(addresses)
  const now = useNow()

  const live = drops.summaries.filter(
    (d) => saleStatus(d.saleStart, d.saleEnd, now) === 'live',
  )
  const coming = drops.summaries.filter(
    (d) => saleStatus(d.saleStart, d.saleEnd, now) === 'not-started',
  )
  const ended = drops.summaries.filter(
    (d) => saleStatus(d.saleStart, d.saleEnd, now) === 'ended',
  )

  return (
    <div>
      <h1>Drops</h1>
      <p>
        Live and upcoming mints from collections launched on this factory.
        Everything here is on a test network, no real money.
      </p>
      <p>
        <button className="btn" onClick={refetch}>
          Refresh
        </button>
      </p>

      {isLoading && <p>Loading drops…</p>}
      {isError && (
        <p className="error">
          Could not load drops: {errorMessage(error)}. Check that the factory
          address is correct and the RPC is reachable.
        </p>
      )}

      {!isLoading && !isError && addresses.length === 0 && (
        <div className="card empty">
          <p>
            <strong>No live drops yet.</strong>
          </p>
          <p>
            Nobody has launched a collection through this factory. Be the
            first — <a href="#/create">create one</a>.
          </p>
        </div>
      )}

      {drops.isLoading && addresses.length > 0 && (
        <p>Loading drop details…</p>
      )}
      {drops.isError && (
        <p className="error">
          Could not load drop details: {errorMessage(drops.error)}
        </p>
      )}

      {addresses.length > 0 && (
        <>
          <h2>Live now</h2>
          {live.length === 0 && !drops.isLoading && (
            <div className="card empty">
              <p>
                <strong>No live drops yet.</strong>
              </p>
              <p>
                Nothing is minting right now — check the coming-soon drops
                below, or <a href="#/create">launch your own</a>.
              </p>
            </div>
          )}
          <div className="grid">
            {live.map((d) => (
              <DropCard key={d.address} summary={d} nowSeconds={now} />
            ))}
          </div>

          <h2>Coming soon</h2>
          {coming.length === 0 && !drops.isLoading && (
            <div className="card empty">
              <p>
                <strong>No drops scheduled yet.</strong>
              </p>
              <p>
                No collection has a future sale start set. When a creator
                launches with a later start time, it shows up here.
              </p>
            </div>
          )}
          <div className="grid">
            {coming.map((d) => (
              <DropCard key={d.address} summary={d} nowSeconds={now} />
            ))}
          </div>

          {ended.length > 0 && (
            <p className="muted small">
              Ended: {ended.map((d) => d.name).join(', ')}.
            </p>
          )}
        </>
      )}
    </div>
  )
}

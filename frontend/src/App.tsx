import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { wagmiConfig, NETWORK_LABEL, USE_LOCAL, ACTIVE_RPC_URL, FACTORY_ADDRESS } from './config'
import ConnectButton from './components/ConnectButton'
import HomePage from './pages/HomePage'
import DropsPage from './pages/DropsPage'
import CreatePage from './pages/CreatePage'
import DashboardPage from './pages/DashboardPage'
import CollectionPage from './pages/CollectionPage'
import TokenPage from './pages/TokenPage'

const queryClient = new QueryClient()

type Route =
  | { page: 'home' }
  | { page: 'drops' }
  | { page: 'create' }
  | { page: 'dashboard' }
  | { page: 'collection'; address: string }
  | { page: 'token'; address: string; tokenId: string; scrollToTrade?: boolean }
  | { page: 'not-found' }

function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  // A "#trade" fragment deep-links to a token's trade box (Make offer from
  // a collection grid card). It is not part of the route path — strip it
  // before matching, or the tokenId would come out as "68#trade".
  const scrollToTrade = raw.endsWith('#trade')
  const path = raw.replace(/#trade$/, '').replace(/\/$/, '') || '/'
  if (path === '/') return { page: 'home' }
  if (path === '/drops') return { page: 'drops' }
  if (path === '/create') return { page: 'create' }
  if (path === '/dashboard') return { page: 'dashboard' }
  const tokenMatch = path.match(/^\/collection\/([^/]+)\/token\/([^/]+)$/)
  if (tokenMatch) {
    return {
      page: 'token',
      address: tokenMatch[1],
      tokenId: tokenMatch[2],
      scrollToTrade,
    }
  }
  const collectionMatch = path.match(/^\/collection\/([^/]+)$/)
  if (collectionMatch) {
    return { page: 'collection', address: collectionMatch[1] }
  }
  return { page: 'not-found' }
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHash(window.location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <div className="app">
          <div className="test-banner" role="note">
            ■ {NETWORK_LABEL} — test ETH only, no real money. Squeekchain
            mainnet does not exist yet.
          </div>
          <header className="header">
            <a className="brand" href="#/">
              <img
                className="brand-hamster"
                src="/hamster.jpg"
                alt="Squeekchain hamster"
              />
              <span className="dot-square" aria-hidden="true" />
              <span className="brand-word">
                Squeekchain <em>Launchpad</em>
              </span>
            </a>
            <nav>
              <a href="#/" className={route.page === 'home' ? 'active' : ''}>
                Marketplace
              </a>
              <a
                href="#/drops"
                className={route.page === 'drops' ? 'active' : ''}
              >
                Drops
              </a>
              <a
                href="#/create"
                className={route.page === 'create' ? 'active' : ''}
              >
                Create
              </a>
              <a
                href="#/dashboard"
                className={route.page === 'dashboard' ? 'active' : ''}
              >
                Dashboard
              </a>
            </nav>
            <ConnectButton />
          </header>
          <main className="main">
            {route.page === 'home' && <HomePage />}
            {route.page === 'drops' && <DropsPage />}
            {route.page === 'create' && <CreatePage />}
            {route.page === 'dashboard' && <DashboardPage />}
            {route.page === 'collection' && (
              <CollectionPage address={route.address} />
            )}
            {route.page === 'token' && (
              <TokenPage
                collection={route.address}
                tokenId={route.tokenId}
                scrollToTrade={route.scrollToTrade}
              />
            )}
            {route.page === 'not-found' && (
              <div className="card">
                <h1>Page not found</h1>
                <p>
                  <a href="#/">← Back to marketplace</a>
                </p>
              </div>
            )}
          </main>
          <footer className="footer">
            <img
              className="footer-hamster"
              src="/hamster.jpg"
              alt="Squeekchain hamster"
            />
            <p className="footer-tagline">Powered by one hamster.</p>
            <p className="muted small">
              Squeekchain NFT Launchpad (Phase 0–1 MVP) ·{' '}
              {USE_LOCAL ? 'Local anvil' : 'Sepolia'} · RPC{' '}
              <code className="mono">{ACTIVE_RPC_URL}</code> · Factory{' '}
              <code className="mono">{FACTORY_ADDRESS}</code>
            </p>
            <p className="muted small">
              Testnet only. Contracts are unaudited; never send real funds.
            </p>
          </footer>
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

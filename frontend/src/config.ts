import { http, createConfig } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'
import { defineChain } from 'viem'

// ---------------------------------------------------------------------------
// Network config
//
// Target network is Sepolia (chain ID 11155111) — Squeekchain runs on Sepolia
// testnet for now; Squeekchain mainnet does not exist yet.
//
// The local anvil used for dev testing ALSO runs with chain ID 11155111, so
// wagmi cannot hold Sepolia and anvil as two chains at once (its chain map is
// keyed by chain ID). Instead, one chain is active at a time, selected by
// VITE_NETWORK=local|sepolia (default: sepolia). Both chain definitions are
// exported below so the switch is explicit.
// ---------------------------------------------------------------------------

export const SEPOLIA_RPC_URL =
  import.meta.env.VITE_SEPOLIA_RPC_URL ??
  'https://ethereum-sepolia-rpc.publicnode.com'

export const LOCAL_RPC_URL =
  import.meta.env.VITE_LOCAL_RPC_URL ?? 'http://127.0.0.1:8545'

/** Local anvil chain entry for dev testing (same chain ID as Sepolia). */
export const anvilChain = defineChain({
  id: 11155111,
  name: 'Anvil Local (Sepolia chain ID)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [LOCAL_RPC_URL] } },
  blockExplorers: { default: { name: 'Local', url: 'http://127.0.0.1:8545' } },
  testnet: true,
})

export const USE_LOCAL = import.meta.env.VITE_NETWORK === 'local'

/** The chain wagmi is currently configured for. */
export const activeChain = USE_LOCAL ? anvilChain : sepolia

export const ACTIVE_RPC_URL = USE_LOCAL ? LOCAL_RPC_URL : SEPOLIA_RPC_URL

// ---------------------------------------------------------------------------
// Factory address
// ---------------------------------------------------------------------------

// LOCAL-TEST ONLY default: factory deployed on the local anvil smoke test.
// This is an anvil test address — never hardcode it as the Sepolia factory
// address. Set VITE_FACTORY_ADDRESS to the real Sepolia factory once one is
// deployed (see frontend/README.md).
export const ANVIL_FACTORY_ADDRESS =
  '0x5FbDB2315678afecb367f032d93F642f64180aa3' as const

export const FACTORY_ADDRESS = (import.meta.env.VITE_FACTORY_ADDRESS ??
  ANVIL_FACTORY_ADDRESS) as `0x${string}`

// ---------------------------------------------------------------------------
// wagmi config — injected wallet only (MetaMask / Rabby / OKX). No
// WalletConnect project ID is bundled; add one later if needed.
// ---------------------------------------------------------------------------

export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors: [injected()],
  transports: {
    [activeChain.id]: http(ACTIVE_RPC_URL),
  },
})

export const NETWORK_LABEL = USE_LOCAL
  ? 'TEST NETWORK — Local Anvil (Sepolia chain ID 11155111)'
  : 'TEST NETWORK — Sepolia (chain ID 11155111)'

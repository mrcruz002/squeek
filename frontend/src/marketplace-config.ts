// Marketplace config — separate from config.ts so the launchpad's factory
// and network wiring stays untouched.
//
// VITE_MARKETPLACE_ADDRESS: the deployed SqueekMarketplace contract on Sepolia.
// Empty until the marketplace is deployed (see marketplace-deploy/). When it
// is not set, listing / buying / offering is disabled in the UI and the site
// is read-only for trading.
//
// VITE_INDEXER_URL: the marketplace indexer API (see indexer/). Default is a
// local indexer on port 3001. When it is unreachable, the site falls back to
// direct chain reads for launchpad collections and shows an indexer-offline
// note for holders / levels / floors.

export const MARKETPLACE_ADDRESS = (
  import.meta.env.VITE_MARKETPLACE_ADDRESS as string | undefined
)?.toLowerCase() as `0x${string}` | undefined

export const MARKETPLACE_DEPLOYED = Boolean(
  MARKETPLACE_ADDRESS && MARKETPLACE_ADDRESS !== '0x',
)

export const INDEXER_URL =
  (import.meta.env.VITE_INDEXER_URL as string | undefined) ??
  'http://localhost:3001'

// Verified-collections registry — see verified-deploy/ (VerifiedRegistry).
// VITE_VERIFIED_REGISTRY_ADDRESS: the deployed registry on Sepolia. Empty
// until it is deployed. When it is not set, no collection shows a verified
// badge and no registry read is made; the badge appears only for collections
// the registry owner has marked verified.
export const VERIFIED_REGISTRY_ADDRESS = (
  import.meta.env.VITE_VERIFIED_REGISTRY_ADDRESS as string | undefined
)?.toLowerCase() as `0x${string}` | undefined

export const VERIFIED_REGISTRY_DEPLOYED = Boolean(
  VERIFIED_REGISTRY_ADDRESS && VERIFIED_REGISTRY_ADDRESS !== '0x',
)

/** The Squeek collection — the only collection with levels (from Merge events). */
export const SQUEEK_COLLECTION =
  '0xc4c7982657f00509548f3a3a41db7fa439a6856b' as const

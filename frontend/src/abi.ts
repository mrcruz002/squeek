import type { Abi } from 'viem'
// ABIs are vendored in frontend/abi (copied from the single source of truth
// in ../abi, exported from the Foundry project). They live inside the
// frontend folder so the site builds standalone — hosts like Railway and
// Vercel only upload the frontend folder, so imports from ../../abi
// break the build there. They are NOT hand-written here — only cast to
// viem's Abi type so wagmi/viem accept them. If the contracts change,
// re-copy the JSONs from ../abi into frontend/abi.
import factoryJson from '../abi/CollectionFactory.json'
import collectionJson from '../abi/SqueekCollection.json'
import marketplaceJson from '../abi/SqueekMarketplace.json'
import verifiedRegistryJson from '../abi/VerifiedRegistry.json'

export const factoryAbi = factoryJson as unknown as Abi
export const collectionAbi = collectionJson as unknown as Abi
export const marketplaceAbi = marketplaceJson as unknown as Abi
export const verifiedRegistryAbi = verifiedRegistryJson as unknown as Abi

import { useVerified } from '../hooks'

/**
 * Blue checkmark shown next to a collection name when the on-chain
 * VerifiedRegistry says the collection is verified. Renders nothing when
 * the registry is not configured or the collection is not verified — so an
 * unconfigured registry never shows an error, just no badge.
 */
export default function VerifiedBadge({
  collection,
}: {
  collection: `0x${string}`
}) {
  const { verified } = useVerified(collection)
  if (!verified) return null
  return (
    <span className="verified-badge" title="Verified collection">
      ✓
    </span>
  )
}

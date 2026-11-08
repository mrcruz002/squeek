// WrongNetworkNote — the one line shown next to disabled write buttons
// when the wallet is on the wrong chain. It points at the header's
// "Switch to Sepolia testnet" button, which is the way back to safety.
import { USE_LOCAL } from '../config'

const NETWORK_NAME = USE_LOCAL
  ? 'Anvil (Sepolia chain ID)'
  : 'Sepolia testnet'

export default function WrongNetworkNote({ action }: { action: string }) {
  return (
    <p className="error">
      Wrong network — use the “Switch to {NETWORK_NAME}” button at the top
      of the page to {action}.
    </p>
  )
}

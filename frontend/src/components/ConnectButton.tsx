// ConnectButton — wallet connect / disconnect plus the network safety
// control. When the wallet is on the WRONG chain, a prominent
// "Switch to Sepolia testnet" button sits in the header; clicking it asks
// the wallet to switch (and to add Sepolia first if it is not configured
// there — wagmi handles the add prompt). If the automatic switch fails,
// the manual add-network details appear inline under the header so the
// user can add Sepolia by hand. When the wallet IS on Sepolia, a small
// "Sepolia ✓" pill shows in the same spot instead. When no wallet is
// connected, nothing extra shows — the Connect button covers it.
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { activeChain, SEPOLIA_RPC_URL, USE_LOCAL } from '../config'
import { shortenAddress } from '../lib/utils'

const NETWORK_NAME = USE_LOCAL
  ? 'Anvil (Sepolia chain ID)'
  : 'Sepolia testnet'
const NETWORK_SHORT = USE_LOCAL ? 'Anvil' : 'Sepolia'

export default function ConnectButton() {
  // chainId comes from useAccount (the wallet's actual chain), NOT
  // useChainId(): wagmi's useChainId() returns the app's configured chain
  // and does not follow a wallet on an unconfigured chain (e.g. mainnet),
  // which would hide this switch button exactly when it is needed most.
  const { address, isConnected, chainId } = useAccount()
  const { connect, connectors, isPending, error } = useConnect()
  const { disconnect } = useDisconnect()
  const {
    switchChain,
    isPending: isSwitching,
    error: switchError,
  } = useSwitchChain()

  const wrongNetwork = isConnected && chainId !== activeChain.id

  if (!isConnected) {
    return (
      <div className="connect">
        {connectors.map((connector) => (
          <button
            key={connector.id}
            className="btn btn-primary"
            disabled={isPending}
            onClick={() => connect({ connector })}
          >
            {isPending ? 'Connecting…' : `Connect ${connector.name}`}
          </button>
        ))}
        {error && <p className="error">Could not connect: {error.message.split('\n')[0]}</p>}
      </div>
    )
  }

  return (
    <div className="connect">
      {wrongNetwork ? (
        <button
          className="btn btn-switch"
          disabled={isSwitching}
          onClick={() => switchChain({ chainId: activeChain.id })}
        >
          {isSwitching ? 'Switching…' : `Switch to ${NETWORK_NAME}`}
        </button>
      ) : (
        <span
          className="status status-live"
          title={`Connected to ${activeChain.name} (chain ID ${activeChain.id}) — test ETH only`}
        >
          {NETWORK_SHORT} ✓
        </span>
      )}
      <span className="address-pill" title={address}>
        {address ? shortenAddress(address) : 'Connected'}
      </span>
      <button className="btn" onClick={() => disconnect()}>
        Disconnect
      </button>
      {wrongNetwork && switchError && (
        <div className="network-add">
          <p>
            Could not switch automatically:{' '}
            {switchError.message.split('\n')[0]}
          </p>
          <p>Add the network manually in your wallet, then switch to it:</p>
          <ul>
            <li>Network name: Sepolia</li>
            <li>Chain ID: 11155111</li>
            <li>RPC URL: {SEPOLIA_RPC_URL}</li>
            <li>Currency symbol: ETH</li>
            <li>Block explorer: https://sepolia.etherscan.io</li>
          </ul>
        </div>
      )}
    </div>
  )
}

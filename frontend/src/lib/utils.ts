import { formatEther } from 'viem'

export function shortenAddress(address: string): string {
  if (address.length < 10) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function formatPrice(wei: bigint): string {
  return `${formatEther(wei)} ETH`
}

export function formatDate(unixSeconds: bigint | number): string {
  const ms = Number(unixSeconds) * 1000
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString()
}

export type SaleStatus = 'not-started' | 'live' | 'ended'

export function saleStatus(
  saleStart: bigint,
  saleEnd: bigint,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SaleStatus {
  if (nowSeconds < Number(saleStart)) return 'not-started'
  if (nowSeconds > Number(saleEnd)) return 'ended'
  return 'live'
}

export const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  'not-started': 'Not started',
  live: 'Live',
  ended: 'Ended',
}

/** Convert an ipfs:// URI to a public gateway URL; leave http(s) alone. */
export function resolveUri(uri: string): string {
  if (uri.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${uri.slice('ipfs://'.length)}`
  }
  return uri
}

/** True when a tokenURI is fetchable as JSON metadata. */
export function isFetchableMetadataUri(uri: string): boolean {
  return (
    uri.startsWith('http://') ||
    uri.startsWith('https://') ||
    uri.startsWith('ipfs://')
  )
}

/** datetime-local input value (e.g. "2026-11-06T12:00") -> unix seconds. */
export function datetimeLocalToUnix(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000)
}

/** Unix seconds -> datetime-local input value in the browser's timezone. */
export function unixToDatetimeLocal(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Human "2d 4h 12m" / "3h 5m" / "12m" duration for countdowns. */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0m'
  const totalMins = Math.floor(ms / 60000)
  const days = Math.floor(totalMins / 1440)
  const hours = Math.floor((totalMins % 1440) / 60)
  const mins = totalMins % 60
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

/** Human "in 2d" / "in 3h" / "expired" for an offer expiry (unix seconds). */
export function formatExpiry(expirySec: number): string {
  const ms = expirySec * 1000 - Date.now()
  if (ms <= 0) return 'expired'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `in ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `in ${hours}h`
  return `in ${Math.floor(hours / 24)}d`
}

/** Short human-readable error from a wagmi/viem error. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    // viem errors carry a short message before the details block.
    const short = err.message.split('\n')[0]
    return short.length > 300 ? short.slice(0, 300) + '…' : short
  }
  return String(err)
}

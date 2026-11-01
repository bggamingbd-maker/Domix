import { FlaskConical } from 'lucide-react'
import { ARC_MAINNET_ID } from '@/config'
import { useNetwork } from '@/lib/network'

/** Slim bar shown only on Arc Testnet, so nobody mistakes test USDC for real money. Nothing is shown on Mainnet. */
export function NetworkNotice() {
  const { isMainnet, setChainId } = useNetwork()
  if (isMainnet) return null
  return (
    <div className="relative z-20 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-[rgba(34,211,238,0.25)] bg-[rgba(34,211,238,0.06)] px-4 py-2 text-center text-xs text-[var(--cyan)]">
      <span className="inline-flex items-center gap-1.5">
        <FlaskConical size={13} aria-hidden="true" /> Arc Testnet: test USDC with no real value.
      </span>
      <button onClick={() => setChainId(ARC_MAINNET_ID)} className="underline underline-offset-2 hover:text-[var(--text)]">
        Switch to Mainnet
      </button>
    </div>
  )
}

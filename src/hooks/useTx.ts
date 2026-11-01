import { createElement, useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { encodeFunctionData, erc20Abi, type Abi, type Address, type Hex } from 'viem'
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from 'wagmi'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { registrarAbi } from '@/lib/protocol'
import { useNetwork } from '@/lib/network'
import { fireConfetti } from '@/components/fx/Confetti'

export interface TxRequest {
  to: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
}

export type TxStatus = 'idle' | 'signing' | 'confirming' | 'success' | 'error'

export interface TxState {
  status: TxStatus
  label?: string
  hash?: Hex
  error?: string
}

export function parseTxError(error: unknown): string | undefined {
  const e = error as { code?: number; shortMessage?: string; message?: string; cause?: { code?: number; reason?: string } }
  const message = (e?.shortMessage ?? e?.message ?? '').toLowerCase()
  if (e?.code === 4001 || e?.cause?.code === 4001 || message.includes('user rejected') || message.includes('user denied')) {
    return undefined // cancelled by the user: not an error
  }
  if (message.includes('insufficient funds')) return 'Insufficient balance for gas or payment.'
  if (message.includes('exceeds balance') || message.includes('transfer amount exceeds')) return 'Insufficient USDC balance.'
  if (e?.cause?.reason) return e.cause.reason
  const reverted = /reverted with (?:the following reason|custom error)[:\s]*(.+)/i.exec(e?.shortMessage ?? '')
  if (reverted) return `Transaction would fail: ${reverted[1].slice(0, 140)}`
  if (message.includes('network') || message.includes('timeout')) return 'Network issue. Check your connection and retry.'
  return (e?.shortMessage ?? 'Transaction failed.').slice(0, 200)
}

/** Sends transactions on the selected DOMIX network: switches chain, signs, waits for the receipt, links the explorer. */
export function useTx() {
  const { chainId: network } = useNetwork()
  const { address, chainId: walletChain } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { sendTransactionAsync } = useSendTransaction()
  const client = usePublicClient({ chainId: network })
  const queryClient = useQueryClient()
  const [state, setState] = useState<TxState>({ status: 'idle' })

  const reset = useCallback(() => setState({ status: 'idle' }), [])

  const run = useCallback(
    async (label: string, request: TxRequest): Promise<Hex | undefined> => {
      if (!address) {
        toast.error('Connect your wallet first.')
        return undefined
      }
      if (!client) return undefined
      try {
        if (walletChain !== network) {
          setState({ status: 'signing', label: 'Switching network' })
          await switchChainAsync({ chainId: network })
        }
        setState({ status: 'signing', label })
        const data = encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args })
        const hash = await sendTransactionAsync({ to: request.to, data, chainId: network })
        setState({ status: 'confirming', label, hash })
        const receipt = await client.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('Transaction reverted onchain.')
        setState({ status: 'success', label, hash })
        toast.success(label, {
          description: 'Confirmed onchain.',
          action: createElement('a', { href: buildTxExplorerUrl(network, hash), target: '_blank', rel: 'noopener noreferrer' }, 'View'),
        })
        if (!/^(Approve|Commit)/i.test(label)) fireConfetti()
        await queryClient.invalidateQueries()
        return hash
      } catch (error) {
        const message = parseTxError(error)
        if (message === undefined) setState({ status: 'idle' })
        else {
          setState({ status: 'error', label, error: message })
          toast.error(message)
        }
        return undefined
      }
    },
    [address, client, network, queryClient, sendTransactionAsync, switchChainAsync, walletChain],
  )

  /** Approves exactly `amount` USDC for `spender` unless the allowance already covers it. Returns false if cancelled. */
  const ensureUsdcAllowance = useCallback(
    async (usdc: Address, spender: Address, amount: bigint): Promise<boolean> => {
      if (!address || !client) return false
      const allowance = await client.readContract({ address: usdc, abi: erc20Abi, functionName: 'allowance', args: [address, spender] })
      if (allowance >= amount) return true
      const hash = await run('Approve USDC', { to: usdc, abi: erc20Abi, functionName: 'approve', args: [spender, amount] })
      return Boolean(hash)
    },
    [address, client, run],
  )

  /** Approves one domain for `operator` unless it is already approved. Returns false if cancelled. */
  const ensureDomainApproval = useCallback(
    async (collection: Address, tokenId: bigint, operator: Address): Promise<boolean> => {
      if (!address || !client) return false
      const [approved, all] = await Promise.all([
        client.readContract({ address: collection, abi: registrarAbi, functionName: 'getApproved', args: [tokenId] }),
        client.readContract({ address: collection, abi: registrarAbi, functionName: 'isApprovedForAll', args: [address, operator] }),
      ])
      if (all || approved.toLowerCase() === operator.toLowerCase()) return true
      const hash = await run('Approve domain transfer', { to: collection, abi: registrarAbi, functionName: 'approve', args: [operator, tokenId] })
      return Boolean(hash)
    },
    [address, client, run],
  )

  return { state, run, reset, ensureUsdcAllowance, ensureDomainApproval, busy: state.status === 'signing' || state.status === 'confirming' }
}

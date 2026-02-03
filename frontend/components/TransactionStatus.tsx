'use client'

import { useState, useEffect } from 'react'
import { Address } from 'viem'

interface TransactionStatusProps {
  transactionId: string | null
  userAddress: Address
}

interface TransactionState {
  transaction_id: string
  status: 'pending' | 'completed' | 'failed'
  current_step: string
  source_chain: string
  destination_chain: string
  from_token_symbol: string
  to_token_symbol: string
  from_amount: string
  to_amount: string
  swap_tx_hash?: string
  bridge_tx_hash?: string
  deposit_tx_hash?: string
  error_message?: string
  lifi_status?: string
  created_at: string
  updated_at: string
}

export function TransactionStatus({ transactionId, userAddress }: TransactionStatusProps) {
  const [state, setState] = useState<TransactionState | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!transactionId) {
      setState(null)
      return
    }

    const fetchStatus = async () => {
      setLoading(true)
      try {
        const apiUrl = process.env.NEXT_PUBLIC_INDEXER_API_URL || 'http://localhost:3001'
        const response = await fetch(`${apiUrl}/api/transaction-states/${transactionId}`)
        if (response.ok) {
          const data = await response.json()
          setState(data.state)
        }
      } catch (error) {
        console.error('Error fetching transaction status:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 10000)
    return () => clearInterval(interval)
  }, [transactionId])

  if (!transactionId || !state) return null

  const getStepLabel = (step: string) => {
    const labels: Record<string, string> = {
      'initiated': 'Transaction Initiated',
      'approving': 'Approving Tokens',
      'swapping': 'Swapping Tokens',
      'bridging': 'Bridging Tokens',
      'depositing': 'Depositing into Vault',
      'completed': 'Completed',
      'error': 'Error',
      'failed': 'Failed',
    }
    return labels[step] || step
  }

  const getStatusColor = (status: string) => {
    if (status === 'completed') return 'text-green-600 bg-green-50 border-green-200'
    if (status === 'failed') return 'text-red-600 bg-red-50 border-red-200'
    return 'text-blue-600 bg-blue-50 border-blue-200'
  }

  const getExplorerUrl = (txHash: string, chain: string) => {
    const explorers: Record<string, string> = {
      'ethereum': `https://etherscan.io/tx/${txHash}`,
      'avalanche': `https://snowtrace.io/tx/${txHash}`,
      'base': `https://basescan.org/tx/${txHash}`,
      'optimism': `https://optimistic.etherscan.io/tx/${txHash}`,
      'arbitrum': `https://arbiscan.io/tx/${txHash}`,
      'bsc': `https://bscscan.com/tx/${txHash}`,
    }
    return explorers[chain] || '#'
  }

  let lifiStatusData = null
  try {
    if (state.lifi_status) {
      lifiStatusData = JSON.parse(state.lifi_status)
    }
  } catch {}

  return (
    <div className={`border-2 rounded-lg p-4 ${getStatusColor(state.status)}`}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-bold text-lg">Transaction Status</h4>
        <span className="text-xs font-mono">{transactionId.slice(0, 8)}...</span>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="font-medium">Status:</span>
          <span className="uppercase font-bold">{state.status}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-medium">Current Step:</span>
          <span>{getStepLabel(state.current_step)}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-medium">Route:</span>
          <span>{state.from_token_symbol} ({state.source_chain}) → {state.to_token_symbol} ({state.destination_chain})</span>
        </div>
        <div className="flex justify-between">
          <span className="font-medium">Amount:</span>
          <span>
            {state.from_token_symbol === 'ETH' || state.from_token_symbol === 'AVAX' || state.from_token_symbol === 'BNB'
              ? (parseFloat(state.from_amount) / 1e18).toFixed(6)
              : (parseFloat(state.from_amount) / 1e6).toFixed(4)
            } {state.from_token_symbol}
          </span>
        </div>

        {state.swap_tx_hash && (
          <div className="pt-2 border-t">
            <div className="flex justify-between items-center">
              <span className="font-medium">Swap TX:</span>
              <a
                href={getExplorerUrl(state.swap_tx_hash, state.source_chain)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline font-mono text-xs"
              >
                {state.swap_tx_hash.slice(0, 10)}...{state.swap_tx_hash.slice(-8)}
              </a>
            </div>
          </div>
        )}

        {state.bridge_tx_hash && (
          <div className="pt-2 border-t">
            <div className="flex justify-between items-center">
              <span className="font-medium">Bridge TX:</span>
              <a
                href={getExplorerUrl(state.bridge_tx_hash, state.source_chain)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline font-mono text-xs"
              >
                {state.bridge_tx_hash.slice(0, 10)}...{state.bridge_tx_hash.slice(-8)}
              </a>
            </div>
            {lifiStatusData && (
              <div className="mt-1 text-xs">
                <span className="font-medium">LI.FI Status:</span> {lifiStatusData.status || 'PENDING'}
                {lifiStatusData.sending?.txHash && (
                  <div className="text-gray-600">Sending: {lifiStatusData.sending.txHash.slice(0, 10)}...</div>
                )}
                {lifiStatusData.receiving?.txHash && (
                  <div className="text-gray-600">Receiving: {lifiStatusData.receiving.txHash.slice(0, 10)}...</div>
                )}
              </div>
            )}
          </div>
        )}

        {state.deposit_tx_hash && (
          <div className="pt-2 border-t">
            <div className="flex justify-between items-center">
              <span className="font-medium">Deposit TX:</span>
              <a
                href={getExplorerUrl(state.deposit_tx_hash, state.destination_chain)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline font-mono text-xs"
              >
                {state.deposit_tx_hash.slice(0, 10)}...{state.deposit_tx_hash.slice(-8)}
              </a>
            </div>
          </div>
        )}

        {state.error_message && (
          <div className="pt-2 border-t">
            <div className="text-red-700">
              <span className="font-medium">Error:</span> {state.error_message}
            </div>
          </div>
        )}

        <div className="pt-2 border-t text-xs text-gray-600">
          Last updated: {new Date(state.updated_at).toLocaleString()}
        </div>
      </div>
    </div>
  )
}


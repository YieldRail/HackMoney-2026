'use client'

import { useState, useEffect } from 'react'
import { Address, formatUnits } from 'viem'
import { useAccount, useChainId, useSwitchChain } from 'wagmi'

interface PendingTransaction {
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
  vault_id?: string
  vault_address?: string
  created_at: string
  updated_at: string
}

interface PendingTransactionsProps {
  onResume?: (tx: PendingTransaction) => void
}

const getExplorerUrl = (hash: string, chain: string): string => {
  const explorers: Record<string, string> = {
    'ethereum': 'https://etherscan.io/tx/',
    'avalanche': 'https://snowtrace.io/tx/',
    'base': 'https://basescan.org/tx/',
    'optimism': 'https://optimistic.etherscan.io/tx/',
    'arbitrum': 'https://arbiscan.io/tx/',
    'bsc': 'https://bscscan.com/tx/',
  }
  return `${explorers[chain] || 'https://etherscan.io/tx/'}${hash}`
}

const getChainName = (chain: string): string => {
  const names: Record<string, string> = {
    'ethereum': 'Ethereum',
    'avalanche': 'Avalanche',
    'base': 'Base',
    'optimism': 'Optimism',
    'arbitrum': 'Arbitrum',
    'bsc': 'BSC',
  }
  return names[chain] || chain
}

const formatAmount = (amount: string, symbol: string): string => {
  const decimals = ['ETH', 'AVAX', 'BNB', 'MATIC'].includes(symbol) ? 18 : 6
  try {
    return parseFloat(formatUnits(BigInt(amount), decimals)).toFixed(6)
  } catch {
    return amount
  }
}

const getStepLabel = (step: string): string => {
  const labels: Record<string, string> = {
    'initiated': '🚀 Started',
    'approving': '✍️ Intent Signed',
    'swapping': '🔄 Swapping',
    'bridging': '🌉 Bridging & Depositing',
    'bridge_completed': '✅ Bridge Done',
    'deposit_pending': '⏳ Awaiting Deposit',
    'depositing': '💰 Depositing',
    'completed': '✅ Completed',
    'error': '❌ Error',
    'failed': '❌ Failed',
    'cancelled': '🚫 Cancelled',
  }
  return labels[step] || step
}

const chainIds: Record<string, number> = {
  'ethereum': 1,
  'avalanche': 43114,
  'base': 8453,
  'optimism': 10,
  'arbitrum': 42161,
  'bsc': 56,
}

export function PendingTransactions({ onResume }: PendingTransactionsProps) {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const [transactions, setTransactions] = useState<PendingTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [checkingStatus, setCheckingStatus] = useState<string | null>(null)

  const fetchPendingTransactions = async () => {
    if (!address) return
    
    setLoading(true)
    try {
      const apiUrl = process.env.NEXT_PUBLIC_INDEXER_API_URL || 'http://localhost:3001'
      const response = await fetch(`${apiUrl}/api/transaction-states?user_address=${address}&status=pending`)
      
      if (response.ok) {
        const data = await response.json()
        setTransactions(data.states || [])
      }
    } catch (error) {
      console.error('Error fetching pending transactions:', error)
    } finally {
      setLoading(false)
    }
  }

  const dismissTransaction = async (txId: string) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_INDEXER_API_URL || 'http://localhost:3001'
      await fetch(`${apiUrl}/api/transaction-states`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: txId,
          user_address: address,
          status: 'cancelled',
          current_step: 'cancelled',
        }),
      })
      setTransactions(prev => prev.filter(tx => tx.transaction_id !== txId))
    } catch (error) {
      console.error('Error dismissing transaction:', error)
    }
  }

  const checkLifiStatus = async (txId: string) => {
    setCheckingStatus(txId)
    try {
      const apiUrl = process.env.NEXT_PUBLIC_INDEXER_API_URL || 'http://localhost:3001'
      const response = await fetch(`${apiUrl}/api/transaction-states/${txId}/check-lifi`, {
        method: 'POST',
      })
      
      if (response.ok) {
        const data = await response.json()
        await fetchPendingTransactions()
        
        if (data.transactionStatus === 'completed') {
          setTransactions(prev => prev.filter(tx => tx.transaction_id !== txId))
        }
      }
    } catch (error) {
      console.error('Error checking LI.FI status:', error)
    } finally {
      setCheckingStatus(null)
    }
  }

  useEffect(() => {
    fetchPendingTransactions()

    const interval = setInterval(fetchPendingTransactions, 30000)
    return () => clearInterval(interval)
  }, [address])

  const ONE_HOUR = 60 * 60 * 1000
  const recentTransactions = transactions.filter(tx => {
    const createdAt = new Date(tx.created_at).getTime()
    const now = Date.now()
    return (now - createdAt) < ONE_HOUR
  })

  if (!isConnected || recentTransactions.length === 0) return null

  return (
    <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-yellow-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">⏳</span>
          <span className="font-semibold text-yellow-800">
            {recentTransactions.length} Pending Transaction{recentTransactions.length > 1 ? 's' : ''}
          </span>
        </div>
        <svg 
          className={`w-5 h-5 text-yellow-600 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-yellow-300 divide-y divide-yellow-200">
          {recentTransactions.map((tx) => {
            let lifiStatus = null
            try {
              if (tx.lifi_status) {
                lifiStatus = JSON.parse(tx.lifi_status)
              }
            } catch {}

            return (
              <div key={tx.transaction_id} className="p-4 bg-white">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-gray-900">
                        {formatAmount(tx.from_amount, tx.from_token_symbol)} {tx.from_token_symbol}
                      </span>
                      <span className="text-gray-400">→</span>
                      <span className="text-sm font-medium text-gray-900">
                        {tx.to_token_symbol}
                      </span>
                    </div>
                    
                    <div className="text-xs text-gray-500 space-y-1">
                      <div>
                        {getChainName(tx.source_chain)} → {getChainName(tx.destination_chain)}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          tx.current_step === 'bridging' ? 'bg-blue-100 text-blue-700' :
                          tx.current_step === 'bridge_completed' || tx.current_step === 'deposit_pending' ? 'bg-green-100 text-green-700' :
                          tx.current_step === 'depositing' ? 'bg-purple-100 text-purple-700' :
                          tx.current_step === 'error' || tx.current_step === 'failed' ? 'bg-red-100 text-red-700' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {getStepLabel(tx.current_step)}
                        </span>
                        {lifiStatus?.substatus && (
                          <span className="text-gray-400 text-xs">{lifiStatus.substatus}</span>
                        )}
                      </div>
                      
                      {tx.bridge_tx_hash && (
                        <a
                          href={`https://scan.li.fi/tx/${tx.bridge_tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-600 hover:underline font-medium"
                        >
                          Track on LI.FI ↗
                        </a>
                      )}

                      {tx.bridge_tx_hash && (
                        <a
                          href={getExplorerUrl(tx.bridge_tx_hash, tx.source_chain)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline ml-2"
                        >
                          View on {getChainName(tx.source_chain)} ↗
                        </a>
                      )}
                      
                      <div className="text-gray-400">
                        Started: {new Date(tx.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    {tx.bridge_tx_hash && (
                      <button
                        onClick={() => checkLifiStatus(tx.transaction_id)}
                        disabled={checkingStatus === tx.transaction_id}
                        className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                      >
                        {checkingStatus === tx.transaction_id ? (
                          <>
                            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            Checking...
                          </>
                        ) : (
                          'Check Status'
                        )}
                      </button>
                    )}
                    
                    {tx.current_step === 'deposit_pending' && (
                      <>
                        {chainId !== chainIds[tx.destination_chain] ? (
                          <button
                            onClick={() => switchChain?.({ chainId: chainIds[tx.destination_chain] })}
                            className="px-3 py-1.5 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 transition-colors"
                          >
                            Switch to {getChainName(tx.destination_chain)}
                          </button>
                        ) : (
                          <button
                            onClick={() => onResume?.(tx)}
                            className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
                          >
                            Retry Deposit
                          </button>
                        )}
                      </>
                    )}
                    
                    <button
                      onClick={() => dismissTransaction(tx.transaction_id)}
                      className="px-3 py-1.5 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
                
                {tx.error_message && (
                  <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                    Error: {tx.error_message}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      
      <div className="px-4 py-2 bg-yellow-100 border-t border-yellow-300">
        <button
          onClick={fetchPendingTransactions}
          disabled={loading}
          className="text-xs text-yellow-700 hover:text-yellow-800 font-medium disabled:opacity-50"
        >
          {loading ? 'Refreshing...' : '↻ Refresh Status'}
        </button>
      </div>
    </div>
  )
}


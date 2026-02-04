'use client'

import { useState, useEffect } from 'react'
import { Address, formatUnits } from 'viem'
import { useAccount } from 'wagmi'

interface Transaction {
  transaction_id: string
  status: 'pending' | 'completed' | 'failed' | 'cancelled'
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

const getStatusIcon = (status: string): string => {
  switch (status) {
    case 'completed': return '✅'
    case 'failed': return '❌'
    case 'cancelled': return '🚫'
    default: return '⏳'
  }
}

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'completed': return 'bg-green-100 text-green-800 border-green-300'
    case 'failed': return 'bg-red-100 text-red-800 border-red-300'
    case 'cancelled': return 'bg-gray-100 text-gray-800 border-gray-300'
    default: return 'bg-yellow-100 text-yellow-800 border-yellow-300'
  }
}

export function TransactionHistory() {
  const { address, isConnected } = useAccount()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [filter, setFilter] = useState<'all' | 'completed' | 'failed'>('all')

  const fetchTransactions = async () => {
    if (!address) return
    
    setLoading(true)
    try {
      const apiUrl = process.env.NEXT_PUBLIC_INDEXER_API_URL || 'http://localhost:3001'
      const response = await fetch(`${apiUrl}/api/transaction-states?user_address=${address}`)
      
      if (response.ok) {
        const data = await response.json()
        const sorted = (data.states || []).sort((a: Transaction, b: Transaction) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        setTransactions(sorted)
      }
    } catch (error) {
      console.error('Error fetching transactions:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTransactions()
  }, [address])

  if (!isConnected) return null

  const filteredTransactions = transactions.filter(tx => {
    if (filter === 'all') return tx.status !== 'pending'
    return tx.status === filter
  })

  const completedCount = transactions.filter(t => t.status === 'completed').length
  const failedCount = transactions.filter(t => t.status === 'failed').length

  if (transactions.length === 0) return null

  return (
    <div className="bg-white border-2 border-gray-200 rounded-lg overflow-hidden shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">📜</span>
          <span className="font-semibold text-gray-800">
            Transaction History
          </span>
          <div className="flex gap-1 ml-2">
            {completedCount > 0 && (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                {completedCount} completed
              </span>
            )}
            {failedCount > 0 && (
              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">
                {failedCount} failed
              </span>
            )}
          </div>
        </div>
        <svg 
          className={`w-5 h-5 text-gray-600 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <>
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 flex gap-2">
            {['all', 'completed', 'failed'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f as any)}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                  filter === f 
                    ? 'bg-gray-800 text-white' 
                    : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-100'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
            <button
              onClick={fetchTransactions}
              disabled={loading}
              className="ml-auto text-xs text-gray-600 hover:text-gray-800"
            >
              {loading ? 'Loading...' : '↻ Refresh'}
            </button>
          </div>

          <div className="border-t border-gray-200 divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {filteredTransactions.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                No {filter === 'all' ? '' : filter} transactions found
              </div>
            ) : (
              filteredTransactions.map((tx) => (
                <div key={tx.transaction_id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(tx.status)}`}>
                          {getStatusIcon(tx.status)} {tx.status.toUpperCase()}
                        </span>
                        <span className="text-sm font-medium text-gray-900">
                          {formatAmount(tx.from_amount, tx.from_token_symbol)} {tx.from_token_symbol}
                        </span>
                        <span className="text-gray-400">→</span>
                        <span className="text-sm font-medium text-gray-900">
                          {tx.to_token_symbol}
                        </span>
                      </div>
                      
                      <div className="text-xs text-gray-500 mb-2">
                        {getChainName(tx.source_chain)} → {getChainName(tx.destination_chain)}
                      </div>
                      
                      <div className="flex flex-wrap gap-2 text-xs">
                        {tx.bridge_tx_hash && (
                          <a 
                            href={getExplorerUrl(tx.bridge_tx_hash, tx.source_chain)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            Bridge TX ↗
                          </a>
                        )}
                        {tx.deposit_tx_hash && (
                          <a 
                            href={getExplorerUrl(tx.deposit_tx_hash, tx.destination_chain)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-green-600 hover:underline"
                          >
                            Deposit TX ↗
                          </a>
                        )}
                        {tx.lifi_status && (() => {
                          try {
                            const lifi = JSON.parse(tx.lifi_status)
                            if (lifi.lifiExplorerLink) {
                              return (
                                <a 
                                  href={lifi.lifiExplorerLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-purple-600 hover:underline"
                                >
                                  LI.FI Explorer ↗
                                </a>
                              )
                            }
                          } catch {}
                          return null
                        })()}
                      </div>
                      
                    
                      {tx.error_message && (
                        <div className="mt-2 text-xs text-red-600">
                          Error: {tx.error_message}
                        </div>
                      )}
                    </div>
                    
                   
                    <div className="text-xs text-gray-400 text-right whitespace-nowrap">
                      <div>{new Date(tx.created_at).toLocaleDateString()}</div>
                      <div>{new Date(tx.created_at).toLocaleTimeString()}</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}


'use client'

import { useState, useEffect } from 'react'
import { Address, formatUnits } from 'viem'
import { useAccount } from 'wagmi'
import { getVaultById } from '@/lib/vaults-config'

interface Transaction {
  transaction_id: string
  status: 'pending' | 'completed' | 'failed' | 'cancelled' | 'partial'
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
  receiving_tx_hash?: string
  received_amount?: string
  received_token_symbol?: string
  error_message?: string
  lifi_status?: string
  lifi_substatus?: string
  lifi_substatus_message?: string
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
  const decimals = ['ETH', 'AVAX', 'BNB', 'MATIC'].includes(symbol) || symbol.toLowerCase().includes('share') ? 18 : 6
  try {
    const formatted = parseFloat(formatUnits(BigInt(amount), decimals))
    if (symbol.toLowerCase().includes('share')) {
      return formatted.toLocaleString(undefined, { maximumFractionDigits: 4 })
    }
    return formatted.toFixed(6)
  } catch {
    return amount
  }
}

const getStatusIcon = (status: string): string => {
  switch (status) {
    case 'completed': return '✅'
    case 'partial': return '⚠️'
    case 'failed': return '❌'
    case 'cancelled': return '🚫'
    default: return '⏳'
  }
}

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'completed': return 'bg-green-100 text-green-700'
    case 'partial': return 'bg-amber-100 text-amber-700'
    case 'failed': return 'bg-red-100 text-red-700'
    case 'cancelled': return 'bg-gray-100 text-gray-600'
    default: return 'bg-yellow-100 text-yellow-700'
  }
}

export function TransactionHistory() {
  const { address, isConnected } = useAccount()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [filter, setFilter] = useState<'all' | 'completed' | 'partial' | 'failed'>('all')

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
    if (filter === 'partial') return tx.status === 'partial'
    return tx.status === filter
  })

  const completedCount = transactions.filter(t => t.status === 'completed').length
  const partialCount = transactions.filter(t => t.status === 'partial').length
  const failedCount = transactions.filter(t => t.status === 'failed').length

  if (transactions.length === 0) return null

  return (
    <div className="overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-gray-100 to-slate-100 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <span className="font-semibold text-gray-800">History</span>
          <div className="flex gap-1.5">
            {completedCount > 0 && (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                {completedCount}
              </span>
            )}
            {partialCount > 0 && (
              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
                {partialCount}
              </span>
            )}
            {failedCount > 0 && (
              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded-full">
                {failedCount}
              </span>
            )}
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <>
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex gap-2">
            {['all', 'completed', 'partial', 'failed'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f as any)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
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

          <div className="border-t border-gray-100 divide-y divide-gray-50 max-h-80 overflow-y-auto">
            {filteredTransactions.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">
                No {filter === 'all' ? '' : filter} transactions found
              </div>
            ) : (
              filteredTransactions.map((tx) => {
                const vault = tx.vault_id ? getVaultById(tx.vault_id) : null
                const vaultName = vault?.name || tx.vault_id || 'Unknown Vault'
                const sharesReceived = tx.to_amount ? formatAmount(tx.to_amount, tx.to_token_symbol || 'shares') : null
                
                return (
                <div key={tx.transaction_id} className="px-5 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="mb-2">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={`px-2 py-0.5 rounded-lg text-xs font-medium ${getStatusColor(tx.status)}`}>
                            {getStatusIcon(tx.status)} {tx.status}
                          </span>
                          <span className="text-sm font-bold text-gray-900">
                            {vaultName}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mb-1">
                          {getChainName(tx.destination_chain)} • {tx.vault_address ? `${tx.vault_address.slice(0, 6)}...${tx.vault_address.slice(-4)}` : ''}
                        </div>
                      </div>

                      <div className="bg-gray-50 rounded-lg p-2 mb-2 space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Deposited:</span>
                          <span className="font-semibold text-gray-900">
                            {formatAmount(tx.from_amount, tx.from_token_symbol)} {tx.from_token_symbol}
                          </span>
                        </div>
                        {tx.status === 'completed' && sharesReceived && (
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Shares Received:</span>
                            <span className="font-semibold text-green-700">
                              {sharesReceived} {tx.to_token_symbol || 'shares'}
                            </span>
                          </div>
                        )}
                        <div className="text-xs text-gray-400 pt-1 border-t border-gray-200">
                          {getChainName(tx.source_chain)} → {getChainName(tx.destination_chain)}
                        </div>
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
                      
                    
                      {tx.status === 'partial' && (
                        <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded text-xs text-orange-700">
                          <div className="font-medium">Partial Fill</div>
                          <div>{tx.lifi_substatus_message || 'Bridge completed but tokens not deposited to vault'}</div>
                          {tx.receiving_tx_hash && (
                            <a
                              href={getExplorerUrl(tx.receiving_tx_hash, tx.destination_chain)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-orange-600 hover:underline mt-1 block"
                            >
                              Receiving TX on {getChainName(tx.destination_chain)} ↗
                            </a>
                          )}
                        </div>
                      )}

                      {tx.error_message && tx.status !== 'partial' && (
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
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}


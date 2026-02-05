'use client'

import { useState, useEffect } from 'react'
import { FloatingWhales } from './FloatingWhales'
import { fetchAggregatedWhales, type AggregatedWhale } from '@/lib/morpho'

interface WhalesDashboardProps {
  chainId?: number
  maxWhales?: number
  minTotalUsd?: number
  className?: string
  height?: string
}

export function WhalesDashboard({
  chainId = 8453,
  maxWhales = 20,
  minTotalUsd = 500,
  className = '',
  height = 'h-[500px]',
}: WhalesDashboardProps) {
  const [whales, setWhales] = useState<AggregatedWhale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingStatus, setLoadingStatus] = useState('Initializing...')

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError(null)
      setLoadingStatus('Fetching whale data from Morpho vaults...')

      try {
        const data = await fetchAggregatedWhales(chainId, maxWhales, minTotalUsd)
        setWhales(data)
        setLoadingStatus(`Found ${data.length} whales!`)
      } catch (err) {
        console.error('Error fetching whales:', err)
        setError('Failed to load whales')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [chainId, maxWhales, minTotalUsd])

  if (loading) {
    return (
      <div className={`relative bg-gradient-to-br from-purple-900/10 to-indigo-900/10 rounded-2xl border border-purple-500/20 ${height} ${className}`}>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="relative">
            <div className="w-16 h-16 rounded-full bg-purple-200 animate-pulse" />
            <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-indigo-200 animate-pulse delay-100" />
            <div className="absolute -bottom-2 -left-2 w-10 h-10 rounded-full bg-violet-200 animate-pulse delay-200" />
          </div>
          <div className="mt-4 text-purple-600 animate-pulse">{loadingStatus}</div>
          <div className="mt-1 text-xs text-purple-400">Querying vaults one by one (cached for 10 min)</div>
          <div className="mt-2 text-[10px] text-purple-300">Ethereum + Base • Top Morpho Vaults</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`relative bg-gradient-to-br from-red-900/10 to-orange-900/10 rounded-2xl border border-red-500/20 ${height} ${className}`}>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-red-500">
            <span className="text-4xl mb-2 block">⚠️</span>
            <p>{error}</p>
          </div>
        </div>
      </div>
    )
  }

  // Transform to the format expected by FloatingWhales
  const whalePositions = whales.map(w => ({
    address: w.address,
    totalAssetsUsd: w.totalAssetsUsd,
    vaultPositions: w.vaultPositions.map(p => ({
      vaultName: p.vaultName,
      vaultSymbol: p.vaultSymbol,
      assets: p.assets,
      assetsUsd: p.assetsUsd,
      assetSymbol: p.assetSymbol,
      assetDecimals: p.assetDecimals,
    })),
  }))

  return (
    <FloatingWhales
      whales={whalePositions}
      className={`${height} ${className}`}
    />
  )
}

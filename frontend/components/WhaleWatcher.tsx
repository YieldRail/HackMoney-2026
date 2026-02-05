'use client'

import { useState, useEffect, useMemo } from 'react'
import { formatUnits } from 'viem'
import { useEnsName, useEnsAvatar } from 'wagmi'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'
import { fetchTopVaultDepositors, type VaultDepositor, type TopDepositorsResult } from '@/lib/morpho'

interface WhaleWatcherProps {
  vaultAddress: string
  chainId: number
  minPositionUsd?: number
  maxWhales?: number
}

// Individual whale bubble component with ENS resolution
function WhaleBubble({
  depositor,
  maxAssetsUsd,
  assetSymbol,
  assetDecimals,
  rank
}: {
  depositor: VaultDepositor
  maxAssetsUsd: number
  assetSymbol: string
  assetDecimals: number
  rank: number
}) {
  // Resolve ENS name for the address
  const { data: ensName, isLoading: ensLoading } = useEnsName({
    address: depositor.address as `0x${string}`,
    chainId: mainnet.id,
  })

  // Resolve ENS avatar
  const { data: ensAvatar } = useEnsAvatar({
    name: ensName ? normalize(ensName) : undefined,
    chainId: mainnet.id,
  })

  // Calculate bubble size based on position size (relative to largest)
  const sizeRatio = depositor.assetsUsd / maxAssetsUsd
  const minSize = 48
  const maxSize = 96
  const bubbleSize = Math.max(minSize, Math.min(maxSize, minSize + (maxSize - minSize) * sizeRatio))

  // Format display values
  const displayName = ensName || `${depositor.address.slice(0, 6)}...${depositor.address.slice(-4)}`
  const shortName = ensName
    ? (ensName.length > 12 ? `${ensName.slice(0, 10)}...` : ensName)
    : `${depositor.address.slice(0, 4)}...${depositor.address.slice(-3)}`

  const formattedAssets = parseFloat(formatUnits(BigInt(depositor.assets), assetDecimals)).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })

  const formattedUsd = depositor.assetsUsd.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })

  // Color based on rank
  const getRankColor = (rank: number) => {
    if (rank === 1) return 'from-yellow-400 to-amber-500 ring-yellow-300'
    if (rank === 2) return 'from-gray-300 to-gray-400 ring-gray-200'
    if (rank === 3) return 'from-amber-600 to-amber-700 ring-amber-400'
    return 'from-purple-500 to-indigo-600 ring-purple-300'
  }

  return (
    <div className="group relative flex flex-col items-center">
      {/* Bubble */}
      <div
        className={`relative rounded-full bg-gradient-to-br ${getRankColor(rank)} shadow-lg ring-2 ring-opacity-50 transition-all duration-300 hover:scale-110 hover:shadow-xl cursor-pointer flex items-center justify-center overflow-hidden`}
        style={{ width: bubbleSize, height: bubbleSize }}
      >
        {ensAvatar ? (
          <img
            src={ensAvatar}
            alt={displayName}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-white font-bold text-xs">
            #{rank}
          </span>
        )}

        {/* Rank badge for top 3 */}
        {rank <= 3 && (
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center shadow-md">
            <span className="text-xs font-bold">
              {rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}
            </span>
          </div>
        )}
      </div>

      {/* Name label */}
      <div className="mt-1.5 text-center">
        <div className={`text-xs font-medium ${ensName ? 'text-purple-700' : 'text-gray-600'} truncate max-w-[80px]`}>
          {ensLoading ? '...' : shortName}
        </div>
        <div className="text-[10px] text-gray-400">
          {formattedUsd}
        </div>
      </div>

      {/* Hover tooltip - positioned below to avoid clipping */}
      <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-[100]">
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-gray-900"></div>
        <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap">
          <div className="font-semibold mb-1">
            {ensName ? (
              <span className="text-purple-300">{ensName}</span>
            ) : (
              <span className="text-gray-300">{depositor.address.slice(0, 10)}...{depositor.address.slice(-8)}</span>
            )}
          </div>
          <div className="text-gray-300">
            {formattedAssets} {assetSymbol}
          </div>
          <div className="text-green-400 font-medium">
            {formattedUsd}
          </div>
          <div className="text-gray-400 text-[10px] mt-1">
            Rank #{rank} depositor {ensName ? '• ENS ✓' : ''}
          </div>
        </div>
      </div>
    </div>
  )
}

export function WhaleWatcher({
  vaultAddress,
  chainId,
  minPositionUsd = 100,
  maxWhales = 30 // Increased to show more addresses and find more ENS names
}: WhaleWatcherProps) {
  const [data, setData] = useState<TopDepositorsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const result = await fetchTopVaultDepositors(vaultAddress, chainId, maxWhales, minPositionUsd)
        setData(result)
      } catch (err) {
        console.error('Error fetching top depositors:', err)
        setError('Failed to load top depositors')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [vaultAddress, chainId, maxWhales, minPositionUsd])

  const maxAssetsUsd = useMemo(() => {
    if (!data?.depositors.length) return 1
    return Math.max(...data.depositors.map(d => d.assetsUsd))
  }, [data])

  // Calculate total TVL from top depositors
  const topDepositorsTvl = useMemo(() => {
    if (!data?.depositors.length) return 0
    return data.depositors.reduce((sum, d) => sum + d.assetsUsd, 0)
  }, [data])

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl p-4 border border-purple-100">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full bg-purple-200 animate-pulse"></div>
          <div className="h-4 w-32 bg-purple-200 rounded animate-pulse"></div>
        </div>
        <div className="flex flex-wrap gap-3 justify-center">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex flex-col items-center">
              <div
                className="rounded-full bg-purple-200 animate-pulse"
                style={{ width: 48 + Math.random() * 32, height: 48 + Math.random() * 32 }}
              ></div>
              <div className="h-3 w-12 bg-purple-100 rounded mt-1.5 animate-pulse"></div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error || !data || data.depositors.length === 0) {
    return null // Don't show anything if no data
  }

  const displayedWhales = expanded ? data.depositors : data.depositors.slice(0, 10)

  return (
    <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl border border-purple-100">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-purple-100/50 transition-colors rounded-t-xl"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">🐋</span>
          <span className="font-semibold text-purple-800">Top Depositors</span>
          <span className="text-xs text-purple-500 bg-purple-100 px-2 py-0.5 rounded-full">
            {data.depositors.length} whales
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-purple-600">
            {topDepositorsTvl.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} TVL
          </span>
          <svg
            className={`w-5 h-5 text-purple-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Whale bubbles - removed overflow-hidden to allow tooltips to show */}
      <div className={`px-4 pb-4 pt-2 transition-all duration-300 ${expanded ? '' : 'max-h-48'}`}>
        <div className="flex flex-wrap gap-4 justify-center py-2 relative">
          {displayedWhales.map((depositor, index) => (
            <WhaleBubble
              key={depositor.address}
              depositor={depositor}
              maxAssetsUsd={maxAssetsUsd}
              assetSymbol={data.assetSymbol}
              assetDecimals={data.assetDecimals}
              rank={index + 1}
            />
          ))}
        </div>

        {/* Show more indicator */}
        {!expanded && data.depositors.length > 10 && (
          <div className="text-center text-xs text-purple-500 mt-2">
            +{data.depositors.length - 10} more depositors • Click to expand
          </div>
        )}

        {/* ENS info footer */}
        {expanded && (
          <div className="mt-4 pt-3 border-t border-purple-100 space-y-1">
            <div className="flex items-center justify-center gap-2 text-xs text-purple-500">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 17.97L4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0L4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z"/>
              </svg>
              <span>ENS names resolved via Ethereum mainnet</span>
            </div>
            <div className="text-center text-[10px] text-gray-400">
              Note: Only addresses with registered ENS names will show names. Purple names = ENS resolved.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

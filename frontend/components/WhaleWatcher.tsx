'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { formatUnits } from 'viem'
import { useEnsAvatar } from 'wagmi'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'
import { fetchTopVaultDepositors, type VaultDepositor, type TopDepositorsResult } from '@/lib/morpho'
import { batchResolveEnsNames } from '@/lib/ens-batch'
import type { Address } from 'viem'

interface WhaleWatcherProps {
  vaultAddress: string
  chainId: number
  minPositionUsd?: number
  maxWhales?: number
}

function WhaleBubble({
  depositor,
  maxAssetsUsd,
  assetSymbol,
  assetDecimals,
  rank,
  ensName,
  customSize
}: {
  depositor: VaultDepositor
  maxAssetsUsd: number
  assetSymbol: string
  assetDecimals: number
  rank: number
  ensName: string | null
  customSize?: number
}) {
  const { data: ensAvatar } = useEnsAvatar({
    name: ensName ? normalize(ensName) : undefined,
    chainId: mainnet.id,
  })

  const sizeRatio = depositor.assetsUsd / maxAssetsUsd
  const minSize = 48
  const maxSize = 96
  const bubbleSize = customSize ?? Math.max(minSize, Math.min(maxSize, minSize + (maxSize - minSize) * sizeRatio))

  const displayName = ensName || `${depositor.address.slice(0, 6)}...${depositor.address.slice(-4)}`
  const shortName = ensName
    ? (ensName.length > 12 ? `${ensName.slice(0, 10)}...` : ensName)
    : `${depositor.address.slice(0, 4)}...${depositor.address.slice(-3)}`
  
  const ensLoading = false

  const formattedAssets = parseFloat(formatUnits(BigInt(depositor.assets), assetDecimals)).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })

  const formattedUsd = depositor.assetsUsd.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })

  const getRankColor = (rank: number) => {
    if (rank === 1) return 'from-yellow-400 to-amber-500 ring-yellow-300'
    if (rank === 2) return 'from-gray-300 to-gray-400 ring-gray-200'
    if (rank === 3) return 'from-amber-600 to-amber-700 ring-amber-400'
    return 'from-purple-500 to-indigo-600 ring-purple-300'
  }

  const [showTooltip, setShowTooltip] = useState(false)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (showTooltip && bubbleRef.current) {
      const updateTooltipPosition = () => {
        if (bubbleRef.current && tooltipRef.current) {
          const rect = bubbleRef.current.getBoundingClientRect()
          tooltipRef.current.style.top = `${rect.top - 8}px`
          tooltipRef.current.style.left = `${rect.left + rect.width / 2}px`
          tooltipRef.current.style.transform = 'translateX(-50%) translateY(-100%)'
        }
      }
      updateTooltipPosition()
      window.addEventListener('scroll', updateTooltipPosition, true)
      window.addEventListener('resize', updateTooltipPosition)
      return () => {
        window.removeEventListener('scroll', updateTooltipPosition, true)
        window.removeEventListener('resize', updateTooltipPosition)
      }
    }
  }, [showTooltip])

  return (
    <>
      <div 
        ref={bubbleRef}
        className="group relative flex flex-col items-center"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
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

          {rank <= 3 && (
            <div className="absolute -top-1 -right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center shadow-md">
              <span className="text-xs font-bold">
                {rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}
              </span>
            </div>
          )}
        </div>

        <div className="mt-1.5 text-center">
          <div className={`text-xs font-medium ${ensName ? 'text-purple-700' : 'text-gray-600'} truncate max-w-[80px]`}>
            {ensLoading ? '...' : shortName}
          </div>
          <div className="text-[10px] text-gray-400">
            {formattedUsd}
          </div>
        </div>
      </div>

      {showTooltip && (
        <div
          ref={tooltipRef}
          className="fixed z-[9999] pointer-events-none"
          style={{ transform: 'translateX(-50%) translateY(-100%)' }}
        >
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 border-4 border-transparent border-t-gray-900"></div>
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
      )}
    </>
  )
}

export function WhaleWatcher({
  vaultAddress,
  chainId,
  minPositionUsd = 100,
  maxWhales = 30
}: WhaleWatcherProps) {
  const [data, setData] = useState<TopDepositorsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [ensMap, setEnsMap] = useState<Map<string, string | null>>(new Map())
  const [ensResolving, setEnsResolving] = useState(false)

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

  useEffect(() => {
    if (!loading && data?.depositors && data.depositors.length > 0 && ensMap.size === 0) {
      async function resolveEns() {
        setEnsResolving(true)
        try {
          const addresses = data!.depositors.map(d => d.address as Address)
          const resolved = await batchResolveEnsNames(addresses)
          setEnsMap(resolved)
        } catch (err) {
          console.error('Error batch resolving ENS:', err)
        } finally {
          setEnsResolving(false)
        }
      }
      resolveEns()
    }
  }, [loading, data, ensMap.size])

  const maxAssetsUsd = useMemo(() => {
    if (!data?.depositors.length) return 1
    return Math.max(...data.depositors.map(d => d.assetsUsd))
  }, [data])

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

  const shouldUseExpand = data.depositors.length > 20
  const displayedWhales = shouldUseExpand && !expanded 
    ? data.depositors.slice(0, 20) 
    : data.depositors

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-visible h-full flex flex-col">
      {shouldUseExpand ? (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">🐋</span>
            <span className="text-sm font-medium text-gray-700">Top Depositors</span>
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
              {data.depositors.length} whales
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">
              {topDepositorsTvl.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} TVL
            </span>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>
      ) : (
        <div className="w-full px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🐋</span>
            <span className="text-sm font-medium text-gray-700">Top Depositors</span>
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
              {data.depositors.length} whales
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">
              {topDepositorsTvl.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} TVL
            </span>
          </div>
        </div>
      )}

      <div className="px-4 pb-4 pt-2 overflow-visible">
        <div className="flex flex-wrap gap-4 justify-center py-2 relative">
          {displayedWhales.map((depositor, index) => {
            const ensName = ensMap.get(depositor.address.toLowerCase())
            return (
              <WhaleBubble
                key={depositor.address}
                depositor={depositor}
                maxAssetsUsd={maxAssetsUsd}
                assetSymbol={data.assetSymbol}
                assetDecimals={data.assetDecimals}
                rank={index + 1}
                ensName={ensName || null}
              />
            )
          })}
        </div>

        {shouldUseExpand && !expanded && (
          <div className="text-center text-xs text-gray-500 mt-2">
            +{data.depositors.length - 20} more depositors • Click to expand
          </div>
        )}
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useEnsAvatar } from 'wagmi'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'
import { fetchTopVaultPositions, type AggregatedWhale } from '@/lib/morpho'
import { batchResolveEnsNames } from '@/lib/ens-batch'
import type { Address } from 'viem'

function ENSRow({
  whale,
  ensName,
  onEnsFound,
}: {
  whale: AggregatedWhale
  ensName: string | null
  onEnsFound: (address: string, ensName: string) => void
}) {
  const [showTooltip, setShowTooltip] = useState(false)

  const { data: ensAvatar } = useEnsAvatar({
    name: ensName ? normalize(ensName) : undefined,
    chainId: mainnet.id,
  })

  useEffect(() => {
    if (ensName) {
      onEnsFound(whale.address, ensName)
    }
  }, [ensName, whale.address, onEnsFound])

  if (!ensName) return null

  const formattedTotal = whale.totalAssetsUsd.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })

  return (
    <div
      className="relative flex items-center gap-4 p-4 bg-white/80 backdrop-blur-sm rounded-xl border border-purple-200/50 hover:border-purple-300 hover:shadow-lg hover:bg-white transition-all duration-300 cursor-pointer group z-10"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-purple-400 via-indigo-500 to-pink-500 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-md group-hover:shadow-lg group-hover:scale-110 transition-transform duration-300">
        {ensAvatar ? (
          <img src={ensAvatar} alt={ensName} className="w-full h-full object-cover" />
        ) : (
          <span className="text-white text-sm font-bold">
            {ensName.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent"></div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-indigo-600 truncate text-base">
          {ensName}
        </div>
        <div className="text-xs text-gray-500 truncate font-mono mt-0.5">
          {whale.address.slice(0, 8)}...{whale.address.slice(-6)}
        </div>
      </div>

      <div className="text-right flex-shrink-0">
        <div className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-600 to-emerald-600 text-lg">
          {formattedTotal}
        </div>
        <div className="text-xs text-gray-500 font-medium mt-0.5">
          {whale.vaultPositions.length} vault{whale.vaultPositions.length > 1 ? 's' : ''}
        </div>
      </div>

      {showTooltip && whale.vaultPositions.length > 0 && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-[99999] w-80 bg-white rounded-xl shadow-2xl border-2 border-purple-300 p-4">
          <div className="text-sm font-semibold text-purple-800 mb-3 flex items-center gap-2">
            <span>Vault Positions for {ensName}</span>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {whale.vaultPositions.map((position, idx) => {
              const formattedAssets = position.assetsUsd.toLocaleString(undefined, {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 0,
              })
              return (
                <div key={idx} className="flex justify-between items-center p-2 bg-purple-50 rounded-md">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-800 truncate text-sm">{position.vaultName}</div>
                    <div className="text-xs text-gray-500">{position.vaultSymbol}</div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <div className="font-semibold text-green-600 text-sm">{formattedAssets}</div>
                    <div className="text-xs text-gray-400">
                      {(Number(position.assets) / Math.pow(10, position.assetDecimals)).toFixed(2)} {position.assetSymbol}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-purple-300"></div>
        </div>
      )}
    </div>
  )
}

export function TopENSHolders() {
  const [whales, setWhales] = useState<AggregatedWhale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ensMap, setEnsMap] = useState<Map<string, string | null>>(new Map())
  const [ensResolving, setEnsResolving] = useState(false)

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchTopVaultPositions(400)
        setWhales(data)
      } catch (err) {
        console.error('Error fetching whales:', err)
        setError('Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  useEffect(() => {
    if (!loading && whales.length > 0 && ensMap.size === 0) {
      async function resolveEns() {
        setEnsResolving(true)
        try {
          const addresses = whales.map(w => w.address as Address)
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
  }, [loading, whales, ensMap.size])

  const handleEnsFound = useCallback((address: string, ensName: string) => {
  }, [])

  const whalesWithEns = useMemo(() => {
    return whales.filter(whale => {
      const ensName = ensMap.get(whale.address.toLowerCase())
      return ensName !== null && ensName !== undefined
    })
  }, [whales, ensMap])

  if (loading || ensResolving) {
    return (
      <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl border border-purple-100 p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">🐋</span>
          <h3 className="font-bold text-purple-800 text-lg">Top Morpho Whales</h3>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="w-8 h-8 border-3 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
            <div className="text-purple-600">
              {loading ? 'Loading top positions...' : 'Resolving ENS names...'}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-gradient-to-br from-red-50 to-orange-50 rounded-xl border border-red-100 p-6">
        <div className="text-center text-red-600">
          <span className="text-2xl block mb-2">⚠️</span>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-purple-50 via-indigo-50 to-pink-50 rounded-2xl border-2 border-purple-200/50 shadow-lg overflow-visible backdrop-blur-sm">
      <div className="px-6 py-5 bg-gradient-to-r from-purple-100/50 to-indigo-100/50 border-b border-purple-200/50">
        <div className="flex items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-indigo-500 flex items-center justify-center shadow-md">
              <span className="text-xl">🐋</span>
            </div>
            <div>
              <h3 className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-indigo-600 text-xl">
                Top Morpho Whales
              </h3>
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-3 min-h-[200px] overflow-visible">
        {whalesWithEns.map((whale) => {
          const ensName = ensMap.get(whale.address.toLowerCase())
          return (
            <ENSRow
              key={whale.address}
              whale={whale}
              ensName={ensName || null}
              onEnsFound={handleEnsFound}
            />
          )
        })}

        {!ensResolving && whalesWithEns.length === 0 && (
          <div className="text-center py-12 text-purple-400">
            <span className="text-4xl block mb-3">🔍</span>
            <p className="font-medium">No ENS names found</p>
          </div>
        )}
      </div>

      <div className="px-6 py-4 bg-gradient-to-r from-purple-100/30 to-indigo-100/30 border-t border-purple-200/50 flex items-center justify-between backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs text-purple-600 font-medium">
          <svg className="w-4 h-4 text-purple-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.944 17.97L4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0L4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z"/>
          </svg>
          <span>Powered by ENS</span>
        </div>
        <div className="text-xs text-purple-500/70 font-medium">
          Morpho Protocol • Ethereum + Base
        </div>
      </div>
    </div>
  )
}

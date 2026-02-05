'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { formatUnits } from 'viem'
import { useEnsAvatar, useEnsText } from 'wagmi'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'
import { batchResolveEnsNames } from '@/lib/ens-batch'
import type { Address } from 'viem'

interface WhalePosition {
  address: string
  totalAssetsUsd: number
  vaultPositions: {
    vaultName: string
    vaultSymbol: string
    assets: string
    assetsUsd: number
    assetSymbol: string
    assetDecimals: number
  }[]
}

interface FloatingWhalesProps {
  whales: WhalePosition[]
  className?: string
}

function FloatingWhaleBubble({
  whale,
  ensName,
  maxTotalUsd,
  index,
  containerRef,
}: {
  whale: WhalePosition
  ensName: string
  maxTotalUsd: number
  index: number
  containerRef: React.RefObject<HTMLDivElement>
}) {
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [velocity, setVelocity] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const positionRef = useRef({ x: 0, y: 0 })

  const { data: ensAvatar } = useEnsAvatar({
    name: normalize(ensName),
    chainId: mainnet.id,
  })

  const { data: twitter } = useEnsText({
    name: normalize(ensName),
    key: 'com.twitter',
    chainId: mainnet.id,
  })

  const { data: github } = useEnsText({
    name: normalize(ensName),
    key: 'com.github',
    chainId: mainnet.id,
  })

  const { data: description } = useEnsText({
    name: normalize(ensName),
    key: 'description',
    chainId: mainnet.id,
  })

  const { data: url } = useEnsText({
    name: normalize(ensName),
    key: 'url',
    chainId: mainnet.id,
  })

  const sizeRatio = whale.totalAssetsUsd / maxTotalUsd
  const minSize = 55
  const maxSize = 130
  const bubbleSize = Math.max(minSize, Math.min(maxSize, minSize + (maxSize - minSize) * Math.sqrt(sizeRatio)))

  useEffect(() => {
    if (containerRef.current) {
      const container = containerRef.current.getBoundingClientRect()
      const padding = bubbleSize
      const x = padding + Math.random() * (container.width - bubbleSize - padding * 2)
      const y = padding + Math.random() * (container.height - bubbleSize - padding * 2)
      setPosition({ x, y })
      positionRef.current = { x, y }

      const speed = 0.2 + Math.random() * 0.4
      const angle = Math.random() * Math.PI * 2
      setVelocity({
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed,
      })
    }
  }, [containerRef, bubbleSize])

  useEffect(() => {
    if (isDragging || isHovered) return

    let animationId: number
    const animate = () => {
      if (!containerRef.current || !bubbleRef.current) {
        animationId = requestAnimationFrame(animate)
        return
      }

      const container = containerRef.current.getBoundingClientRect()
      const padding = 10

      setPosition(prev => {
        let newX = prev.x + velocity.x
        let newY = prev.y + velocity.y
        let newVelX = velocity.x
        let newVelY = velocity.y

        if (newX <= padding || newX >= container.width - bubbleSize - padding) {
          newVelX = -newVelX * 0.8
          newX = Math.max(padding, Math.min(container.width - bubbleSize - padding, newX))
        }
        if (newY <= padding || newY >= container.height - bubbleSize - padding) {
          newVelY = -newVelY * 0.8
          newY = Math.max(padding, Math.min(container.height - bubbleSize - padding, newY))
        }

        if (Math.random() < 0.02) {
          newVelX += (Math.random() - 0.5) * 0.15
          newVelY += (Math.random() - 0.5) * 0.15
        }

        const maxVel = 0.8
        newVelX = Math.max(-maxVel, Math.min(maxVel, newVelX))
        newVelY = Math.max(-maxVel, Math.min(maxVel, newVelY))

        setVelocity({ x: newVelX, y: newVelY })
        positionRef.current = { x: newX, y: newY }
        return { x: newX, y: newY }
      })

      animationId = requestAnimationFrame(animate)
    }

    animationId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationId)
  }, [isDragging, isHovered, velocity, bubbleSize, containerRef])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX - positionRef.current.x,
      y: e.clientY - positionRef.current.y,
    }
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return

    const container = containerRef.current.getBoundingClientRect()
    let newX = e.clientX - dragStartRef.current.x
    let newY = e.clientY - dragStartRef.current.y

    newX = Math.max(10, Math.min(container.width - bubbleSize - 10, newX))
    newY = Math.max(10, Math.min(container.height - bubbleSize - 10, newY))

    setPosition({ x: newX, y: newY })
    positionRef.current = { x: newX, y: newY }
  }, [isDragging, bubbleSize, containerRef])

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false)
      setVelocity({
        x: (Math.random() - 0.5) * 0.4,
        y: (Math.random() - 0.5) * 0.4,
      })
    }
  }, [isDragging])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const formattedTotal = whale.totalAssetsUsd.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })

  const gradients = [
    'from-purple-500 to-indigo-600',
    'from-blue-500 to-cyan-500',
    'from-emerald-500 to-teal-500',
    'from-orange-500 to-amber-500',
    'from-pink-500 to-rose-500',
    'from-violet-500 to-purple-600',
    'from-red-500 to-orange-500',
    'from-cyan-500 to-blue-600',
  ]
  const gradient = gradients[index % gradients.length]

  return (
    <div
      ref={bubbleRef}
      className={`absolute cursor-grab active:cursor-grabbing transition-shadow duration-300 ${
        isDragging ? 'z-50' : 'z-10'
      }`}
      style={{
        left: position.x,
        top: position.y,
        width: bubbleSize,
        height: bubbleSize,
      }}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`absolute inset-0 rounded-full bg-gradient-to-br ${gradient} opacity-30 blur-xl transition-opacity duration-300 ${
          isHovered ? 'opacity-60' : ''
        }`}
      />

      <div
        className={`relative w-full h-full rounded-full bg-gradient-to-br ${gradient} shadow-lg ring-2 ring-white/30 transition-transform duration-300 flex items-center justify-center overflow-hidden ${
          isHovered ? 'scale-110 ring-4 ring-white/50' : ''
        } ${isDragging ? 'scale-105' : ''}`}
      >
        {ensAvatar ? (
          <img
            src={ensAvatar}
            alt={ensName}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="text-white font-bold text-center px-2">
            <div className="text-xs truncate max-w-full">
              {ensName.length > 10 ? `${ensName.slice(0, 8)}...` : ensName}
            </div>
          </div>
        )}
      </div>

      <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap">
        <div className="text-xs font-semibold text-purple-700 bg-white/90 px-2 py-0.5 rounded-full shadow-sm border border-purple-200">
          {ensName.length > 14 ? `${ensName.slice(0, 12)}...` : ensName}
        </div>
      </div>

      {isHovered && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-8 z-[100] pointer-events-none">
          <div className="bg-gray-900/95 backdrop-blur-sm text-white text-xs rounded-xl px-4 py-3 shadow-2xl min-w-[260px] max-w-[340px]">
            <div className="flex items-center gap-3 mb-3 pb-2 border-b border-gray-700">
              {ensAvatar && (
                <img src={ensAvatar} alt={ensName} className="w-12 h-12 rounded-full ring-2 ring-purple-400" />
              )}
              <div>
                <div className="font-bold text-purple-300 text-base">{ensName}</div>
                <div className="text-gray-400 text-[10px]">
                  {whale.address.slice(0, 8)}...{whale.address.slice(-6)}
                </div>
              </div>
            </div>

            {(description || twitter || github || url) && (
              <div className="mb-3 pb-2 border-b border-gray-700 space-y-1.5">
                {description && (
                  <div className="text-gray-300 text-[11px] italic line-clamp-2">"{description}"</div>
                )}
                <div className="flex flex-wrap gap-2">
                  {twitter && (
                    <a
                      href={`https://twitter.com/${twitter}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 text-[10px] flex items-center gap-1 pointer-events-auto"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                      </svg>
                      @{twitter}
                    </a>
                  )}
                  {github && (
                    <a
                      href={`https://github.com/${github}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-300 hover:text-white text-[10px] flex items-center gap-1 pointer-events-auto"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                      </svg>
                      {github}
                    </a>
                  )}
                  {url && (
                    <a
                      href={url.startsWith('http') ? url : `https://${url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-400 hover:text-emerald-300 text-[10px] flex items-center gap-1 pointer-events-auto"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      Website
                    </a>
                  )}
                </div>
              </div>
            )}

            <div className="mb-2">
              <div className="text-gray-400 text-[10px] uppercase tracking-wide">Total Morpho Holdings</div>
              <div className="text-green-400 font-bold text-xl">{formattedTotal}</div>
            </div>

            <div>
              <div className="text-gray-400 text-[10px] uppercase tracking-wide mb-1">Vault Positions</div>
              <div className="space-y-1 max-h-[120px] overflow-y-auto">
                {whale.vaultPositions.map((pos, i) => (
                  <div key={i} className="flex justify-between items-center bg-gray-800/50 rounded px-2 py-1">
                    <span className="text-gray-300 truncate max-w-[150px]">{pos.vaultName}</span>
                    <span className="text-emerald-400 font-medium">
                      {pos.assetsUsd.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-gray-900/95"></div>
          </div>
        </div>
      )}
    </div>
  )
}

export function FloatingWhales({ whales, className = '' }: FloatingWhalesProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isClient, setIsClient] = useState(false)
  const [ensResults, setEnsResults] = useState<Map<string, string>>(new Map())
  const [ensResolving, setEnsResolving] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  useEffect(() => {
    if (isClient && whales.length > 0 && ensResults.size === 0) {
      async function resolveEns() {
        setEnsResolving(true)
        try {
          const addresses = whales.map(w => w.address as Address)
          const resolved = await batchResolveEnsNames(addresses)
          const withEns = new Map<string, string>()
          resolved.forEach((name, address) => {
            if (name) {
              withEns.set(address, name)
            }
          })
          setEnsResults(withEns)
        } catch (err) {
          console.error('Error batch resolving ENS:', err)
        } finally {
          setEnsResolving(false)
        }
      }
      resolveEns()
    }
  }, [isClient, whales, ensResults.size])

  const whalesWithEns = useMemo(() => {
    return whales.filter(w => ensResults.has(w.address.toLowerCase()))
  }, [whales, ensResults])

  const maxTotalUsd = useMemo(() => {
    if (!whalesWithEns.length) return 1
    return Math.max(...whalesWithEns.map(w => w.totalAssetsUsd))
  }, [whalesWithEns])

  const totalValue = whalesWithEns.reduce((sum, w) => sum + w.totalAssetsUsd, 0)

  if (!isClient) {
    return (
      <div className={`relative bg-gradient-to-br from-purple-900/20 to-indigo-900/20 rounded-2xl border border-purple-500/20 ${className}`}>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-purple-400 animate-pulse">Loading whales...</div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`relative bg-gradient-to-br from-purple-900/10 to-indigo-900/10 rounded-2xl border border-purple-500/20 overflow-hidden ${className}`}
    >
      <div className="absolute inset-0 opacity-5">
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 2px 2px, purple 1px, transparent 0)`,
          backgroundSize: '40px 40px',
        }} />
      </div>

      <div className="absolute top-4 left-4 z-20">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🐋</span>
          <div>
            <h3 className="font-bold text-purple-800 text-lg">Morpho Whales</h3>
            <p className="text-xs text-purple-600">
              {ensResolving ? (
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 bg-purple-500 rounded-full animate-pulse"></span>
                  Resolving ENS names...
                </span>
              ) : (
                `${whalesWithEns.length} ENS holders across all vaults • Drag to move`
              )}
            </p>
            <p className="text-[10px] text-purple-400 mt-0.5">Ethereum + Base • Top depositors with ENS names</p>
          </div>
        </div>
      </div>

      <div className="absolute top-4 right-4 z-20">
        <div className="bg-white/80 backdrop-blur-sm rounded-lg px-3 py-2 shadow-lg">
          <div className="text-xs text-gray-500">ENS Holders TVL</div>
          <div className="font-bold text-purple-700">
            {totalValue.toLocaleString(undefined, {
              style: 'currency',
              currency: 'USD',
              maximumFractionDigits: 0,
            })}
          </div>
        </div>
      </div>

      {whalesWithEns.map((whale, index) => (
        <FloatingWhaleBubble
          key={whale.address}
          whale={whale}
          ensName={ensResults.get(whale.address.toLowerCase())!}
          maxTotalUsd={maxTotalUsd}
          index={index}
          containerRef={containerRef}
        />
      ))}

      {ensResolving && whalesWithEns.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="flex justify-center gap-2 mb-3">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="w-12 h-12 rounded-full bg-purple-300/50 animate-pulse"
                  style={{ animationDelay: `${i * 0.1}s` }}
                />
              ))}
            </div>
            <div className="text-purple-600 animate-pulse">
              Resolving ENS names for {whales.length} addresses...
            </div>
          </div>
        </div>
      )}

      {!ensResolving && whalesWithEns.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-purple-500">
            <span className="text-4xl mb-2 block">🐋</span>
            <p className="font-medium">No whales with ENS found</p>
            <p className="text-xs text-purple-400 mt-1">Checked {whales.length} addresses</p>
          </div>
        </div>
      )}

      <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2 text-xs text-purple-500 bg-white/60 backdrop-blur-sm px-3 py-1.5 rounded-full">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11.944 17.97L4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0L4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z"/>
        </svg>
        <span>Powered by ENS</span>
      </div>

      {ensResolving && (
        <div className="absolute bottom-4 right-4 z-20">
          <div className="bg-purple-100 text-purple-700 text-xs px-3 py-1.5 rounded-full flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
            Resolving...
          </div>
        </div>
      )}
    </div>
  )
}

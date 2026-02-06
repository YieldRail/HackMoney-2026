'use client'

import { useState, useRef, useEffect } from 'react'
import type { VaultRating } from '@/lib/vault-ratings'
import { getRatingColor } from '@/lib/vault-ratings'

interface VaultRatingBubbleProps {
  rating: VaultRating | null
  vaultId: string
  vaultName: string
  chain: string
}

function formatUsd(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '—'
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`
  return `$${value.toFixed(2)}`
}

export function VaultRatingBubble({ rating, vaultId, vaultName, chain }: VaultRatingBubbleProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const linkRef = useRef<HTMLAnchorElement>(null)
  const tooltipPositionRef = useRef<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!showTooltip || !linkRef.current) return
    
    const updateTooltipPosition = () => {
      if (linkRef.current) {
        const rect = linkRef.current.getBoundingClientRect()
        tooltipPositionRef.current = {
          top: rect.top - 10, // Position above the link
          left: rect.right - 288, // Align to right edge (288px = 72 * 4 = w-72)
        }
      }
    }
    
    updateTooltipPosition()
    window.addEventListener('scroll', updateTooltipPosition, true)
    window.addEventListener('resize', updateTooltipPosition)
    
    const handleClickOutside = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node) &&
          linkRef.current && !linkRef.current.contains(e.target as Node)) {
        setShowTooltip(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    
    return () => {
      window.removeEventListener('scroll', updateTooltipPosition, true)
      window.removeEventListener('resize', updateTooltipPosition)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showTooltip])

  const score = rating?.score ?? null
  const { label, style: ratingStyle } = getRatingColor(score)
  const breakdown = rating?.score_breakdown
  const metrics = rating?.metrics
  const tvlUsd = metrics?.tvlUsd
  const apr30d = metrics?.apr30d
  const apr7d = metrics?.apr7d
  const aprAll = metrics?.aprAll
  const userAnalytics = metrics?.userAnalytics

  return (
    <>
      <div className="relative inline-flex items-end justify-end">
        <div
          ref={linkRef}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold shadow-md ring-1 ring-black/10 hover:brightness-95 cursor-default"
          style={{ backgroundColor: ratingStyle.backgroundColor, color: ratingStyle.color }}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          title="Hover for score breakdown"
        >
          <span aria-hidden className="opacity-90">Score</span>
          <span>{score != null ? Math.round(score) : '—'}</span>
        </div>
      </div>

      {showTooltip && tooltipPositionRef.current && (
        <div
          ref={tooltipRef}
          className="fixed z-[9999] w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-xl"
          style={{ 
            minWidth: '16rem',
            top: `${tooltipPositionRef.current.top}px`,
            left: `${tooltipPositionRef.current.left}px`,
            transform: 'translateY(-100%)',
            pointerEvents: 'auto'
          }}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <p className="font-semibold text-gray-900">{vaultName}</p>
          <p className="text-xs text-gray-500 capitalize">{chain}</p>
          <div className="mt-2 flex items-center justify-between border-b border-gray-100 pb-2">
            <span className="text-xs text-gray-500">Composite</span>
            <span className="rounded px-1.5 py-0.5 text-sm font-bold" style={{ backgroundColor: ratingStyle.backgroundColor, color: ratingStyle.color }}>
              {score != null ? Math.round(score) : '—'} {label !== '—' && `(${label})`}
            </span>
          </div>
          <div className="mt-2 space-y-1 text-xs text-gray-600">
            <div className="flex justify-between">
              <span>Capital</span>
              <span>{breakdown?.capital != null ? Math.round(breakdown.capital) : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span>Performance</span>
              <span>{breakdown?.performance != null ? Math.round(breakdown.performance) : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span>Risk</span>
              <span>{breakdown?.risk != null ? Math.round(breakdown.risk) : '—'}</span>
            </div>
            {breakdown?.userTrust != null && (
              <div className="flex justify-between text-blue-600">
                <span>User Trust</span>
                <span>{Math.round(breakdown.userTrust)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-100 pt-1">
              <span>TVL</span>
              <span>{formatUsd(tvlUsd)}</span>
            </div>
            {apr7d != null && (
              <div className="flex justify-between">
                <span>APR (7d)</span>
                <span className="text-green-600">{(apr7d * 100).toFixed(2)}%</span>
              </div>
            )}
            {apr30d != null && (
              <div className="flex justify-between">
                <span>APR (30d)</span>
                <span className="text-green-600">{(apr30d * 100).toFixed(2)}%</span>
              </div>
            )}
            {aprAll != null && (
              <div className="flex justify-between">
                <span>APR (All)</span>
                <span className="text-green-600">{(aprAll * 100).toFixed(2)}%</span>
              </div>
            )}
            {userAnalytics && (
              <>
                <div className="flex justify-between border-t border-gray-100 pt-1 mt-1">
                  <span>Users</span>
                  <span>{userAnalytics.totalUsers} ({userAnalytics.activeHolders} active)</span>
                </div>
                <div className="flex justify-between">
                  <span>Retention</span>
                  <span className={userAnalytics.retentionRate >= 70 ? 'text-green-600' : userAnalytics.retentionRate >= 50 ? 'text-amber-600' : 'text-red-600'}>
                    {userAnalytics.retentionRate}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Avg Holding</span>
                  <span>{userAnalytics.avgHoldingDays} days</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

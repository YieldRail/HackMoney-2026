'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getVaultById } from '@/lib/vaults-config'
import { getIndexerApiUrl, getRatingColor } from '@/lib/vault-ratings'
import type { VaultRating, VaultRatingMetrics } from '@/lib/vault-ratings'

function formatUsd(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '—'
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`
  return `$${value.toFixed(2)}`
}

function formatPct(value: number | null | undefined, decimals = 2): string {
  if (value == null || isNaN(value)) return '—'
  return `${(value * 100).toFixed(decimals)}%`
}

function formatAddr(addr: string | null | undefined): string {
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return '—'
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="py-2 pr-4 text-gray-600">{label}</td>
      <td className="py-2 text-right font-mono text-sm text-gray-900">{value}</td>
    </tr>
  )
}

function LagoonMetrics({ metrics }: { metrics: VaultRatingMetrics }) {
  return (
    <>
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Capital Metrics</h2>
        <p className="text-xs text-gray-400 mb-3">Data curated by Yieldo from different protocols</p>
        <table className="w-full">
          <tbody>
            <MetricRow label="TVL (USD)" value={formatUsd(metrics.tvlUsd)} />
            <MetricRow label="Total supply (shares)" value={metrics.totalSupply ? `${(Number(metrics.totalSupply) / 1e18).toFixed(2)}` : '—'} />
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Performance Metrics</h2>
        <p className="text-xs text-gray-400 mb-3">Data curated by Yieldo from different protocols</p>
        <table className="w-full">
          <tbody>
            <MetricRow label="Net APR (7d)" value={formatPct(metrics.apr7d)} />
            <MetricRow label="Net APR (30d)" value={formatPct(metrics.apr30d)} />
            <MetricRow label="Net APR (All-time)" value={formatPct(metrics.aprAll)} />
            <MetricRow label="Base APR (no airdrops)" value={formatPct(metrics.aprBase)} />
            <MetricRow label="Share price (USD)" value={metrics.pricePerShareUsd != null ? `$${metrics.pricePerShareUsd.toFixed(6)}` : '—'} />
            <MetricRow label="High water mark" value={metrics.highWaterMark != null ? `${metrics.highWaterMark}` : '—'} />
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Risk Flags</h2>
        <table className="w-full">
          <tbody>
            <MetricRow label="Vault state" value={metrics.vaultState ?? '—'} />
            <MetricRow label="Vault paused" value={metrics.vaultPaused ? 'Yes' : 'No'} />
            <MetricRow label="Asset depeg" value={metrics.assetDepeg === true ? 'Yes' : metrics.assetDepeg === false ? 'No' : '—'} />
            <MetricRow label="Whitelist activated" value={metrics.isWhitelistActivated ? 'Yes' : 'No'} />
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Vault Fees</h2>
        <table className="w-full">
          <tbody>
            <MetricRow label="Management fee" value={metrics.managementFee != null ? `${(metrics.managementFee / 100).toFixed(2)}%` : '—'} />
            <MetricRow label="Performance fee" value={metrics.performanceFee != null ? `${(metrics.performanceFee / 100).toFixed(2)}%` : '—'} />
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Underlying Asset</h2>
        <table className="w-full">
          <tbody>
            <MetricRow label="Symbol" value={metrics.underlyingSymbol ?? '—'} />
            <MetricRow label="Price (USD)" value={metrics.underlyingPrice != null ? `$${metrics.underlyingPrice.toFixed(4)}` : '—'} />
            <MetricRow label="Decimals" value={metrics.underlyingDecimals != null ? String(metrics.underlyingDecimals) : '—'} />
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Vault Info</h2>
        <table className="w-full">
          <tbody>
            <MetricRow label="Symbol" value={metrics.lagoonSymbol ?? '—'} />
            {metrics.lagoonCurators && metrics.lagoonCurators.length > 0 && (
              <MetricRow label="Curators" value={metrics.lagoonCurators.join(', ')} />
            )}
            <MetricRow label="Vault version" value={metrics.lagoonVersion ?? '—'} />
            <MetricRow label="Has airdrops" value={metrics.hasAirdrops ? 'Yes' : 'No'} />
            <MetricRow label="Has incentives" value={metrics.hasIncentives ? 'Yes' : 'No'} />
          </tbody>
        </table>
      </section>
    </>
  )
}

function MorphoMetrics({ metrics }: { metrics: VaultRatingMetrics }) {
  return (
    <>
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Capital Metrics</h2>
        <p className="text-xs text-gray-400 mb-3">Data curated by Yieldo from different protocols</p>
        <table className="w-full">
          <tbody>
            <MetricRow label="TVL (USD)" value={formatUsd(metrics.tvlUsd)} />
            <MetricRow label="Total supply (shares)" value={metrics.totalSupply ? `${(Number(metrics.totalSupply) / 1e18).toFixed(2)}` : '—'} />
            {metrics.lastTotalAssets != null && (
              <MetricRow label="Last total assets" value={formatUsd(Number(metrics.lastTotalAssets) / 1e6)} />
            )}
            <MetricRow label="Liquidity (USD)" value={formatUsd(metrics.liquidityUsd)} />
            <MetricRow label="Liquidity ratio" value={formatPct(metrics.liquidityRatio)} />
            {metrics.idleAssetsUsd != null && (
              <>
                <MetricRow label="Idle assets (USD)" value={formatUsd(metrics.idleAssetsUsd)} />
                <MetricRow label="Idle ratio" value={formatPct(metrics.idleRatio)} />
              </>
            )}
            <MetricRow label="Positions" value={metrics.positionCount != null ? String(metrics.positionCount.toLocaleString()) : '—'} />
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Performance Metrics</h2>
        <p className="text-xs text-gray-400 mb-3">Data curated by Yieldo from different protocols</p>
        <table className="w-full">
          <tbody>
            <MetricRow label="APY (current)" value={formatPct(metrics.apy)} />
            <MetricRow label="Net APY (current)" value={formatPct(metrics.netApy)} />
            <MetricRow label="Net APY (without rewards)" value={formatPct(metrics.netApyWithoutRewards)} />
            <MetricRow label="Daily avg APY" value={formatPct(metrics.dailyApy)} />
            <MetricRow label="Weekly avg APY" value={formatPct(metrics.weeklyApy)} />
            <MetricRow label="Monthly avg APY" value={formatPct(metrics.monthlyApy)} />
            <MetricRow label="Average APY (all-time)" value={formatPct(metrics.avgApy)} />
            <MetricRow label="Average Net APY (all-time)" value={formatPct(metrics.avgNetApy)} />
            {metrics.maxApy != null && (
              <MetricRow label="Max APY" value={formatPct(metrics.maxApy)} />
            )}
            <MetricRow label="Rewards APR" value={metrics.totalRewardsApr ? formatPct(metrics.totalRewardsApr) : '0%'} />
            <MetricRow label="Share price" value={metrics.sharePrice != null ? `${Number(metrics.sharePrice).toFixed(6)}` : '—'} />
            <MetricRow label="Share price (USD)" value={metrics.sharePriceUsd != null ? `$${Number(metrics.sharePriceUsd).toFixed(6)}` : '—'} />
          </tbody>
        </table>
      </section>

      {metrics.rewards && metrics.rewards.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Rewards</h2>
          <table className="w-full">
            <tbody>
              {metrics.rewards.map((r, i) => (
                <MetricRow key={i} label={r.symbol ?? 'Token'} value={r.apr != null ? formatPct(r.apr) : '—'} />
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Market Allocation</h2>
        <table className="w-full">
          <tbody>
            <MetricRow label="Active markets" value={metrics.activeMarkets != null ? String(metrics.activeMarkets) : '—'} />
            <MetricRow label="Total markets" value={metrics.allocationCount != null ? String(metrics.allocationCount) : '—'} />
            <MetricRow label="Total supplied (USD)" value={formatUsd(metrics.totalSuppliedUsd)} />
            <MetricRow label="Total cap (USD)" value={formatUsd(metrics.totalCapUsd)} />
            <MetricRow label="Cap utilization" value={formatPct(metrics.capUtilization)} />
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Risk Flags</h2>
        <table className="w-full">
          <tbody>
            <MetricRow label="Asset depeg" value={metrics.assetDepeg === true ? 'Yes' : metrics.assetDepeg === false ? 'No' : '—'} />
            <MetricRow label="Listed on Morpho" value={metrics.listed ? 'Yes' : 'No'} />
            <MetricRow label="Featured" value={metrics.featured ? 'Yes' : metrics.featured === false ? 'No' : '—'} />
            <MetricRow label="Warnings" value={metrics.warningCount ? String(metrics.warningCount) : '0'} />
            {metrics.warnings && metrics.warnings.length > 0 && metrics.warnings.map((w, i) => (
              <MetricRow key={i} label={`Warning ${i + 1}`} value={`${w.type} (${w.level})`} />
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Vault Fees</h2>
        <table className="w-full">
          <tbody>
            <MetricRow label="Performance fee" value={metrics.performanceFee != null ? formatPct(metrics.performanceFee) : '—'} />
            <MetricRow label="Management fee" value={metrics.managementFee != null ? formatPct(metrics.managementFee) : '—'} />
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Governance</h2>
        <table className="w-full">
          <tbody>
            <MetricRow label="Curator" value={metrics.curatorInfo?.name ?? formatAddr(metrics.curator)} />
            {metrics.curatorInfo?.verified && (
              <MetricRow label="Curator verified" value="Yes" />
            )}
            <MetricRow label="Owner" value={formatAddr(metrics.owner)} />
            <MetricRow label="Guardian" value={formatAddr(metrics.guardian)} />
            <MetricRow label="Fee recipient" value={formatAddr(metrics.feeRecipient)} />
            <MetricRow label="Timelock" value={metrics.timelock != null ? `${(Number(metrics.timelock) / 86400).toFixed(1)} days` : '—'} />
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Underlying Asset</h2>
        <table className="w-full">
          <tbody>
            <MetricRow label="Symbol" value={metrics.underlyingSymbol ?? '—'} />
            <MetricRow label="Price (USD)" value={metrics.underlyingPrice != null ? `$${metrics.underlyingPrice.toFixed(4)}` : '—'} />
            <MetricRow label="Decimals" value={metrics.underlyingDecimals != null ? String(metrics.underlyingDecimals) : '—'} />
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Vault Info</h2>
        <table className="w-full">
          <tbody>
            <MetricRow label="Symbol" value={metrics.morphoSymbol ?? '—'} />
            <MetricRow label="Source" value={metrics.source ?? '—'} />
            {metrics.creationTimestamp && (
              <MetricRow label="Created" value={new Date(Number(metrics.creationTimestamp) * 1000).toLocaleDateString()} />
            )}
            {metrics.curatorInfo && (
              <>
                <tr className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-4 text-gray-600">Curator</td>
                  <td className="py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {metrics.curatorInfo.image && (
                        <img src={metrics.curatorInfo.image} alt="" className="w-5 h-5 rounded-full" />
                      )}
                      <span className="font-mono text-sm text-gray-900">{metrics.curatorInfo.name}</span>
                      {metrics.curatorInfo.verified && (
                        <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Verified</span>
                      )}
                    </div>
                  </td>
                </tr>
                {metrics.curatorInfo.url && (
                  <tr className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-4 text-gray-600">Curator URL</td>
                    <td className="py-2 text-right">
                      <a href={metrics.curatorInfo.url} target="_blank" rel="noopener noreferrer" className="font-mono text-sm text-blue-600 hover:underline">
                        {metrics.curatorInfo.url}
                      </a>
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
        {metrics.description && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-500 mb-2">Description</p>
            <p className="text-sm text-gray-700 leading-relaxed">{metrics.description}</p>
          </div>
        )}
      </section>
    </>
  )
}

export default function VaultScoringPage() {
  const params = useParams()
  const vaultId = typeof params.vault_id === 'string' ? params.vault_id : ''
  const vaultConfig = getVaultById(vaultId)

  const [rating, setRating] = useState<VaultRating | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!vaultId) {
      setLoading(false)
      setError('Missing vault')
      return
    }
    const apiUrl = getIndexerApiUrl()
    const chain = vaultConfig?.chain
    const url = chain
      ? `${apiUrl}/api/vault-ratings?vault_id=${encodeURIComponent(vaultId)}&chain=${encodeURIComponent(chain)}`
      : `${apiUrl}/api/vault-ratings?vault_id=${encodeURIComponent(vaultId)}`
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load rating')
        return res.json()
      })
      .then((data) => {
        const list = Array.isArray(data) ? data : []
        const doc = list.find((r: VaultRating) => r.vault_id === vaultId && (!chain || r.chain === chain)) ?? list[0] ?? null
        setRating(doc)
        setError(doc ? null : 'No rating data yet')
      })
      .catch((e) => {
        setError(e.message || 'Failed to load')
        setRating(null)
      })
      .finally(() => setLoading(false))
  }, [vaultId, vaultConfig?.chain])

  if (!vaultConfig) {
    return (
      <main className="min-h-screen bg-gray-50">
        <nav className="border-b border-gray-200 bg-white px-6 py-4">
          <div className="max-w-5xl mx-auto flex items-center gap-4">
            <Link href="/" className="text-gray-600 hover:text-black">← Yieldo</Link>
          </div>
        </nav>
        <div className="max-w-5xl mx-auto px-6 py-12 text-center text-gray-600">
          Vault not found.
        </div>
      </main>
    )
  }

  const score = rating?.score ?? null
  const { label, style: ratingStyle } = getRatingColor(score)
  const metrics: VaultRatingMetrics = rating?.metrics ?? {}
  const breakdown = rating?.score_breakdown ?? {}
  
  // Detect Morpho vault by vault ID pattern or Morpho-specific fields
  const isMorpho = vaultId.startsWith('morpho-') || !!metrics.morphoName || !!metrics.morphoSymbol || !!metrics.source || (metrics.source && metrics.source.startsWith('morpho'))
  
  const vaultName = isMorpho ? (metrics.morphoName ?? rating?.vault_name ?? vaultConfig.name) : (metrics.lagoonName ?? rating?.vault_name ?? vaultConfig.name)
  
  const vaultDescription = isMorpho ? metrics.description : metrics.lagoonDescription

  return (
    <main className="min-h-screen bg-gray-50">
      <nav className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-gray-600 hover:text-black">← Yieldo</Link>
            <Link href="/vaults" className="text-sm font-medium text-gray-700 hover:text-black transition-colors">
              Vaults
            </Link>
            <Link href="/dashboard" className="text-sm font-medium text-gray-700 hover:text-black transition-colors">
              Dashboard
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <header className="mb-8">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{vaultName}</h1>
            {isMorpho && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">Morpho</span>
            )}
            {!isMorpho && rating && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">Lagoon</span>
            )}
          </div>
          <p className="text-sm text-gray-500 capitalize mt-1">{vaultConfig.chain} · {metrics.underlyingSymbol ?? vaultConfig.asset.symbol} vault</p>
          {vaultDescription && (
            <p className="text-sm text-gray-600 mt-2">{vaultDescription}</p>
          )}
          {isMorpho && metrics.curatorInfo?.name && (
            <p className="text-xs text-gray-400 mt-1">Curated by {metrics.curatorInfo.name}{metrics.curatorInfo.verified ? ' (verified)' : ''}</p>
          )}
        </header>

        {loading && (
          <p className="text-gray-500">Loading scoring data...</p>
        )}

        {error && !loading && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
            {error}. Run the vault KPI job to populate ratings.
          </div>
        )}

        {rating && !loading && (
          <div className="space-y-8">
            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Composite Score</h2>
              <div className="flex flex-wrap items-center gap-6 mb-6">
                <div
                  className="rounded-xl px-6 py-4"
                  style={{ backgroundColor: ratingStyle.backgroundColor, color: ratingStyle.color }}
                >
                  <span className="text-4xl font-bold">{score != null ? Math.round(score) : '—'}</span>
                  <span className="ml-2 text-lg opacity-90">/ 100</span>
                </div>
                <div>
                  <p className="font-medium text-gray-900">{label}</p>
                  <p className="text-sm text-gray-500">Updated {rating.updated_at ? new Date(rating.updated_at).toLocaleString() : '—'}</p>
                </div>
              </div>
              
              <div className="pt-4 border-t border-gray-100">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-4">Score Breakdown</h3>
              <div className={`grid grid-cols-1 gap-4 ${breakdown.userTrust != null ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-xs font-medium text-gray-500 uppercase">Capital ({breakdown.userTrust != null ? '20%' : '25%'})</p>
                  <p className="text-2xl font-bold text-gray-900">{breakdown.capital != null ? Math.round(breakdown.capital) : '—'}</p>
                  <p className="text-xs text-gray-400 mt-1">{isMorpho ? 'TVL, liquidity, positions' : 'TVL size'}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-xs font-medium text-gray-500 uppercase">Performance ({breakdown.userTrust != null ? '30%' : '35%'})</p>
                  <p className="text-2xl font-bold text-gray-900">{breakdown.performance != null ? Math.round(breakdown.performance) : '—'}</p>
                  <p className="text-xs text-gray-400 mt-1">{isMorpho ? 'APY (daily, weekly, monthly)' : 'APR (7d, 30d, all-time)'}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-xs font-medium text-gray-500 uppercase">Risk ({breakdown.userTrust != null ? '30%' : '40%'})</p>
                  <p className="text-2xl font-bold text-gray-900">{breakdown.risk != null ? Math.round(breakdown.risk) : '—'}</p>
                  <p className="text-xs text-gray-400 mt-1">{isMorpho ? 'Depeg, fees, governance, warnings' : 'Pause, depeg, fees'}</p>
                </div>
                {breakdown.userTrust != null && (
                  <div className="rounded-lg bg-blue-50 p-4">
                    <p className="text-xs font-medium text-blue-600 uppercase">User Trust (20%)</p>
                    <p className="text-2xl font-bold text-blue-700">{Math.round(breakdown.userTrust)}</p>
                    <p className="text-xs text-blue-400 mt-1">Retention, holding time</p>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500">
                  <span className="font-medium">Score Guide:</span>{' '}
                  <span className="inline-block px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: '#10b981' }}>80-100 Excellent</span>{' '}
                  <span className="inline-block px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: '#22c55e' }}>60-79 Good</span>{' '}
                  <span className="inline-block px-1.5 py-0.5 rounded text-black" style={{ backgroundColor: '#f59e0b' }}>40-59 Moderate</span>{' '}
                  <span className="inline-block px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: '#ef4444' }}>0-39 Poor</span>
                </p>
              </div>
              </div>
            </section>

            {isMorpho ? <MorphoMetrics metrics={metrics} /> : <LagoonMetrics metrics={metrics} />}

            {metrics.userAnalytics && (
              <>
                <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">User Behavior Analytics</h2>
                    <span
                      className="px-2 py-1 rounded text-sm font-bold"
                      style={{
                        backgroundColor: metrics.userAnalytics.trustScore >= 70 ? '#10b981' : metrics.userAnalytics.trustScore >= 50 ? '#f59e0b' : '#ef4444',
                        color: '#fff'
                      }}
                    >
                      Trust Score: {metrics.userAnalytics.trustScore}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mb-3">Based on on-chain deposit/withdraw events</p>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-gray-900">{metrics.userAnalytics.totalUsers}</p>
                      <p className="text-xs text-gray-500">Total Users</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-green-600">{metrics.userAnalytics.activeHolders}</p>
                      <p className="text-xs text-gray-500">Active Holders</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-gray-900">{metrics.userAnalytics.retentionRate}%</p>
                      <p className="text-xs text-gray-500">Retention Rate</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-gray-900">{metrics.userAnalytics.avgHoldingDays}d</p>
                      <p className="text-xs text-gray-500">Avg Holding</p>
                    </div>
                  </div>

                  <table className="w-full">
                    <tbody>
                      <MetricRow label="Median holding days" value={`${metrics.userAnalytics.medianHoldingDays} days`} />
                      <MetricRow label="Holders > 30 days" value={String(metrics.userAnalytics.holdersOver30Days)} />
                      <MetricRow label="Holders > 90 days" value={String(metrics.userAnalytics.holdersOver90Days)} />
                      <MetricRow label="Holders > 180 days" value={String(metrics.userAnalytics.holdersOver180Days)} />
                      <MetricRow label="Users with multiple deposits" value={String(metrics.userAnalytics.usersWithMultipleDeposits)} />
                      <MetricRow label="Avg deposits per user" value={String(metrics.userAnalytics.avgDepositsPerUser)} />
                      {metrics.userAnalytics.totalDepositedUsd != null && (
                        <MetricRow label="Total deposited (all-time)" value={`$${Math.round(metrics.userAnalytics.totalDepositedUsd).toLocaleString()}`} />
                      )}
                      {metrics.userAnalytics.totalWithdrawnUsd != null && (
                        <MetricRow label="Total withdrawn (all-time)" value={`$${Math.round(metrics.userAnalytics.totalWithdrawnUsd).toLocaleString()}`} />
                      )}
                      {metrics.userAnalytics.transactionCount != null && (
                        <MetricRow label="Total transactions" value={String(metrics.userAnalytics.transactionCount)} />
                      )}
                    </tbody>
                  </table>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Farming Detection</h2>
                  <p className="text-xs text-gray-400 mb-3">Users who deposited and withdrew within 7 days (likely farming points)</p>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-red-500">{metrics.userAnalytics.exitedUsers}</p>
                      <p className="text-xs text-gray-500">Exited Users</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-amber-500">{metrics.userAnalytics.quickExiters}</p>
                      <p className="text-xs text-gray-500">Quick Exiters (&lt;7d)</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-gray-900">{metrics.userAnalytics.quickExitRate}%</p>
                      <p className="text-xs text-gray-500">Quick Exit Rate</p>
                    </div>
                  </div>

                  {metrics.userAnalytics.likelyFarmers && metrics.userAnalytics.likelyFarmers.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-medium text-gray-500 mb-2">Likely Farmers (quick in/out)</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <th className="text-left py-1 text-gray-500">Address</th>
                              <th className="text-right py-1 text-gray-500">Days Held</th>
                              <th className="text-right py-1 text-gray-500">Volume</th>
                            </tr>
                          </thead>
                          <tbody>
                            {metrics.userAnalytics.likelyFarmers.slice(0, 5).map((u, i) => (
                              <tr key={i} className="border-b border-gray-100">
                                <td className="py-1 font-mono text-gray-600">{u.address.slice(0, 6)}...{u.address.slice(-4)}</td>
                                <td className="py-1 text-right text-amber-600">{u.daysHeld}d</td>
                                <td className="py-1 text-right">{u.volumeUsd ? `$${u.volumeUsd.toLocaleString()}` : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>

                {metrics.userAnalytics.longTermHolders && metrics.userAnalytics.longTermHolders.length > 0 && (
                  <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Long-term Holders</h2>
                    <p className="text-xs text-gray-400 mb-3">Users holding for more than 90 days (high trust)</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left py-1 text-gray-500">Address</th>
                            <th className="text-right py-1 text-gray-500">Days</th>
                            <th className="text-right py-1 text-gray-500">Deposited</th>
                          </tr>
                        </thead>
                        <tbody>
                          {metrics.userAnalytics.longTermHolders.slice(0, 10).map((u, i) => (
                            <tr key={i} className="border-b border-gray-100">
                              <td className="py-1 font-mono text-gray-600">{u.address.slice(0, 6)}...{u.address.slice(-4)}</td>
                              <td className="py-1 text-right text-green-600 font-medium">{u.holdingDays}</td>
                              <td className="py-1 text-right">{u.totalDepositedUsd ? `$${u.totalDepositedUsd.toLocaleString()}` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {metrics.userAnalytics.smartDepositors && metrics.userAnalytics.smartDepositors.length > 0 && (
                  <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Smart Depositors</h2>
                    <p className="text-xs text-gray-400 mb-3">Users with multiple deposits and long holding periods (&gt;60 days)</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left py-1 text-gray-500">Address</th>
                            <th className="text-right py-1 text-gray-500">Days</th>
                            <th className="text-right py-1 text-gray-500">Total Deposited</th>
                          </tr>
                        </thead>
                        <tbody>
                          {metrics.userAnalytics.smartDepositors.slice(0, 10).map((u, i) => (
                            <tr key={i} className="border-b border-gray-100">
                              <td className="py-1 font-mono text-gray-600">{u.address.slice(0, 6)}...{u.address.slice(-4)}</td>
                              <td className="py-1 text-right text-green-600 font-medium">{u.holdingDays}</td>
                              <td className="py-1 text-right">{u.totalDepositedUsd ? `$${u.totalDepositedUsd.toLocaleString()}` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </>
            )}

            <p className="text-xs text-gray-400 text-center">
              Data curated by Yieldo from different protocols · Updated {rating.updated_at ? new Date(rating.updated_at).toLocaleString() : '—'}
            </p>
          </div>
        )}
      </div>
    </main>
  )
}

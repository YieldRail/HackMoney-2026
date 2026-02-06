'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { VAULTS_CONFIG } from '@/lib/vaults-config'
import { VaultRatingBubble } from '@/components/VaultRatingBubble'
import type { VaultRating } from '@/lib/vault-ratings'
import { getIndexerApiUrl } from '@/lib/vault-ratings'
import { TopENSHolders } from '@/components/TopENSHolders'

export default function Home() {
  const [ratings, setRatings] = useState<VaultRating[]>([])
  const [ratingsLoading, setRatingsLoading] = useState(true)

  useEffect(() => {
    const apiUrl = getIndexerApiUrl()
    fetch(`${apiUrl}/api/vault-ratings`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setRatings(Array.isArray(data) ? data : []))
      .catch(() => setRatings([]))
      .finally(() => setRatingsLoading(false))
  }, [])

  const getRatingForVault = (vaultId: string, chain: string) =>
    ratings.find((r) => r.vault_id === vaultId && r.chain === chain) ?? null

  return (
    <main className="min-h-screen bg-white text-black">
      <nav className="border-b border-black px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-6">
            <h1 className="text-2xl font-bold">Yieldo</h1>
            <Link href="/vaults" className="text-sm font-medium text-gray-700 hover:text-black transition-colors">
              Vaults
            </Link>
            <Link href="/dashboard" className="text-sm font-medium text-gray-700 hover:text-black transition-colors">
              Dashboard
            </Link>
          </div>
          <ConnectButton />
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="text-center mb-16">
          <h2 className="text-5xl font-bold mb-4">Find the Best Yield Vaults</h2>
          <p className="text-xl text-gray-700 mb-4">We curate top vaults across protocols so you can deposit with confidence from any chain</p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-full border border-gray-200">
            <span className="text-xs text-gray-600">Cross-chain deposits powered by</span>
            <img src="/lifi.png" alt="LI.FI" className="h-4" />
          </div>
        </div>


        <div className="border-t border-black pt-8 mt-8">
          <h3 className="text-xl font-bold mb-4">Integrated Vaults</h3>
          <div className="overflow-x-auto overflow-y-visible">
            <table className="w-full border-2 border-black">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border-b-2 border-black px-4 py-3 text-left font-semibold">Vault</th>
                  <th className="border-b-2 border-black px-4 py-3 text-left font-semibold">Chain</th>
                  <th className="border-b-2 border-black px-4 py-3 text-left font-semibold">Asset</th>
                  <th className="border-b-2 border-black px-4 py-3 text-right font-semibold">TVL</th>
                  <th className="border-b-2 border-black px-4 py-3 text-right font-semibold">APY</th>
                  <th className="border-b-2 border-black px-4 py-3 text-center font-semibold">Score</th>
                  <th className="border-b-2 border-black px-4 py-3 text-center font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {VAULTS_CONFIG.map((vault) => {
                  const rating = getRatingForVault(vault.id, vault.chain)
                  const tvlUsd = rating?.metrics?.tvlUsd
                  const apy = rating?.metrics?.netApy || rating?.metrics?.apy
                  const formatTVL = (value: number | null | undefined) => {
                    if (!value) return '—'
                    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
                    if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`
                    return `$${value.toFixed(2)}`
                  }
                  return (
                    <tr key={vault.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-semibold">{vault.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 capitalize">{vault.chain}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{vault.asset.symbol}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatTVL(tvlUsd)}</td>
                      <td className="px-4 py-3 text-right font-medium text-green-600">
                        {apy != null ? `${(apy * 100).toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {ratingsLoading ? (
                          <span className="text-xs text-gray-400">Loading…</span>
                        ) : (
                          <VaultRatingBubble
                            rating={rating}
                            vaultId={vault.id}
                            vaultName={vault.name}
                            chain={vault.chain}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Link
                          href={`/vaults?vault=${vault.id}`}
                          className="px-4 py-2 bg-black text-white text-sm font-medium hover:bg-gray-800 transition-colors inline-block"
                        >
                          Deposit →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Morpho Whales with ENS */}
        <div className="border-t border-black pt-8 mt-8">
          <TopENSHolders />
        </div>
      </div>
    </main>
  )
}


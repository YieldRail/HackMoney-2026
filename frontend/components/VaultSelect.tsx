'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { type VaultConfig } from '@/lib/vaults-config'
import { type MorphoVaultDisplayData } from '@/lib/morpho'

interface VaultSelectProps {
  vaults: VaultConfig[]
  selectedVaultId: string
  onChange: (vaultId: string) => void
  morphoData?: MorphoVaultDisplayData | null
  loadingMorphoData?: boolean
}

const getVaultIcon = (type: string | undefined) => {
  if (type === 'lagoon') {
    return (
      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
        L
      </div>
    )
  }
  if (type?.startsWith('morpho')) {
    return (
      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shrink-0">
        <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    )
  }
  return (
    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
      V
    </div>
  )
}

const getChainBadge = (chain: string) => {
  const configs: Record<string, { bg: string; text: string; label: string }> = {
    base: { bg: 'bg-blue-500', text: 'text-white', label: 'Base' },
    avalanche: { bg: 'bg-red-500', text: 'text-white', label: 'Avax' },
    ethereum: { bg: 'bg-gray-700', text: 'text-white', label: 'ETH' },
    arbitrum: { bg: 'bg-blue-600', text: 'text-white', label: 'Arb' },
    optimism: { bg: 'bg-red-600', text: 'text-white', label: 'OP' },
  }
  const cfg = configs[chain] || { bg: 'bg-gray-400', text: 'text-white', label: chain }
  return (
    <span className={`${cfg.bg} ${cfg.text} text-[9px] font-semibold px-1.5 py-0.5 rounded-md leading-none`}>
      {cfg.label}
    </span>
  )
}

export function VaultSelect({ vaults, selectedVaultId, onChange, morphoData, loadingMorphoData }: VaultSelectProps) {
  const [activeTab, setActiveTab] = useState<'lagoon' | 'morpho'>(() => {
    const selected = vaults.find(v => v.id === selectedVaultId)
    return selected?.type?.startsWith('morpho') ? 'morpho' : 'lagoon'
  })
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedVault = vaults.find(v => v.id === selectedVaultId) || vaults[0]

  const lagoonVaults = useMemo(() => vaults.filter(v => v.type === 'lagoon'), [vaults])
  const morphoVaults = useMemo(() => vaults.filter(v => v.type?.startsWith('morpho')), [vaults])
  const currentVaults = activeTab === 'lagoon' ? lagoonVaults : morphoVaults

  const getDisplayName = (vault: VaultConfig, isSelected: boolean = false) => {
    if (isSelected && vault.type?.startsWith('morpho') && morphoData?.name) {
      return morphoData.name
    }
    return vault.name
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const selected = vaults.find(v => v.id === selectedVaultId)
    if (selected) {
      setActiveTab(selected.type?.startsWith('morpho') ? 'morpho' : 'lagoon')
    }
  }, [selectedVaultId, vaults])

  return (
    <div className="space-y-3" ref={dropdownRef}>
      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        <button
          onClick={() => {
            setActiveTab('lagoon')
            setIsOpen(false)
            const selectedInTab = lagoonVaults.find(v => v.id === selectedVaultId)
            if (!selectedInTab && lagoonVaults.length > 0) onChange(lagoonVaults[0].id)
          }}
          className={`flex-1 text-xs font-semibold py-2 px-3 rounded-lg transition-all ${
            activeTab === 'lagoon'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Lagoon Vaults
        </button>
        <button
          onClick={() => {
            setActiveTab('morpho')
            setIsOpen(false)
            const selectedInTab = morphoVaults.find(v => v.id === selectedVaultId)
            if (!selectedInTab && morphoVaults.length > 0) onChange(morphoVaults[0].id)
          }}
          className={`flex-1 text-xs font-semibold py-2 px-3 rounded-lg transition-all ${
            activeTab === 'morpho'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Morpho Vaults V1 & V2
        </button>
      </div>

      {/* Selected Vault / Dropdown Toggle */}
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-gray-300 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
        >
          {getVaultIcon(selectedVault.type)}

          <div className="flex-1 text-left min-w-0">
            <div className="flex items-center gap-2">
              {loadingMorphoData && selectedVault.type?.startsWith('morpho') ? (
                <div className="h-5 w-32 bg-gray-200 rounded animate-pulse"></div>
              ) : (
                <span className="font-semibold text-gray-900 text-sm truncate">
                  {getDisplayName(selectedVault, true)}
                </span>
              )}
              {getChainBadge(selectedVault.chain)}
            </div>
            <span className="text-xs text-gray-400 mt-0.5 block">{selectedVault.asset.symbol}</span>
          </div>

          <svg
            className={`w-5 h-5 text-gray-400 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown */}
        {isOpen && (
          <div className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="max-h-72 overflow-y-auto">
              {currentVaults.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-gray-400">
                  No vaults available
                </div>
              ) : (
                currentVaults.map((vault) => {
                  const isSelected = vault.id === selectedVaultId
                  return (
                    <button
                      key={vault.id}
                      onClick={() => {
                        onChange(vault.id)
                        setIsOpen(false)
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${
                        isSelected ? 'bg-gray-50' : ''
                      }`}
                    >
                      {getVaultIcon(vault.type)}

                      <div className="flex-1 text-left min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium text-sm truncate ${isSelected ? 'text-gray-900' : 'text-gray-700'}`}>
                            {vault.name}
                          </span>
                          {getChainBadge(vault.chain)}
                        </div>
                        <span className="text-xs text-gray-400">{vault.asset.symbol}</span>
                      </div>

                      {isSelected && (
                        <svg className="w-5 h-5 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

'use client'

import { useState, useRef, useEffect } from 'react'
import { type VaultConfig } from '@/lib/vaults-config'
import { type MorphoVaultDisplayData } from '@/lib/morpho'

interface VaultSelectProps {
  vaults: VaultConfig[]
  selectedVaultId: string
  onChange: (vaultId: string) => void
  morphoData?: MorphoVaultDisplayData | null
  loadingMorphoData?: boolean
}

// Vault type logos/icons
const getVaultIcon = (type: string | undefined, chain: string) => {
  if (type === 'lagoon') {
    return (
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold">
        L
      </div>
    )
  }
  if (type?.startsWith('morpho')) {
    return (
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
        <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    )
  }
  return (
    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center text-white text-xs font-bold">
      V
    </div>
  )
}

// Chain icons
const getChainIcon = (chain: string) => {
  switch (chain) {
    case 'base':
      return (
        <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
          <span className="text-white text-[8px] font-bold">B</span>
        </div>
      )
    case 'avalanche':
      return (
        <div className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center">
          <span className="text-white text-[8px] font-bold">A</span>
        </div>
      )
    case 'ethereum':
      return (
        <div className="w-4 h-4 rounded-full bg-gray-700 flex items-center justify-center">
          <span className="text-white text-[8px] font-bold">E</span>
        </div>
      )
    default:
      return null
  }
}

export function VaultSelect({ vaults, selectedVaultId, onChange, morphoData, loadingMorphoData }: VaultSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedVault = vaults.find(v => v.id === selectedVaultId) || vaults[0]

  // Get display name - prefer Morpho API name for Morpho vaults
  const getDisplayName = (vault: VaultConfig, isSelected: boolean = false) => {
    if (isSelected && vault.type?.startsWith('morpho') && morphoData?.name) {
      return morphoData.name
    }
    return vault.name
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Selected Vault Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-gray-300 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
      >
        {getVaultIcon(selectedVault.type, selectedVault.chain)}

        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2">
            {loadingMorphoData && selectedVault.type?.startsWith('morpho') ? (
              <div className="h-5 w-32 bg-gray-200 rounded animate-pulse"></div>
            ) : (
              <span className="font-semibold text-gray-900 truncate">
                {getDisplayName(selectedVault, true)}
              </span>
            )}
            {getChainIcon(selectedVault.chain)}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              selectedVault.type === 'lagoon' ? 'bg-blue-100 text-blue-700' :
              selectedVault.type?.startsWith('morpho') ? 'bg-purple-100 text-purple-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {selectedVault.type === 'lagoon' ? 'Lagoon' :
               selectedVault.type === 'morpho-v1' ? 'Morpho V1' :
               selectedVault.type === 'morpho-v2' ? 'Morpho V2' : 'Vault'}
            </span>
            <span className="text-xs text-gray-400">{selectedVault.asset.symbol}</span>
          </div>
        </div>

        <svg
          className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="max-h-80 overflow-y-auto">
            {vaults.map((vault) => {
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
                  {getVaultIcon(vault.type, vault.chain)}

                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium truncate ${isSelected ? 'text-gray-900' : 'text-gray-700'}`}>
                        {vault.name}
                      </span>
                      {getChainIcon(vault.chain)}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        vault.type === 'lagoon' ? 'bg-blue-100 text-blue-700' :
                        vault.type?.startsWith('morpho') ? 'bg-purple-100 text-purple-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {vault.type === 'lagoon' ? 'Lagoon' :
                         vault.type === 'morpho-v1' ? 'Morpho V1' :
                         vault.type === 'morpho-v2' ? 'Morpho V2' : 'Vault'}
                      </span>
                      <span className="text-xs text-gray-400">{vault.asset.symbol}</span>
                    </div>
                  </div>

                  {isSelected && (
                    <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

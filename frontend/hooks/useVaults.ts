import { useState, useEffect } from 'react'
import { VAULTS_CONFIG, type VaultConfig } from '@/lib/vaults-config'
import { fetchMorphoVaults, type MorphoVault } from '@/lib/morpho'

export function useVaults() {
  const [allVaults, setAllVaults] = useState<VaultConfig[]>(VAULTS_CONFIG)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadMorphoVaults() {
      try {
        setLoading(true)
        const baseVaults = await fetchMorphoVaults(8453) // Base network
        
        const morphoVaultConfigs: VaultConfig[] = baseVaults.slice(0, 2).map((vault) => ({
          id: vault.id,
          name: vault.name,
          address: vault.address,
          chain: vault.chain as any,
          chainId: vault.chainId,
          asset: {
            address: vault.asset,
            symbol: vault.assetSymbol,
            decimals: vault.assetDecimals,
          },
          depositRouter: process.env.NEXT_PUBLIC_BASE_DEPOSIT_ROUTER_ADDRESS || '0xd3E807e3eDef90a380a947a5464dD34bb1Cb9cC7',
          hasSettlement: false,
          type: vault.version === 'v1' ? 'morpho-v1' : 'morpho-v2',
          apy: vault.apy,
          tvl: vault.tvl,
        }))

        setAllVaults([...VAULTS_CONFIG, ...morphoVaultConfigs])
      } catch (error) {
        console.error('Error loading Morpho vaults:', error)
        setAllVaults(VAULTS_CONFIG)
      } finally {
        setLoading(false)
      }
    }

    loadMorphoVaults()
  }, [])

  return { vaults: allVaults, loading }
}


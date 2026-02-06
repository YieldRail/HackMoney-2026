import { VAULTS_CONFIG, type VaultConfig } from '@/lib/vaults-config'

export function useVaults() {
  return { vaults: VAULTS_CONFIG as VaultConfig[], loading: false }
}

import { Address, createPublicClient, http } from 'viem'
import { base } from 'viem/chains'
import ERC4626_ABI from './erc4626-abi.json'
import ERC20_ABI from './erc20-abi.json'

export interface MorphoVault {
  id: string
  address: Address
  name: string
  symbol: string
  asset: Address
  assetSymbol: string
  assetDecimals: number
  chainId: number
  chain: string
  version: 'v1' | 'v2'
  apy?: number
  tvl?: string
  curator?: Address
}

function getRpcUrl(chainId: number): string {
  if (chainId === 8453) {
    return process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://base.meowrpc.com'
  }
  return 'https://base.meowrpc.com'
}

export async function fetchMorphoVaults(chainId: number): Promise<MorphoVault[]> {
  if (chainId !== 8453) return []
  
  try {
    const client = createPublicClient({
      chain: base,
      transport: http(getRpcUrl(chainId)),
    })
    
    const testVaults = getTestMorphoVaults(chainId)
    const vaults: MorphoVault[] = []
    
    for (const testVault of testVaults) {
      try {
        const [name, symbol, asset, totalAssets, decimals] = await Promise.all([
          client.readContract({
            address: testVault.address,
            abi: ERC4626_ABI,
            functionName: 'name',
          }).catch(() => testVault.name),
          client.readContract({
            address: testVault.address,
            abi: ERC4626_ABI,
            functionName: 'symbol',
          }).catch(() => testVault.symbol),
          client.readContract({
            address: testVault.address,
            abi: ERC4626_ABI,
            functionName: 'asset',
          }).catch(() => testVault.asset),
          client.readContract({
            address: testVault.address,
            abi: ERC4626_ABI,
            functionName: 'totalAssets',
          }).catch(() => 0n),
          client.readContract({
            address: testVault.address,
            abi: ERC4626_ABI,
            functionName: 'decimals',
          }).catch(() => 18),
        ])
        
        let assetSymbol = testVault.assetSymbol
        let assetDecimals = testVault.assetDecimals
        
        if (asset && asset !== '0x0000000000000000000000000000000000000000') {
          try {
            const [symbolResult, decimalsResult] = await Promise.all([
              client.readContract({
                address: asset as Address,
                abi: ERC20_ABI,
                functionName: 'symbol',
              }).catch(() => null),
              client.readContract({
                address: asset as Address,
                abi: ERC20_ABI,
                functionName: 'decimals',
              }).catch(() => null),
            ])
            if (symbolResult) assetSymbol = symbolResult as string
            if (decimalsResult) assetDecimals = decimalsResult as number
          } catch (e) {
            // Ignore asset fetch errors
          }
        }
        
        vaults.push({
          ...testVault,
          name: name as string || testVault.name,
          symbol: symbol as string || testVault.symbol,
          asset: asset as Address || testVault.asset,
          assetSymbol,
          assetDecimals,
          tvl: totalAssets ? (Number(totalAssets) / 10 ** assetDecimals).toString() : undefined,
        })
      } catch (error) {
        console.warn(`Failed to fetch data for vault ${testVault.address}:`, error)
        vaults.push(testVault)
      }
    }
    
    return vaults
  } catch (error) {
    console.error('Error fetching Morpho vaults:', error)
    return getTestMorphoVaults(chainId)
  }
}

function getTestMorphoVaults(chainId: number): MorphoVault[] {
  if (chainId !== 8453) return []
  
  return [
    {
      id: 'morpho-base-usdc-v2',
      address: '0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A' as Address,
      name: 'Morpho USDC Vault V2',
      symbol: 'mvUSDC',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
      assetSymbol: 'USDC',
      assetDecimals: 6,
      chainId: 8453,
      chain: 'base',
      version: 'v2',
    },
  ]
}

export async function fetchMorphoVaultData(vaultAddress: Address, chainId: number): Promise<{
  apy?: number
  tvl?: string
  totalAssets?: bigint
  totalSupply?: bigint
  sharePrice?: bigint
} | null> {
  try {
    const client = createPublicClient({
      chain: chainId === 8453 ? base : base,
      transport: http(getRpcUrl(chainId)),
    })
    
    const [totalAssets, totalSupply] = await Promise.all([
      client.readContract({
        address: vaultAddress,
        abi: ERC4626_ABI,
        functionName: 'totalAssets',
      }).catch(() => 0n),
      client.readContract({
        address: vaultAddress,
        abi: ERC4626_ABI,
        functionName: 'totalSupply',
      }).catch(() => 0n),
    ])
    
    let sharePrice: bigint | undefined
    if (totalSupply > 0n) {
      try {
        const oneShare = BigInt(10 ** 18)
        sharePrice = await client.readContract({
          address: vaultAddress,
          abi: ERC4626_ABI,
          functionName: 'convertToAssets',
          args: [oneShare],
        }) as bigint
      } catch (e) {
        // Ignore share price calculation errors
      }
    }
    
    return {
      totalAssets: totalAssets as bigint,
      totalSupply: totalSupply as bigint,
      sharePrice,
      tvl: totalAssets ? totalAssets.toString() : undefined,
    }
  } catch (error) {
    console.error('Error fetching Morpho vault data:', error)
    return null
  }
}

function chainIdToChainName(chainId: number): string {
  const chainMap: Record<number, string> = {
    1: 'ethereum',
    8453: 'base',
    10: 'optimism',
    42161: 'arbitrum',
    56: 'bsc',
    43114: 'avalanche',
  }
  return chainMap[chainId] || 'unknown'
}

export function isMorphoVault(vaultId: string): boolean {
  return vaultId.startsWith('morpho-')
}

export function getMorphoVaultVersion(vaultId: string): 'v1' | 'v2' | null {
  if (!isMorphoVault(vaultId)) return null
  const parts = vaultId.split('-')
  return parts[1] === 'v1' ? 'v1' : parts[1] === 'v2' ? 'v2' : null
}


import { Address, createPublicClient, http } from 'viem'
import { mainnet, base, arbitrum } from 'viem/chains'
import ERC4626_ABI from './erc4626-abi.json'
import ERC20_ABI from './erc20-abi.json'

const MORPHO_API_URL = 'https://api.morpho.org/graphql'

// Cache configuration
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes
const VAULT_CACHE_KEY = 'morpho_vault_cache'
const POSITION_CACHE_KEY = 'morpho_position_cache'

interface CacheEntry<T> {
  data: T
  timestamp: number
}

function getFromCache<T>(key: string, subKey: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const cache = localStorage.getItem(key)
    if (!cache) return null
    const parsed = JSON.parse(cache) as Record<string, CacheEntry<T>>
    const entry = parsed[subKey]
    if (!entry) return null
    if (Date.now() - entry.timestamp > CACHE_DURATION) {
      // Cache expired, remove it
      delete parsed[subKey]
      localStorage.setItem(key, JSON.stringify(parsed))
      return null
    }
    return entry.data
  } catch {
    return null
  }
}

function setToCache<T>(key: string, subKey: string, data: T): void {
  if (typeof window === 'undefined') return
  try {
    const cache = localStorage.getItem(key)
    const parsed = cache ? JSON.parse(cache) : {}
    parsed[subKey] = { data, timestamp: Date.now() }
    localStorage.setItem(key, JSON.stringify(parsed))
  } catch {
    // Ignore cache errors
  }
}

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
  tvlUsd?: string
  curator?: Address
  curatorName?: string
  performanceFee?: number
  dailyApy?: number
  weeklyApy?: number
  monthlyApy?: number
}

export interface MorphoApiVaultData {
  address: string
  name: string
  symbol: string
  totalAssetsUsd: number
  totalAssets: string
  totalSupply: string
  avgApy: number
  avgNetApy: number
  dailyApy: number
  weeklyApy: number
  monthlyApy: number
  performanceFee: number
  curator?: {
    name: string
    address: string
  }
  asset: {
    address: string
    symbol: string
    decimals: number
  }
}

export interface MorphoUserPosition {
  shares: string
  assets: string
  assetsUsd: number
  vault: {
    address: string
    name: string
    symbol: string
  }
}

function getRpcUrl(chainId: number): string {
  switch (chainId) {
    case 1:
      return process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL || 'https://eth.llamarpc.com'
    case 8453:
      return process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://base.meowrpc.com'
    case 42161:
      return process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc'
    default:
      return 'https://eth.llamarpc.com'
  }
}

function getChainForId(chainId: number) {
  switch (chainId) {
    case 1: return mainnet
    case 8453: return base
    case 42161: return arbitrum
    default: return mainnet
  }
}

// Morpho GraphQL API queries
async function morphoGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(MORPHO_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new Error(`Morpho API error: ${response.status}`)
  }

  const result = await response.json()

  // Handle partial errors gracefully - if we have data, return it even if some vaults had errors
  // This is common when querying multiple vaults where some addresses might not exist
  if (result.errors && !result.data) {
    throw new Error(`GraphQL error: ${result.errors[0]?.message}`)
  }

  // Log partial errors for debugging but don't throw
  if (result.errors && result.data) {
    console.log(`GraphQL partial errors (${result.errors.length} vaults not found, but got data for others)`)
  }

  return result.data
}

// Fetch vault data from Morpho API (tries V1 first, then V2)
export async function fetchMorphoVaultFromApi(vaultAddress: string, chainId: number): Promise<MorphoApiVaultData | null> {
  // Check cache first
  const cacheKey = `${vaultAddress.toLowerCase()}_${chainId}`
  const cached = getFromCache<MorphoApiVaultData>(VAULT_CACHE_KEY, cacheKey)
  if (cached) {
    console.log('Using cached Morpho vault data')
    return cached
  }

  // Try V1 vault query first (most Morpho vaults are V1)
  const v1Query = `
    query GetVaultV1($address: String!, $chainId: Int) {
      vaultByAddress(address: $address, chainId: $chainId) {
        address
        name
        symbol
        state {
          totalAssets
          totalAssetsUsd
          totalSupply
          apy
          netApy
          fee
        }
        asset {
          address
          symbol
          decimals
        }
      }
    }
  `

  try {
    const v1Data = await morphoGraphQL<{ vaultByAddress: any }>(v1Query, {
      address: vaultAddress.toLowerCase(),
      chainId,
    })

    if (v1Data.vaultByAddress) {
      const vault = v1Data.vaultByAddress
      const state = vault.state || {}
      const result: MorphoApiVaultData = {
        address: vault.address,
        name: vault.name,
        symbol: vault.symbol,
        totalAssetsUsd: state.totalAssetsUsd || 0,
        totalAssets: state.totalAssets || '0',
        totalSupply: state.totalSupply || '0',
        avgApy: state.apy || 0,
        avgNetApy: state.netApy || 0,
        dailyApy: state.apy || 0,
        weeklyApy: state.apy || 0,
        monthlyApy: state.apy || 0,
        performanceFee: state.fee || 0,
        curator: undefined,
        asset: {
          address: vault.asset?.address || '',
          symbol: vault.asset?.symbol || 'UNKNOWN',
          decimals: vault.asset?.decimals || 18,
        },
      }
      // Cache successful result
      setToCache(VAULT_CACHE_KEY, cacheKey, result)
      return result
    }
  } catch (error: any) {
    // Check if it's a NOT_FOUND error - if so, try V2
    const isNotFound = error?.message?.includes('NOT_FOUND') || error?.message?.includes('cannot find')
    if (!isNotFound) {
      console.error('V1 vault query error:', error)
    } else {
      console.log('V1 vault not found, trying V2')
    }
  }

  // Try V2 vault query as fallback
  const v2Query = `
    query GetVaultV2($address: String!, $chainId: Int!) {
      vaultV2ByAddress(address: $address, chainId: $chainId) {
        address
        name
        symbol
        totalAssets
        totalAssetsUsd
        totalSupply
        avgApy
        avgNetApy
        performanceFee
        asset {
          address
          symbol
          decimals
        }
      }
    }
  `

  try {
    const v2Data = await morphoGraphQL<{ vaultV2ByAddress: any }>(v2Query, {
      address: vaultAddress.toLowerCase(),
      chainId,
    })

    if (v2Data.vaultV2ByAddress) {
      const vault = v2Data.vaultV2ByAddress
      const result: MorphoApiVaultData = {
        address: vault.address,
        name: vault.name,
        symbol: vault.symbol,
        totalAssetsUsd: vault.totalAssetsUsd || 0,
        totalAssets: vault.totalAssets || '0',
        totalSupply: vault.totalSupply || '0',
        avgApy: vault.avgApy || 0,
        avgNetApy: vault.avgNetApy || 0,
        dailyApy: vault.avgApy || 0,
        weeklyApy: vault.avgApy || 0,
        monthlyApy: vault.avgApy || 0,
        performanceFee: vault.performanceFee || 0,
        curator: undefined,
        asset: {
          address: vault.asset?.address || '',
          symbol: vault.asset?.symbol || 'UNKNOWN',
          decimals: vault.asset?.decimals || 18,
        },
      }
      // Cache successful result
      setToCache(VAULT_CACHE_KEY, cacheKey, result)
      return result
    }
  } catch (error) {
    console.error('V2 vault query also failed:', error)
  }

  return null
}

// Fetch user's position in a Morpho vault (tries V1 and V2)
export async function fetchMorphoUserPosition(
  userAddress: string,
  vaultAddress: string,
  chainId: number
): Promise<MorphoUserPosition | null> {
  // Try V1 position query first
  const v1Query = `
    query GetUserVaultPosition($userAddress: String!, $vaultAddress: String!, $chainId: Int) {
      vaultPosition(userAddress: $userAddress, vaultAddress: $vaultAddress, chainId: $chainId) {
        state {
          shares
          assets
          assetsUsd
        }
        vault {
          address
          name
          symbol
        }
      }
    }
  `

  try {
    const v1Data = await morphoGraphQL<{ vaultPosition: any }>(v1Query, {
      userAddress: userAddress.toLowerCase(),
      vaultAddress: vaultAddress.toLowerCase(),
      chainId,
    })

    if (v1Data.vaultPosition?.state) {
      const position = v1Data.vaultPosition
      const state = position.state
      return {
        shares: state.shares || '0',
        assets: state.assets || '0',
        assetsUsd: state.assetsUsd || 0,
        vault: {
          address: position.vault?.address || vaultAddress,
          name: position.vault?.name || 'Morpho Vault',
          symbol: position.vault?.symbol || 'mvUSDC',
        },
      }
    }
  } catch (error: any) {
    const isNotFound = error?.message?.includes('NOT_FOUND') || error?.message?.includes('cannot find')
    if (!isNotFound) {
      console.error('V1 position query error:', error)
    }
  }

  // Try V2 position query as fallback
  const v2Query = `
    query GetUserVaultPositionV2($userAddress: String!, $vaultAddress: String!, $chainId: Int!) {
      vaultV2PositionByAddress(userAddress: $userAddress, vaultAddress: $vaultAddress, chainId: $chainId) {
        shares
        assets
        assetsUsd
        vault {
          address
          name
          symbol
        }
      }
    }
  `

  try {
    const v2Data = await morphoGraphQL<{ vaultV2PositionByAddress: any }>(v2Query, {
      userAddress: userAddress.toLowerCase(),
      vaultAddress: vaultAddress.toLowerCase(),
      chainId,
    })

    if (v2Data.vaultV2PositionByAddress) {
      const position = v2Data.vaultV2PositionByAddress
      return {
        shares: position.shares || '0',
        assets: position.assets || '0',
        assetsUsd: position.assetsUsd || 0,
        vault: {
          address: position.vault?.address || vaultAddress,
          name: position.vault?.name || 'Morpho Vault',
          symbol: position.vault?.symbol || 'mvUSDC',
        },
      }
    }
  } catch (error) {
    // Position doesn't exist - this is expected for users who haven't deposited
    console.log('User position not found')
  }

  return null
}

// Fetch all vault data needed for display
export interface MorphoVaultDisplayData {
  name: string
  symbol: string
  tvl: string
  tvlUsd: string
  apy: number
  netApy: number
  dailyApy: number
  weeklyApy: number
  monthlyApy: number
  performanceFee: number
  curatorName?: string
  assetSymbol: string
  assetDecimals: number
  totalAssets: string
  totalSupply: string
  sharePrice?: string
  userShares?: string
  userAssets?: string
  userAssetsUsd?: number
}

export async function fetchMorphoVaultDisplayData(
  vaultAddress: string,
  chainId: number,
  userAddress?: string
): Promise<MorphoVaultDisplayData | null> {
  try {
    // Fetch vault data from API
    const apiData = await fetchMorphoVaultFromApi(vaultAddress, chainId)

    if (!apiData) {
      // Fallback to on-chain data if API fails
      const onChainData = await fetchMorphoVaultData(vaultAddress as Address, chainId)
      if (!onChainData) return null

      return {
        name: 'Morpho Vault',
        symbol: 'mvUSDC',
        tvl: onChainData.tvl || '0',
        tvlUsd: '0',
        apy: 0,
        netApy: 0,
        dailyApy: 0,
        weeklyApy: 0,
        monthlyApy: 0,
        performanceFee: 0,
        assetSymbol: 'USDC',
        assetDecimals: 6,
        totalAssets: onChainData.totalAssets?.toString() || '0',
        totalSupply: onChainData.totalSupply?.toString() || '0',
        sharePrice: onChainData.sharePrice?.toString(),
      }
    }

    const displayData: MorphoVaultDisplayData = {
      name: apiData.name,
      symbol: apiData.symbol,
      tvl: apiData.totalAssets,
      tvlUsd: apiData.totalAssetsUsd.toFixed(2),
      apy: apiData.avgApy * 100, // Convert to percentage
      netApy: apiData.avgNetApy * 100,
      dailyApy: apiData.dailyApy * 100,
      weeklyApy: apiData.weeklyApy * 100,
      monthlyApy: apiData.monthlyApy * 100,
      performanceFee: apiData.performanceFee * 100,
      curatorName: apiData.curator?.name,
      assetSymbol: apiData.asset.symbol,
      assetDecimals: apiData.asset.decimals,
      totalAssets: apiData.totalAssets,
      totalSupply: apiData.totalSupply,
    }

    // Calculate share price
    if (BigInt(apiData.totalSupply) > 0n && BigInt(apiData.totalAssets) > 0n) {
      const sharePrice = (BigInt(apiData.totalAssets) * BigInt(10 ** 18)) / BigInt(apiData.totalSupply)
      displayData.sharePrice = sharePrice.toString()
    }

    // Fetch user position if address provided
    if (userAddress) {
      const userPosition = await fetchMorphoUserPosition(userAddress, vaultAddress, chainId)
      if (userPosition) {
        displayData.userShares = userPosition.shares
        displayData.userAssets = userPosition.assets
        displayData.userAssetsUsd = userPosition.assetsUsd
      }
    }

    return displayData
  } catch (error) {
    console.error('Error fetching Morpho vault display data:', error)
    return null
  }
}

export async function fetchMorphoVaults(chainId: number): Promise<MorphoVault[]> {
  try {
    const client = createPublicClient({
      chain: getChainForId(chainId),
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
  const allVaults: MorphoVault[] = [
    {
      id: 'morpho-base-usdc-v2',
      address: '0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A' as Address,
      name: 'Spark USDC Vault',
      symbol: 'mvUSDC',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
      assetSymbol: 'USDC',
      assetDecimals: 6,
      chainId: 8453,
      chain: 'base',
      version: 'v2',
    },
    {
      id: 'morpho-ethereum-steakhouse-usdc',
      address: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB' as Address,
      name: 'Steakhouse USDC',
      symbol: 'steakUSDC',
      asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
      assetSymbol: 'USDC',
      assetDecimals: 6,
      chainId: 1,
      chain: 'ethereum',
      version: 'v2',
    },
    {
      id: 'morpho-ethereum-usdc-v2',
      address: '0xc582F04d8a82795aa2Ff9c8bb4c1c889fe7b754e' as Address,
      name: 'Gauntlet USDC Frontier',
      symbol: 'mvUSDC',
      asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
      assetSymbol: 'USDC',
      assetDecimals: 6,
      chainId: 1,
      chain: 'ethereum',
      version: 'v2',
    },
    {
      id: 'morpho-base-usdc-v2-2',
      address: '0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2' as Address,
      name: 'Steakhouse Prime USDC',
      symbol: 'mvUSDC',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
      assetSymbol: 'USDC',
      assetDecimals: 6,
      chainId: 8453,
      chain: 'base',
      version: 'v2',
    },
    {
      id: 'morpho-arbitrum-usdc',
      address: '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027' as Address,
      name: 'Hyperithm USDC',
      symbol: 'mvUSDC',
      asset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address,
      assetSymbol: 'USDC',
      assetDecimals: 6,
      chainId: 42161,
      chain: 'arbitrum',
      version: 'v2',
    },
  ]
  return allVaults.filter(v => v.chainId === chainId)
}

// Top Morpho vaults across all chains for whale tracking (reduced list to avoid API timeout)
function getAllTopMorphoVaults(): { address: string; chainId: number; name: string }[] {
  return [
    // ============ ETHEREUM MAINNET - TOP VAULTS BY TVL ============
    { address: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB', chainId: 1, name: 'Steakhouse USDC' },
    { address: '0x4881Ef0BF6d2365D3dd6499ccd7532bcdBCE0658', chainId: 1, name: 'Gauntlet USDC Core' },
    { address: '0x78Fc2c2eD1A4cDb5402365934aE5648aDAd094d0', chainId: 1, name: 'Re7 WETH' },
    { address: '0xd63070114470f685b75B74D60EEc7c1113d33a3D', chainId: 1, name: 'Usual Boosted USDC' },
    { address: '0x73e65DBD630f90604062f6E02fAb9138e713edD9', chainId: 1, name: 'Spark USDC' },

    // ============ BASE - TOP VAULTS BY TVL ============
    { address: '0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A', chainId: 8453, name: 'Moonwell Flagship USDC' },
    { address: '0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca', chainId: 8453, name: 'Gauntlet USDC Prime' },
    { address: '0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61', chainId: 8453, name: 'Gauntlet WETH Prime' },
    { address: '0x5496b42ad0deCE1E71bbF7f36FfC8913B94Cd930', chainId: 8453, name: 'Spark USDC' },
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
      chain: getChainForId(chainId),
      transport: http(getRpcUrl(chainId)),
    })
    
    const [totalAssets, totalSupply] = await Promise.all([
      client.readContract({
        address: vaultAddress,
        abi: ERC4626_ABI,
        functionName: 'totalAssets',
      }).catch(() => 0n) as Promise<bigint>,
      client.readContract({
        address: vaultAddress,
        abi: ERC4626_ABI,
        functionName: 'totalSupply',
      }).catch(() => 0n) as Promise<bigint>,
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

// ============================================
// ENS Integration: Top Vault Depositors Query
// ============================================

export interface VaultDepositor {
  address: string
  shares: string
  assets: string
  assetsUsd: number
}

export interface TopDepositorsResult {
  depositors: VaultDepositor[]
  totalDepositors: number
  vaultName: string
  vaultSymbol: string
  assetSymbol: string
  assetDecimals: number
}

const TOP_DEPOSITORS_CACHE_KEY = 'morpho_top_depositors_cache'
const TOP_DEPOSITORS_CACHE_DURATION = 10 * 60 * 1000 // 10 minutes

export async function fetchTopVaultDepositors(
  vaultAddress: string,
  chainId: number,
  limit: number = 20,
  minAssetsUsd: number = 100 // Minimum $100 position to show
): Promise<TopDepositorsResult | null> {
  // Check cache first
  const cacheKey = `${vaultAddress.toLowerCase()}_${chainId}_${limit}`
  const cached = getFromCache<TopDepositorsResult>(TOP_DEPOSITORS_CACHE_KEY, cacheKey)
  if (cached) {
    console.log('Using cached top depositors data')
    return cached
  }

  // First fetch vault info
  let vaultName = 'Morpho Vault'
  let vaultSymbol = 'mvToken'
  let assetSymbol = 'USDC'
  let assetDecimals = 6

  try {
    const vaultData = await fetchMorphoVaultFromApi(vaultAddress, chainId)
    if (vaultData) {
      vaultName = vaultData.name
      vaultSymbol = vaultData.symbol
      assetSymbol = vaultData.asset.symbol
      assetDecimals = vaultData.asset.decimals
    }
  } catch (e) {
    console.log('Could not fetch vault info, using defaults')
  }

  // Use the vaultPositions top-level query (correct Morpho API structure)
  // Note: vaultAddress is unique per chain, so no chainId filter needed
  const positionsQuery = `
    query GetVaultPositions($first: Int!) {
      vaultPositions(
        first: $first
        orderBy: Shares
        orderDirection: Desc
        where: { vaultAddress_in: ["${vaultAddress.toLowerCase()}"] }
      ) {
        items {
          user {
            address
          }
          state {
            shares
            assets
            assetsUsd
          }
        }
        pageInfo {
          countTotal
        }
      }
    }
  `

  try {
    const data = await morphoGraphQL<{ vaultPositions: any }>(positionsQuery, {
      first: limit * 2, // Fetch more to filter by minAssetsUsd
    })

    if (data.vaultPositions?.items) {
      const positions = data.vaultPositions.items
        .filter((p: any) => (p.state?.assetsUsd || 0) >= minAssetsUsd)
        .slice(0, limit)
        .map((p: any) => ({
          address: p.user.address,
          shares: p.state?.shares || '0',
          assets: p.state?.assets || '0',
          assetsUsd: p.state?.assetsUsd || 0,
        }))

      const result: TopDepositorsResult = {
        depositors: positions,
        totalDepositors: data.vaultPositions.pageInfo?.countTotal || positions.length,
        vaultName,
        vaultSymbol,
        assetSymbol,
        assetDecimals,
      }

      if (positions.length > 0) {
        setToCache(TOP_DEPOSITORS_CACHE_KEY, cacheKey, result)
      }
      return result
    }
  } catch (error: any) {
    console.error('vaultPositions query error:', error)
  }

  return null
}

// ============================================
// Cross-Vault Whale Aggregation for Homepage
// ============================================

export interface AggregatedWhale {
  address: string
  totalAssetsUsd: number
  vaultPositions: {
    vaultAddress: string
    vaultName: string
    vaultSymbol: string
    assets: string
    assetsUsd: number
    assetSymbol: string
    assetDecimals: number
  }[]
}

const AGGREGATED_WHALES_CACHE_KEY = 'morpho_aggregated_whales_cache'

// Simple query to fetch top vault positions across ALL Morpho vaults
export async function fetchTopVaultPositions(
  limit: number = 200
): Promise<AggregatedWhale[]> {
  // Check cache first
  const cacheKey = `top_positions_${limit}`
  const cached = getFromCache<AggregatedWhale[]>(AGGREGATED_WHALES_CACHE_KEY, cacheKey)
  if (cached) {
    console.log('Using cached top vault positions')
    return cached
  }

  const query = `
    query GetTopVaultDepositors($first: Int!) {
      vaultPositions(
        first: $first
        orderBy: Shares
        orderDirection: Desc
      ) {
        items {
          user {
            address
          }
          vault {
            address
            name
            symbol
            chain {
              id
            }
            asset {
              symbol
              decimals
            }
          }
          state {
            shares
            assets
            assetsUsd
          }
        }
        pageInfo {
          countTotal
        }
      }
    }
  `

  try {
    console.log(`Fetching top ${limit} vault positions across all Morpho vaults...`)
    const data = await morphoGraphQL<{ vaultPositions: any }>(query, { first: limit })

    if (!data.vaultPositions?.items) {
      console.log('No positions found')
      return []
    }

    console.log(`Found ${data.vaultPositions.items.length} positions (total: ${data.vaultPositions.pageInfo?.countTotal})`)

    // Aggregate by user address
    const whaleMap = new Map<string, AggregatedWhale>()

    for (const item of data.vaultPositions.items) {
      const userAddress = item.user.address.toLowerCase()
      const assetsUsd = item.state?.assetsUsd || 0

      if (assetsUsd < 100) continue // Skip tiny positions

      if (!whaleMap.has(userAddress)) {
        whaleMap.set(userAddress, {
          address: item.user.address,
          totalAssetsUsd: 0,
          vaultPositions: [],
        })
      }

      const chainId = item.vault?.chain?.id || 1
      const chainName = chainId === 8453 ? 'Base' : chainId === 1 ? 'Ethereum' : `Chain ${chainId}`

      const whale = whaleMap.get(userAddress)!
      whale.totalAssetsUsd += assetsUsd
      whale.vaultPositions.push({
        vaultAddress: item.vault?.address || '',
        vaultName: `${item.vault?.name || 'Morpho Vault'} (${chainName})`,
        vaultSymbol: item.vault?.symbol || 'mvToken',
        assets: item.state?.assets || '0',
        assetsUsd: assetsUsd,
        assetSymbol: item.vault?.asset?.symbol || 'USDC',
        assetDecimals: item.vault?.asset?.decimals || 6,
      })
    }

    // Convert to array and sort by total
    const whales = Array.from(whaleMap.values())
      .sort((a, b) => b.totalAssetsUsd - a.totalAssetsUsd)

    console.log(`Found ${whales.length} unique addresses`)

    if (whales.length > 0) {
      setToCache(AGGREGATED_WHALES_CACHE_KEY, cacheKey, whales)
    }

    return whales
  } catch (error) {
    console.error('Error fetching top vault positions:', error)
    return []
  }
}

// Legacy function - now uses the simpler query
export async function fetchAggregatedWhales(
  _chainId: number = 8453,
  limit: number = 50,
  _minTotalUsd: number = 1000
): Promise<AggregatedWhale[]> {
  return fetchTopVaultPositions(limit * 2)
}

// Also export a function to fetch top vaults list from Morpho API
export async function fetchTopMorphoVaults(minTvlUsd: number = 1000000): Promise<{ address: string; name: string; chainId: number; tvlUsd: number }[]> {
  const query = `
    query GetTopVaults($first: Int!) {
      vaults(
        first: $first
        orderBy: TotalAssetsUsd
        orderDirection: Desc
      ) {
        items {
          address
          name
          symbol
          chain {
            id
          }
          state {
            totalAssetsUsd
          }
        }
      }
    }
  `

  try {
    const data = await morphoGraphQL<{ vaults: any }>(query, { first: 100 })

    if (!data.vaults?.items) {
      return []
    }

    return data.vaults.items
      .filter((v: any) => (v.state?.totalAssetsUsd || 0) >= minTvlUsd)
      .map((v: any) => ({
        address: v.address,
        name: v.name || 'Morpho Vault',
        chainId: v.chain?.id || 1,
        tvlUsd: v.state?.totalAssetsUsd || 0,
      }))
  } catch (error) {
    console.error('Error fetching top vaults:', error)
    return []
  }
}


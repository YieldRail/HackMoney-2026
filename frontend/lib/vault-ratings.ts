export interface UserAnalytics {
  totalUsers: number
  activeHolders: number
  exitedUsers: number
  avgHoldingDays: number
  medianHoldingDays: number
  holdersOver30Days: number
  holdersOver90Days: number
  holdersOver180Days: number
  quickExiters: number
  quickExitRate: number
  retentionRate: number
  churnRate: number
  avgDepositsPerUser: number
  usersWithMultipleDeposits: number
  totalDepositedUsd?: number
  totalWithdrawnUsd?: number
  trustScore: number
  transactionCount?: number
  longTermHolders?: Array<{
    address: string
    holdingDays: number
    deposits: number
    totalDepositedUsd?: number
  }>
  smartDepositors?: Array<{
    address: string
    holdingDays: number
    deposits: number
    totalDepositedUsd?: number
  }>
  likelyFarmers?: Array<{
    address: string
    daysHeld: number
    deposits: number
    withdrawals: number
    volumeUsd?: number
  }>
}

export interface VaultRatingMetrics {
  tvl?: string
  tvlUsd?: number | null
  totalSupply?: string
  apr7d?: number | null
  apr30d?: number | null
  aprAll?: number | null
  aprBase?: number | null
  pricePerShare?: number | null
  pricePerShareUsd?: number | null
  highWaterMark?: number | null
  vaultPaused?: boolean
  vaultState?: string
  isWhitelistActivated?: boolean
  assetDepeg?: boolean | null
  managementFee?: number | null
  performanceFee?: number | null
  underlyingPrice?: number | null
  underlyingSymbol?: string
  underlyingDecimals?: number
  lagoonName?: string
  lagoonSymbol?: string
  lagoonDescription?: string
  lagoonCurators?: string[]
  lagoonVersion?: string | null
  hasAirdrops?: boolean
  hasIncentives?: boolean
  logoUrl?: string
  userAnalytics?: UserAnalytics | null
  apy?: number | null
  netApy?: number | null
  netApyWithoutRewards?: number | null
  avgApy?: number | null
  avgNetApy?: number | null
  dailyApy?: number | null
  weeklyApy?: number | null
  monthlyApy?: number | null
  maxApy?: number | null
  sharePrice?: number | null
  sharePriceUsd?: number | null
  lastTotalAssets?: string | null
  listed?: boolean
  featured?: boolean
  curator?: string | null
  owner?: string | null
  guardian?: string | null
  feeRecipient?: string | null
  timelock?: string | null
  creationTimestamp?: string | null
  idleAssets?: string | null
  idleAssetsUsd?: number | null
  idleRatio?: number | null
  liquidity?: string | null
  liquidityUsd?: number | null
  liquidityRatio?: number | null
  positionCount?: number | null
  rewards?: Array<{ symbol?: string; apr?: number; yearlyTokens?: string }> | null
  totalRewardsApr?: number | null
  allocationCount?: number | null
  activeMarkets?: number | null
  totalSuppliedUsd?: number | null
  totalCapUsd?: number | null
  capUtilization?: number | null
  warningCount?: number | null
  warnings?: Array<{ type?: string; level?: string }> | null
  description?: string | null
  curatorInfo?: { name?: string; image?: string; url?: string; verified?: boolean } | null
  morphoName?: string
  morphoSymbol?: string
  source?: string
}

export interface VaultRatingScoreBreakdown {
  capital?: number | null
  performance?: number | null
  risk?: number | null
  userTrust?: number | null
}

export interface VaultRating {
  vault_id: string
  vault_name?: string
  vault_address?: string
  chain?: string
  vault_type?: 'lagoon' | 'morpho'
  asset_symbol?: string
  metrics: VaultRatingMetrics
  score?: number | null
  score_breakdown?: VaultRatingScoreBreakdown
  updated_at?: string
}

export function getRatingColor(score: number | null | undefined): { 
  label: string
  style: { backgroundColor: string; color: string }
} {
  if (score == null) {
    return { 
      label: '—', 
      style: { backgroundColor: '#9ca3af', color: '#ffffff' }
    }
  }
  
  if (score >= 80) {
    return { 
      label: 'Excellent', 
      style: { backgroundColor: '#10b981', color: '#ffffff' }
    }
  }
  if (score >= 60) {
    return { 
      label: 'Good', 
      style: { backgroundColor: '#22c55e', color: '#ffffff' }
    }
  }
  if (score >= 40) {
    return { 
      label: 'Moderate', 
      style: { backgroundColor: '#f59e0b', color: '#ffffff' }
    }
  }
  return { 
    label: 'Poor', 
      style: { backgroundColor: '#ef4444', color: '#ffffff' }
  }
}

export function getIndexerApiUrl(): string {
  return process.env.NEXT_PUBLIC_INDEXER_API_URL || 'http://localhost:3001'
}

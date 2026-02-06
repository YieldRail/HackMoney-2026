import * as S from './scoring.js';
import { fetchLagoonVaultData, getAprAsDecimal, isVaultPaused } from './lagoon-api.js';
import { fetchMorphoVaultData, fetchMorphoPositionCount } from './morpho-api.js';
import { runVaultAnalytics } from './vault-analytics.js';

function isMorphoVault(vaultConfig) {
  return vaultConfig.type?.startsWith('morpho');
}

async function processLagoonVault(vaultConfig, client, options) {
  const lagoonData = await fetchLagoonVaultData(vaultConfig);
  if (!lagoonData) return null;

  const apr7d = getAprAsDecimal(lagoonData, 'weekly');
  const apr30d = getAprAsDecimal(lagoonData, 'monthly');
  const aprAll = getAprAsDecimal(lagoonData, 'inception');
  const aprBase = getAprAsDecimal(lagoonData, 'inceptionBase');

  let userAnalytics = null;
  if (client && options.includeUserAnalytics !== false) {
    try {
      userAnalytics = await runVaultAnalytics(client, vaultConfig);
    } catch (e) {
      console.warn(`[vault-kpi] ${vaultConfig.id}: User analytics failed:`, e.message);
    }
  }

  const metrics = {
    tvl: lagoonData.totalAssets,
    tvlUsd: lagoonData.totalAssetsUsd,
    totalSupply: lagoonData.totalSupply,
    apr7d,
    apr30d,
    aprAll,
    aprBase,
    pricePerShare: lagoonData.pricePerShare,
    pricePerShareUsd: lagoonData.pricePerShareUsd,
    highWaterMark: lagoonData.highWaterMark,
    vaultPaused: isVaultPaused(lagoonData),
    vaultState: lagoonData.vaultState,
    isWhitelistActivated: lagoonData.isWhitelistActivated,
    managementFee: lagoonData.managementFee,
    performanceFee: lagoonData.performanceFee,
    underlyingPrice: lagoonData.asset?.priceUsd,
    underlyingSymbol: lagoonData.asset?.symbol,
    underlyingDecimals: lagoonData.asset?.decimals,
    assetDepeg: lagoonData.asset?.priceUsd != null ? lagoonData.asset.priceUsd < 0.98 : null,
    lagoonName: lagoonData.name,
    lagoonSymbol: lagoonData.symbol,
    lagoonDescription: lagoonData.description,
    lagoonCurators: lagoonData.curators,
    lagoonVersion: lagoonData.version,
    hasAirdrops: lagoonData.hasAirdrops,
    hasIncentives: lagoonData.hasIncentives,
    logoUrl: lagoonData.logoUrl,
    userAnalytics: userAnalytics ? {
      totalUsers: userAnalytics.totalUsers,
      activeHolders: userAnalytics.activeHolders,
      exitedUsers: userAnalytics.exitedUsers,
      avgHoldingDays: userAnalytics.avgHoldingDays,
      medianHoldingDays: userAnalytics.medianHoldingDays,
      holdersOver30Days: userAnalytics.holdersOver30Days,
      holdersOver90Days: userAnalytics.holdersOver90Days,
      holdersOver180Days: userAnalytics.holdersOver180Days,
      quickExiters: userAnalytics.quickExiters,
      quickExitRate: userAnalytics.quickExitRate,
      retentionRate: userAnalytics.retentionRate,
      churnRate: userAnalytics.churnRate,
      avgDepositsPerUser: userAnalytics.avgDepositsPerUser,
      usersWithMultipleDeposits: userAnalytics.usersWithMultipleDeposits,
      trustScore: userAnalytics.trustScore,
      longTermHolders: userAnalytics.longTermHolders,
      smartDepositors: userAnalytics.smartDepositors,
      likelyFarmers: userAnalytics.likelyFarmers,
    } : null,
  };

  const score = S.compositeScoreLagoon(metrics, userAnalytics);
  const scoreBreakdown = {
    capital: S.capitalScoreLagoon(metrics),
    performance: S.performanceScoreLagoon(metrics),
    risk: S.riskScoreLagoon(metrics),
    userTrust: userAnalytics?.trustScore ?? null,
  };

  const aprPct = apr30d != null ? (apr30d * 100).toFixed(2) + '%' : 'N/A';
  const tvlFormatted = metrics.tvlUsd ? `$${(metrics.tvlUsd / 1e6).toFixed(2)}M` : 'N/A';
  const trustInfo = userAnalytics ? `, Trust=${userAnalytics.trustScore}, Users=${userAnalytics.totalUsers}` : '';
  console.log(`[vault-kpi] ${vaultConfig.id}: TVL=${tvlFormatted}, APR(30d)=${aprPct}, Score=${score?.toFixed(0) ?? 'N/A'}${trustInfo}`);

  return {
    vault_name: lagoonData.name || vaultConfig.name,
    metrics,
    score,
    score_breakdown: scoreBreakdown,
    source_data: lagoonData,
    vault_type: 'lagoon',
  };
}

async function processMorphoVault(vaultConfig) {
  const morphoData = await fetchMorphoVaultData(vaultConfig);
  if (!morphoData) return null;

  const positionCount = await fetchMorphoPositionCount(vaultConfig.address, vaultConfig.chainId);

  const idleRatio = (morphoData.totalAssetsUsd > 0 && morphoData.idleAssetsUsd != null)
    ? morphoData.idleAssetsUsd / morphoData.totalAssetsUsd
    : null;

  const liquidityRatio = (morphoData.totalAssetsUsd > 0 && morphoData.liquidityUsd != null)
    ? morphoData.liquidityUsd / morphoData.totalAssetsUsd
    : null;

  const metrics = {
    tvl: morphoData.totalAssets,
    tvlUsd: morphoData.totalAssetsUsd,
    totalSupply: morphoData.totalSupply,
    lastTotalAssets: morphoData.lastTotalAssets,
    apy: morphoData.apy,
    netApy: morphoData.netApy,
    netApyWithoutRewards: morphoData.netApyWithoutRewards,
    avgApy: morphoData.avgApy,
    avgNetApy: morphoData.avgNetApy,
    dailyApy: morphoData.dailyApy,
    weeklyApy: morphoData.weeklyApy,
    monthlyApy: morphoData.monthlyApy,
    maxApy: morphoData.maxApy,
    sharePrice: morphoData.sharePrice,
    sharePriceUsd: morphoData.sharePriceUsd,
    performanceFee: morphoData.performanceFee,
    managementFee: morphoData.managementFee,
    underlyingAddress: morphoData.asset?.address,
    underlyingPrice: morphoData.asset?.priceUsd,
    underlyingSymbol: morphoData.asset?.symbol,
    underlyingDecimals: morphoData.asset?.decimals,
    assetDepeg: morphoData.asset?.priceUsd != null ? morphoData.asset.priceUsd < 0.98 : null,
    listed: morphoData.listed,
    featured: morphoData.featured,
    curator: morphoData.curator,
    owner: morphoData.owner,
    guardian: morphoData.guardian,
    feeRecipient: morphoData.feeRecipient,
    timelock: morphoData.timelock,
    creationTimestamp: morphoData.creationTimestamp,
    idleAssets: morphoData.idleAssets,
    idleAssetsUsd: morphoData.idleAssetsUsd,
    idleRatio,
    liquidity: morphoData.liquidity,
    liquidityUsd: morphoData.liquidityUsd,
    liquidityRatio,
    positionCount,
    rewards: morphoData.rewards,
    totalRewardsApr: morphoData.totalRewardsApr,
    allocationCount: morphoData.allocationCount,
    activeMarkets: morphoData.activeMarkets,
    totalSuppliedUsd: morphoData.totalSuppliedUsd,
    totalCapUsd: morphoData.totalCapUsd,
    capUtilization: morphoData.capUtilization,
    warningCount: morphoData.warnings?.length || 0,
    warnings: morphoData.warnings,
    description: morphoData.description,
    curatorInfo: morphoData.curatorInfo,
    morphoName: morphoData.name,
    morphoSymbol: morphoData.symbol,
    source: morphoData.source,
  };

  const score = S.compositeScoreMorpho(metrics);
  const scoreBreakdown = {
    capital: S.capitalScoreMorpho(metrics),
    performance: S.performanceScoreMorpho(metrics),
    risk: S.riskScoreMorpho(metrics),
  };

  const apyPct = morphoData.netApy != null ? (morphoData.netApy * 100).toFixed(2) + '%' : 'N/A';
  const tvlFormatted = metrics.tvlUsd ? `$${(metrics.tvlUsd / 1e6).toFixed(2)}M` : 'N/A';
  const posInfo = positionCount != null ? `, Positions=${positionCount}` : '';
  console.log(`[vault-kpi] ${vaultConfig.id}: TVL=${tvlFormatted}, APY=${apyPct}, Score=${score?.toFixed(0) ?? 'N/A'}${posInfo}`);

  return {
    vault_name: morphoData.name || vaultConfig.name,
    metrics,
    score,
    score_breakdown: scoreBreakdown,
    source_data: morphoData,
    vault_type: 'morpho',
  };
}

const STALENESS_MS = 2 * 24 * 60 * 60 * 1000;

export async function runVaultKPI({
  db,
  getClientForVault,
  VAULTS_CONFIG,
  getVaultById,
  options = {},
}) {
  const colVaultRatings = db.collection('vault_ratings');
  const colVaultRatingHistory = db.collection('vault_rating_history');
  const now = new Date();
  const results = [];

  for (const vaultConfig of VAULTS_CONFIG) {
    try {
      const existing = await colVaultRatings.findOne(
        { vault_id: vaultConfig.id, chain: vaultConfig.chain },
        { projection: { updated_at: 1 } }
      );
      if (existing?.updated_at && (now - existing.updated_at) < STALENESS_MS) {
        console.log(`[vault-kpi] ${vaultConfig.id}: Fresh (updated ${Math.round((now - existing.updated_at) / 3600000)}h ago) - skipping`);
        results.push({ vault_id: vaultConfig.id, skipped: true });
        continue;
      }

      let processed;

      if (isMorphoVault(vaultConfig)) {
        processed = await processMorphoVault(vaultConfig);
        if (!processed) {
          console.warn(`[vault-kpi] ${vaultConfig.id}: Morpho API unavailable - skipping`);
          results.push({ vault_id: vaultConfig.id, error: 'Morpho API unavailable' });
          continue;
        }
      } else {
        const client = getClientForVault(vaultConfig);
        processed = await processLagoonVault(vaultConfig, client, options);
        if (!processed) {
          console.warn(`[vault-kpi] ${vaultConfig.id}: Lagoon API unavailable - skipping`);
          results.push({ vault_id: vaultConfig.id, error: 'Lagoon API unavailable' });
          continue;
        }
      }

      const doc = {
        vault_id: vaultConfig.id,
        vault_name: processed.vault_name,
        vault_address: vaultConfig.address,
        chain: vaultConfig.chain,
        vault_type: processed.vault_type,
        asset_symbol: vaultConfig.asset?.symbol ?? 'USDC',
        metrics: processed.metrics,
        score: processed.score,
        score_breakdown: processed.score_breakdown,
        updated_at: now,
        last_curated_at: now,
      };

      await colVaultRatings.updateOne(
        { vault_id: vaultConfig.id, chain: vaultConfig.chain },
        { $set: doc },
        { upsert: true }
      );

      await colVaultRatingHistory.insertOne({
        vault_id: vaultConfig.id,
        chain: vaultConfig.chain,
        vault_type: processed.vault_type,
        snapshot_at: now,
        metrics: processed.metrics,
        score: processed.score,
        score_breakdown: processed.score_breakdown,
      });

      results.push({ vault_id: vaultConfig.id, score: processed.score, updated_at: now });
    } catch (err) {
      console.error(`[vault-kpi] ${vaultConfig.id} error:`, err.message);
      results.push({ vault_id: vaultConfig.id, error: err.message });
    }
  }

  return results;
}

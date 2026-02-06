const MORPHO_API_URL = 'https://api.morpho.org/graphql';

async function morphoGraphQL(query, variables) {
  const response = await fetch(MORPHO_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Morpho API error: ${response.status}`);
  }

  const result = await response.json();
  if (result.errors && !result.data) {
    throw new Error(`GraphQL error: ${result.errors[0]?.message}`);
  }
  return result.data;
}

export async function fetchMorphoVaultData(vaultConfig) {
  const address = vaultConfig?.address;
  const chainId = vaultConfig?.chainId;
  if (!address || !chainId) return null;

  const v2Data = await fetchV2Vault(address, chainId);
  if (v2Data) return v2Data;

  const v1Data = await fetchV1Vault(address, chainId);
  return v1Data;
}

async function fetchV2Vault(address, chainId) {
  const query = `
    query GetVaultV2($address: String!, $chainId: Int!) {
      vaultV2ByAddress(address: $address, chainId: $chainId) {
        address
        name
        symbol
        creationBlockNumber
        creationTimestamp
        totalAssets
        totalAssetsUsd
        totalSupply
        idleAssets
        idleAssetsUsd
        liquidity
        liquidityUsd
        sharePrice
        performanceFee
        performanceFeeRecipient
        managementFee
        managementFeeRecipient
        maxApy
        apy
        netApy
        avgApy
        avgNetApy
        listed
        asset {
          address
          symbol
          decimals
          priceUsd
        }
        curator {
          address
        }
        owner {
          address
        }
        metadata {
          description
          image
        }
        rewards {
          supplyApr
          yearlySupplyTokens
          asset {
            symbol
            decimals
            priceUsd
          }
        }
        chain {
          id
          network
        }
        warnings {
          type
          level
        }
      }
    }
  `;

  try {
    const data = await morphoGraphQL(query, {
      address: address.toLowerCase(),
      chainId,
    });

    const vault = data.vaultV2ByAddress;
    if (!vault) return null;

    const rewards = vault.rewards || [];
    const totalRewardsApr = rewards.reduce((sum, r) => sum + (r.supplyApr || 0), 0);

    const result = {
      source: 'morpho-v2',
      name: vault.name,
      symbol: vault.symbol,
      totalAssets: vault.totalAssets,
      totalAssetsUsd: vault.totalAssetsUsd || 0,
      totalSupply: vault.totalSupply,
      lastTotalAssets: null,
      idleAssets: vault.idleAssets,
      idleAssetsUsd: vault.idleAssetsUsd || 0,
      liquidity: vault.liquidity,
      liquidityUsd: vault.liquidityUsd || 0,
      sharePrice: vault.sharePrice,
      sharePriceUsd: null,
      performanceFee: vault.performanceFee || 0,
      managementFee: vault.managementFee || 0,
      apy: vault.apy,
      netApy: vault.netApy,
      netApyWithoutRewards: null,
      dailyApy: null,
      weeklyApy: null,
      monthlyApy: null,
      dailyApyGross: null,
      weeklyApyGross: null,
      monthlyApyGross: null,
      avgApy: vault.avgApy,
      avgNetApy: vault.avgNetApy,
      maxApy: vault.maxApy,
      listed: vault.listed,
      featured: null,
      curator: vault.curator?.address || null,
      owner: vault.owner?.address || null,
      guardian: null,
      feeRecipient: vault.performanceFeeRecipient || null,
      timelock: null,
      creationTimestamp: vault.creationTimestamp,
      asset: {
        address: vault.asset?.address,
        symbol: vault.asset?.symbol,
        decimals: vault.asset?.decimals,
        priceUsd: vault.asset?.priceUsd,
      },
      warnings: vault.warnings || [],
      rewards: rewards.map(r => ({
        symbol: r.asset?.symbol,
        apr: r.supplyApr,
        yearlyTokens: r.yearlySupplyTokens,
      })),
      totalRewardsApr,
      allocationCount: null,
      activeMarkets: null,
      totalSuppliedUsd: null,
      totalCapUsd: null,
      capUtilization: null,
      description: vault.metadata?.description,
      curatorInfo: null,
    };

    console.log(`[morpho-api] ${address}: TVL=$${(result.totalAssetsUsd / 1e6).toFixed(2)}M, APY=${result.netApy != null ? (result.netApy * 100).toFixed(2) + '%' : 'N/A'}`);
    return result;
  } catch (error) {
    const isNotFound = error?.message?.includes('NOT_FOUND') || error?.message?.includes('cannot find') || error?.message?.includes('No results matching');
    if (!isNotFound) {
      console.error('[morpho-api] V2 query error:', error.message);
    }
    return null;
  }
}

async function fetchV1Vault(address, chainId) {
  const query = `
    query GetVaultV1($address: String!, $chainId: Int) {
      vaultByAddress(address: $address, chainId: $chainId) {
        address
        name
        symbol
        listed
        featured
        creationBlockNumber
        creationTimestamp
        creatorAddress
        metadata {
          description
          image
          curators {
            name
            image
            url
            verified
          }
        }
        liquidity {
          underlying
          usd
        }
        warnings {
          type
          level
        }
        dailyApys {
          apy
          netApy
        }
        weeklyApys {
          apy
          netApy
        }
        monthlyApys {
          apy
          netApy
        }
        state {
          totalAssets
          totalAssetsUsd
          totalSupply
          apy
          netApy
          netApyWithoutRewards
          fee
          curator
          owner
          guardian
          feeRecipient
          timelock
          sharePriceNumber
          sharePriceUsd
          lastTotalAssets
          timestamp
          rewards {
            supplyApr
            yearlySupplyTokens
            amountPerSuppliedToken
            asset {
              symbol
              decimals
              priceUsd
            }
          }
          allocation {
            supplyAssets
            supplyAssetsUsd
            supplyCap
            supplyCapUsd
            supplyQueueIndex
            withdrawQueueIndex
            enabled
          }
        }
        asset {
          address
          symbol
          decimals
          priceUsd
        }
      }
    }
  `;

  try {
    const data = await morphoGraphQL(query, {
      address: address.toLowerCase(),
      chainId,
    });

    const vault = data.vaultByAddress;
    if (!vault) return null;
    const state = vault.state || {};

    const allocations = state.allocation || [];
    const totalSupplied = allocations.reduce((sum, a) => sum + (a.supplyAssetsUsd || 0), 0);
    const totalCap = allocations.reduce((sum, a) => sum + (a.supplyCapUsd || 0), 0);
    const enabledMarkets = allocations.filter(a => a.supplyAssetsUsd > 0).length;

    const rewards = state.rewards || [];
    const totalRewardsApr = rewards.reduce((sum, r) => sum + (r.supplyApr || 0), 0);

    const result = {
      source: 'morpho-v1',
      name: vault.name,
      symbol: vault.symbol,
      totalAssets: state.totalAssets,
      totalAssetsUsd: state.totalAssetsUsd || 0,
      totalSupply: state.totalSupply,
      lastTotalAssets: state.lastTotalAssets,
      liquidity: vault.liquidity?.underlying,
      liquidityUsd: vault.liquidity?.usd || 0,
      idleAssets: null,
      idleAssetsUsd: null,
      sharePrice: state.sharePriceNumber,
      sharePriceUsd: state.sharePriceUsd,
      performanceFee: state.fee || 0,
      managementFee: 0,
      apy: state.apy,
      netApy: state.netApy,
      netApyWithoutRewards: state.netApyWithoutRewards,
      dailyApy: vault.dailyApys?.netApy,
      weeklyApy: vault.weeklyApys?.netApy,
      monthlyApy: vault.monthlyApys?.netApy,
      dailyApyGross: vault.dailyApys?.apy,
      weeklyApyGross: vault.weeklyApys?.apy,
      monthlyApyGross: vault.monthlyApys?.apy,
      avgApy: vault.monthlyApys?.apy ?? vault.weeklyApys?.apy,
      avgNetApy: vault.monthlyApys?.netApy ?? vault.weeklyApys?.netApy,
      listed: vault.listed,
      featured: vault.featured,
      curator: state.curator || null,
      owner: state.owner || null,
      guardian: state.guardian || null,
      feeRecipient: state.feeRecipient || null,
      timelock: state.timelock,
      creationTimestamp: vault.creationTimestamp,
      asset: {
        address: vault.asset?.address,
        symbol: vault.asset?.symbol,
        decimals: vault.asset?.decimals,
        priceUsd: vault.asset?.priceUsd,
      },
      warnings: vault.warnings || [],
      rewards: rewards.map(r => ({
        symbol: r.asset?.symbol,
        apr: r.supplyApr,
        yearlyTokens: r.yearlySupplyTokens,
      })),
      totalRewardsApr,
      allocationCount: allocations.length,
      activeMarkets: enabledMarkets,
      totalSuppliedUsd: totalSupplied,
      totalCapUsd: totalCap,
      capUtilization: totalCap > 0 ? totalSupplied / totalCap : null,
      description: vault.metadata?.description,
      curatorInfo: vault.metadata?.curators?.[0] || null,
    };

    console.log(`[morpho-api] ${address} (V1): TVL=$${(result.totalAssetsUsd / 1e6).toFixed(2)}M, APY=${result.netApy != null ? (result.netApy * 100).toFixed(2) + '%' : 'N/A'}, Markets=${enabledMarkets}`);
    return result;
  } catch (error) {
    console.error('[morpho-api] V1 query error:', error.message);
    return null;
  }
}

export async function fetchMorphoPositionCount(vaultAddress, chainId) {
  const query = `
    query GetPositionCount($vaultAddress: [String!]!) {
      vaultPositions(
        first: 1
        where: { vaultAddress_in: $vaultAddress }
      ) {
        pageInfo {
          countTotal
        }
      }
    }
  `;

  try {
    const data = await morphoGraphQL(query, {
      vaultAddress: [vaultAddress.toLowerCase()],
    });
    return data.vaultPositions?.pageInfo?.countTotal || 0;
  } catch (error) {
    console.warn('[morpho-api] Position count query failed:', error.message);
    return null;
  }
}

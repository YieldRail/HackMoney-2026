import { createConfig, getQuote, getStatus, type Quote } from '@lifi/sdk'
import { Address } from 'viem'

createConfig({
  integrator: 'Yieldo',
})

export interface ChainConfig {
  id: number
  name: string
  key: string
  logoURI?: string
}

export const SUPPORTED_CHAINS: ChainConfig[] = [
  { id: 1, name: 'Ethereum', key: 'eth', logoURI: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/ethereum.svg' },
  { id: 43114, name: 'Avalanche', key: 'avax', logoURI: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/avalanche.svg' },
  { id: 8453, name: 'Base', key: 'base', logoURI: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/base.svg' },
  { id: 10, name: 'Optimism', key: 'op', logoURI: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/optimism.svg' },
  { id: 42161, name: 'Arbitrum', key: 'arb', logoURI: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/arbitrum.svg' },
  { id: 56, name: 'BSC', key: 'bsc', logoURI: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/bsc.svg' },
]

export interface TokenInfo {
  address: Address
  symbol: string
  decimals: number
  chainId: number
  logoURI?: string
  name?: string
  isNative?: boolean
}

const MAJOR_TOKEN_SYMBOLS = [
  'USDC', 'USDT', 'DAI', 'WETH', 'ETH', 'WBTC', 'BTC',
  'AVAX', 'WAVAX', 'BNB', 'WBNB', 'MATIC', 'WMATIC',
  'OP', 'ARB', 'LINK', 'UNI', 'AAVE', 'CRV', 'MKR',
  'SNX', 'COMP', 'YFI', 'SUSHI', 'BAL', '1INCH',
  'LDO', 'RPL', 'GMX', 'FRAX', 'LUSD', 'TUSD',
  'BUSD', 'GUSD', 'USDP', 'sUSD', 'RAI',
  'stETH', 'wstETH', 'rETH', 'cbETH', 'frxETH',
  'JOE', 'PNG', 'QI', 'SPELL', 'TIME', 'MIM',
]

const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'
const NATIVE_TOKEN_ADDRESS_ALT = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export async function getTokensForChain(chainId: number): Promise<TokenInfo[]> {
  try {
    const response = await fetch(`https://li.quest/v1/tokens?chains=${chainId}`)
    if (!response.ok) throw new Error('Failed to fetch tokens')
    const data = await response.json()
    const tokens = data.tokens[chainId] || []
    
    const majorTokens = tokens
      .filter((token: any) => MAJOR_TOKEN_SYMBOLS.includes(token.symbol))
      .map((token: any) => {
        const addr = (token.address as string).toLowerCase()
        const isNative = addr === NATIVE_TOKEN_ADDRESS || addr === NATIVE_TOKEN_ADDRESS_ALT
        return {
          address: token.address as Address,
          symbol: token.symbol,
          decimals: token.decimals,
          chainId: token.chainId,
          logoURI: token.logoURI,
          name: token.name,
          isNative,
        }
      })
    
    const uniqueTokens = majorTokens.filter((token: TokenInfo, index: number) => {
      const firstIndex = majorTokens.findIndex((t: TokenInfo) => t.symbol === token.symbol)
      return firstIndex === index
    })
    
    return uniqueTokens.sort((a: TokenInfo, b: TokenInfo) => {
      const aIndex = MAJOR_TOKEN_SYMBOLS.indexOf(a.symbol)
      const bIndex = MAJOR_TOKEN_SYMBOLS.indexOf(b.symbol)
      return aIndex - bIndex
    })
  } catch (error) {
    console.error('Error fetching tokens:', error)
    return []
  }
}

export interface DepositQuote {
  quote: Quote
  estimatedShares: bigint
  estimatedAssets: bigint
  feeAmount: bigint
  minReceived: bigint
  priceImpact?: number
  toDecimals: number
  estimatedTime?: number
  gasCosts?: number
  steps?: number
}

export async function getDepositQuote(
  fromChainId: number,
  fromToken: Address,
  fromAmount: string,
  toChainId: number,
  toToken: Address,
  vaultAddress: Address,
  depositRouterAddress: Address,
  userAddress: Address,
  hasSettlement: boolean,
  vaultSharesPerAsset: bigint,
  toTokenDecimals: number,
  slippage: number = 0.03
): Promise<DepositQuote | null> {
  try {
    const isDirectDeposit = fromChainId === toChainId && fromToken.toLowerCase() === toToken.toLowerCase()
    
    // Shares calculation for ERC4626 vaults
    // Vault shares always have 18 decimals, assets have toTokenDecimals (e.g., 6 for USDC)
    // Formula: shares (18 decimals) = depositAmount (asset decimals) * totalSupply (18 decimals) / totalAssets (asset decimals)
    // vaultSharesPerAsset = (totalSupply * 10^18) / totalAssets
    // 
    // Example: If totalSupply = 1e18 (1 share) and totalAssets = 1e6 (1 USDC):
    //   vaultSharesPerAsset = (1e18 * 1e18) / 1e6 = 1e30
    //   For 1 USDC deposit (1e6): shares = (1e6 * 1e30) / 1e18 = 1e18 (1 share) ✓
    //
    // So the correct formula is: shares = (depositAmount * vaultSharesPerAsset) / 10^18
    const calculateShares = (depositAmount: bigint): bigint => {
      // depositAmount is in toTokenDecimals (e.g., 6 for USDC)
      // vaultSharesPerAsset = (totalSupply * 10^18) / totalAssets
      // shares (18 decimals) = (depositAmount * vaultSharesPerAsset) / 10^18
      return (depositAmount * vaultSharesPerAsset) / BigInt(10 ** 18)
    }
    
    if (isDirectDeposit) {
      const amount = BigInt(fromAmount)
      const feeAmount = (amount * BigInt(10)) / BigInt(10000) // 0.1% fee
      const depositAmount = amount - feeAmount
      const estimatedShares = calculateShares(depositAmount)
      
      return {
        quote: null as any,
        estimatedShares,
        estimatedAssets: depositAmount,
        feeAmount,
        minReceived: estimatedShares,
        toDecimals: toTokenDecimals,
        estimatedTime: undefined,
        gasCosts: undefined,
        steps: 1,
      }
    }

    const quote = await getQuote({
      fromChain: fromChainId,
      fromToken,
      fromAmount,
      toChain: toChainId,
      toToken,
      fromAddress: userAddress,
      slippage,
      order: 'RECOMMENDED',
    })

    if (!quote) {
      console.error('No quote returned from LI.FI')
      return null
    }

    // Try multiple locations for toAmount (LI.FI API can vary)
    const toAmountStr = quote.estimate?.toAmount || 
                        quote.action?.toAmount || 
                        quote.toAmount ||
                        '0'
    const toAmountMinStr = quote.estimate?.toAmountMin || 
                           quote.action?.toAmountMin || 
                           quote.toAmountMin ||
                           toAmountStr

    const toAmount = BigInt(toAmountStr)
    if (toAmount === 0n) {
      console.error('toAmount is 0, quote structure:', { 
        estimate: quote.estimate, 
        action: quote.action 
      })
      return null
    }

    const feeAmount = (toAmount * BigInt(10)) / BigInt(10000) // 0.1% fee
    const depositAmount = toAmount - feeAmount
    const estimatedShares = calculateShares(depositAmount)
    const minReceivedAmount = BigInt(toAmountMinStr) - ((BigInt(toAmountMinStr) * BigInt(10)) / BigInt(10000))
    const minReceived = calculateShares(minReceivedAmount)

    // Calculate total gas costs (from all steps)
    const gasCostUSD = quote.estimate?.gasCosts?.reduce(
      (acc: number, cost: any) => acc + parseFloat(cost.amountUSD || '0'), 0
    ) || 0
    
    // Calculate price impact (slippage)
    const fromAmountUSD = parseFloat(quote.estimate?.fromAmountUSD || '1')
    const toAmountUSD = parseFloat(quote.estimate?.toAmountUSD || '1')
    const priceImpact = fromAmountUSD > 0 && toAmountUSD > 0 
      ? Math.abs((fromAmountUSD - toAmountUSD) / fromAmountUSD) * 100 
      : undefined

    // Extract estimated time (in seconds)
    const estimatedTime = quote.estimate?.executionDuration || undefined
    const steps = quote.steps?.length || 0

    return {
      quote,
      estimatedShares,
      estimatedAssets: depositAmount,
      feeAmount,
      minReceived,
      priceImpact,
      toDecimals: toTokenDecimals,
      estimatedTime,
      gasCosts: gasCostUSD,
      steps,
    }
  } catch (error) {
    console.error('Error getting deposit quote:', error)
    return null
  }
}

export async function checkTransferStatus(
  bridge: string,
  fromChain: number,
  toChain: number,
  txHash: string
): Promise<any> {
  try {
    const status = await getStatus({
      bridge,
      fromChain,
      toChain,
      txHash,
    })
    return status
  } catch (error) {
    console.error('Error checking transfer status:', error)
    return null
  }
}

export async function getQuoteWithContractCall(
  fromChainId: number,
  fromToken: Address,
  fromAmount: string,
  toChainId: number,
  toToken: Address,
  userAddress: Address,
  contractAddress: Address,
  contractCallData: string,
  slippage: number = 0.03
): Promise<Quote | null> {
  try {
    const params = new URLSearchParams({
      fromChain: fromChainId.toString(),
      toChain: toChainId.toString(),
      fromToken,
      toToken,
      fromAmount,
      fromAddress: userAddress,
      toAddress: contractAddress,
      slippage: slippage.toString(),
      contractCalls: JSON.stringify([{
        fromAmount,
        fromTokenAddress: toToken,
        toContractAddress: contractAddress,
        toContractCallData: contractCallData,
        toContractGasLimit: '500000',
      }]),
    })
    
    const response = await fetch(`https://li.quest/v1/quote/contractCalls?${params}`)
    if (!response.ok) {
      console.error('Contract call quote failed:', await response.text())
      return null
    }
    return await response.json()
  } catch (error) {
    console.error('Error getting contract call quote:', error)
    return null
  }
}


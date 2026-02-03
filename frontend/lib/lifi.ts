import { createConfig, getQuote, getStatus, type Quote } from '@lifi/sdk'
import { Address, formatUnits } from 'viem'

const LIFI_API_KEY = process.env.NEXT_PUBLIC_LIFI_API_KEY || ''

createConfig({
  integrator: 'Yieldo',
})

function getLifiHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(LIFI_API_KEY && { 'x-lifi-api-key': LIFI_API_KEY }),
  }
}

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
    const response = await fetch(`https://li.quest/v1/tokens?chains=${chainId}`, {
      headers: LIFI_API_KEY ? { 'x-lifi-api-key': LIFI_API_KEY } : {},
    })
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
  feeCosts?: number // LI.FI and provider fees
  steps?: number
  stepDetails?: Array<{
    type: string
    tool: string
    toolKey: string
    logoURI?: string
    fromToken?: string
    toToken?: string
    fromAmount?: string
    toAmount?: string
    gasCosts: number
    feeCosts: number
    executionDuration?: number
  }>
  hasContractCall?: boolean // Indicates if this quote includes a contract call (swap + deposit in one)
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
    
    const calculateShares = (depositAmount: bigint): bigint => {
      return (depositAmount * vaultSharesPerAsset) / BigInt(10 ** 18)
    }
    
    if (isDirectDeposit) {
      const amount = BigInt(fromAmount)
      const feeAmount = (amount * BigInt(10)) / BigInt(10000)
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

    const feeAmount = (toAmount * BigInt(10)) / BigInt(10000)
    const depositAmount = toAmount - feeAmount
    const estimatedShares = calculateShares(depositAmount)
    const minReceivedAmount = BigInt(toAmountMinStr) - ((BigInt(toAmountMinStr) * BigInt(10)) / BigInt(10000))
    const minReceived = calculateShares(minReceivedAmount)
    
    console.log('Share calculation:', {
      toAmount: toAmount.toString(),
      toAmountStr,
      feeAmount: feeAmount.toString(),
      depositAmount: depositAmount.toString(),
      depositAmountFormatted: (Number(depositAmount) / 10 ** toTokenDecimals).toFixed(6),
      vaultSharesPerAsset: vaultSharesPerAsset.toString(),
      estimatedShares: estimatedShares.toString(),
      estimatedSharesFormatted: formatUnits(estimatedShares, 18),
      minReceived: minReceived.toString(),
      minReceivedFormatted: formatUnits(minReceived, 18),
      toTokenDecimals,
      calculation: `(${depositAmount.toString()} * ${vaultSharesPerAsset.toString()}) / ${BigInt(10 ** 18).toString()} = ${estimatedShares.toString()}`,
    })

    const gasCostUSD = quote.estimate?.gasCosts?.reduce(
      (acc: number, cost: any) => acc + parseFloat(cost.amountUSD || '0'), 0
    ) || 0
    
    const fromAmountUSD = parseFloat(quote.estimate?.fromAmountUSD || '1')
    const toAmountUSD = parseFloat(quote.estimate?.toAmountUSD || '1')
    const priceImpact = fromAmountUSD > 0 && toAmountUSD > 0 
      ? Math.abs((fromAmountUSD - toAmountUSD) / fromAmountUSD) * 100 
      : undefined

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
    const response = await fetch(
      `https://li.quest/v1/status?txHash=${txHash}&fromChain=${fromChain}&toChain=${toChain}`,
      {
        headers: LIFI_API_KEY ? { 'x-lifi-api-key': LIFI_API_KEY } : {},
      }
    )
    if (response.ok) {
      return await response.json()
    }
  } catch (err) {
  }
  
  try {
    const status = await getStatus({
      bridge,
      fromChain,
      toChain,
      txHash,
    })
    return status
  } catch (error: any) {
    console.error('Error checking transfer status:', error?.message || error)
    return null
  }
}

export function getBridgeFromQuote(quote: Quote | null): string {
  if (!quote?.steps) return 'stargate'
  
  for (const step of quote.steps) {
    if (step.type === 'cross' || step.type === 'lifi') {
      if (step.tool && step.tool !== 'lifi') {
        return step.tool
      }
      if (step.toolDetails?.key && step.toolDetails.key !== 'lifi') {
        return step.toolDetails.key
      }
    }
  }
  
  for (const step of quote.steps) {
    if (step.includedSteps) {
      for (const included of step.includedSteps) {
        if (included.type === 'cross' && included.tool && included.tool !== 'lifi') {
          return included.tool
        }
      }
    }
  }
  
  return quote.steps[0]?.tool || 'stargate'
}

export async function checkBridgeSupportsContractCalls(
  fromChainId: number,
  fromToken: Address,
  fromAmount: string,
  toChainId: number,
  toToken: Address,
  userAddress: Address,
  contractAddress: Address,
  contractCallData: string,
  bridgeName?: string,
  slippage: number = 0.03
): Promise<boolean> {
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
    
    // If bridge name is provided, try to filter by it
    if (bridgeName && bridgeName !== 'lifi') {
      params.append('allowedBridges', bridgeName)
    }
    
    const response = await fetch(`https://li.quest/v1/quote/contractCalls?${params}`, {
      headers: LIFI_API_KEY ? { 'x-lifi-api-key': LIFI_API_KEY } : {},
    })
    if (!response.ok) {
      const errorText = await response.text()
      console.log(`Bridge ${bridgeName || 'unknown'} does not support contract calls:`, errorText)
      return false
    }
    
    const quote = await response.json()
    // Check if we got a valid quote with transaction request
    return !!(quote && quote.transactionRequest)
  } catch (error) {
    console.log(`Error checking contract call support for bridge ${bridgeName || 'unknown'}:`, error)
    return false
  }
}

/**
 * Get a quote with contract call using LI.FI's contractCalls API
 * Uses POST /v1/quote/contractCalls endpoint with JSON body
 * Documentation: https://docs.li.fi/api-reference/perform-multiple-contract-calls-across-blockchains-beta
 */
export async function getQuoteWithContractCall(
  fromChainId: number,
  fromToken: Address,
  fromAmount: string,
  toChainId: number,
  toToken: Address,
  userAddress: Address,
  contractAddress: Address,
  contractCallData: string,
  preferredBridges?: string[],
  slippage: number = 0.03
): Promise<Quote | null> {
  try {
    const regularQuote = await getQuote({
      fromChain: fromChainId,
      fromToken,
      fromAmount,
      toChain: toChainId,
      toToken,
      fromAddress: userAddress,
      slippage,
      order: 'RECOMMENDED',
    })

    if (!regularQuote) {
      console.error('No regular quote available to estimate toAmount')
      return null
    }

    const toAmountStr = regularQuote.estimate?.toAmount || 
                        regularQuote.action?.toAmount || 
                        regularQuote.toAmount || 
                        fromAmount

    const unsupportedBridges = ['near', 'maya', 'meson', 'socket']
    const isSameChain = fromChainId === toChainId
    
    const requestBody: any = {
      fromChain: fromChainId,
      fromToken,
      fromAddress: userAddress,
      toChain: toChainId,
      toToken,
      toAmount: toAmountStr,
      contractCalls: [{
        fromAmount: toAmountStr,
        fromTokenAddress: toToken,
        toTokenAddress: toToken,
        toContractAddress: contractAddress,
        toContractCallData: contractCallData,
        toContractGasLimit: '500000',
      }],
      slippage,
      integrator: 'Yieldo',
    }

    if (!isSameChain) {
      let allowedBridges = preferredBridges?.filter(b => !unsupportedBridges.includes(b.toLowerCase()))
      
      if (!allowedBridges || allowedBridges.length === 0) {
        allowedBridges = ['stargate', 'hop', 'across']
      }
      
      const validBridges = ['stargate', 'hop', 'across']
      allowedBridges = allowedBridges.filter(b => validBridges.includes(b.toLowerCase()))
      
      if (allowedBridges.length > 0) {
        requestBody.allowBridges = allowedBridges
      } else {
        console.warn('No valid bridges for contract calls, letting LI.FI choose automatically')
      }
      
      if (preferredBridges && preferredBridges.length > 0) {
        const preferredFiltered = preferredBridges
          .filter(b => !unsupportedBridges.includes(b.toLowerCase()))
          .filter(b => validBridges.includes(b.toLowerCase()))
        if (preferredFiltered.length > 0) {
          requestBody.preferBridges = preferredFiltered
        }
      }
    }

    console.log('Requesting contract call quote:', {
      fromChain: fromChainId,
      toChain: toChainId,
      fromToken,
      toToken,
      contractAddress,
      allowBridges: requestBody.allowBridges,
      preferBridges: requestBody.preferBridges,
    })

    const response = await fetch('https://li.quest/v1/quote/contractCalls', {
      method: 'POST',
      headers: getLifiHeaders(),
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errorData: any = {}
      try {
        errorData = JSON.parse(errorText)
      } catch {
      }
      
      if (errorData.code === 1002 || errorData.message?.includes('No available quotes')) {
        console.warn('Contract call quotes not available for this route:', errorData.message)
        return null // Return null to trigger fallback
      }
      
      // Check for invalid bridge name errors
      if (errorData.code === 1011 || errorData.message?.includes('allowBridges')) {
        console.error('Invalid bridge name in allowBridges:', {
          error: errorData.message,
          code: errorData.code,
          allowBridges: requestBody.allowBridges,
          fromChain: fromChainId,
          toChain: toChainId,
        })
        // Try again without allowBridges to let LI.FI choose automatically
        if (requestBody.allowBridges) {
          console.log('Retrying without allowBridges constraint...')
          const retryBody = { ...requestBody }
          delete retryBody.allowBridges
          delete retryBody.preferBridges
          
          const retryResponse = await fetch('https://li.quest/v1/quote/contractCalls', {
            method: 'POST',
            headers: getLifiHeaders(),
            body: JSON.stringify(retryBody),
          })
          
          if (retryResponse.ok) {
            const retryQuote = await retryResponse.json()
            if (retryQuote && retryQuote.transactionRequest) {
              console.log('Successfully got quote without bridge constraints')
              return retryQuote
            }
          }
        }
        return null
      }
      
      console.error('Contract call quote failed:', response.status, errorText)
      return null
    }

    const quote = await response.json()

    // Verify the quote has a transaction request
    if (!quote || !quote.transactionRequest) {
      console.error('Contract call quote missing transaction request')
      return null
    }

    // Verify the bridge in the quote supports contract calls (only for cross-chain)
    let bridgeName: string | null = null
    if (!isSameChain) {
      bridgeName = getBridgeFromQuote(quote)
      if (bridgeName && unsupportedBridges.includes(bridgeName.toLowerCase())) {
        console.error(`Bridge ${bridgeName} does not support contract calls`)
        return null
      }
    } else {
      // For same-chain, extract the tool/provider name from steps
      const swapStep = quote.includedSteps?.find((step: any) => step.type === 'swap')
      if (swapStep) {
        bridgeName = swapStep.toolDetails?.name || swapStep.tool || 'DEX Aggregator'
      }
    }

    console.log('Successfully got contract call quote:', {
      bridge: bridgeName || (isSameChain ? 'Same-chain (DEX)' : 'Unknown'),
      hasTransactionRequest: !!quote.transactionRequest,
      isSameChain,
      steps: quote.includedSteps?.length || quote.steps?.length,
    })

    return quote
  } catch (error) {
    console.error('Error getting contract call quote:', error)
    return null
  }
}


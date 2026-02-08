'use client'

import { useAccount, useChainId, useSwitchChain, useBalance, usePublicClient, useReadContract } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useState, useEffect, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { parseUnits, formatUnits, Address, createPublicClient, http, encodeFunctionData, isAddress } from 'viem'
import { avalanche, mainnet, base, optimism, arbitrum, bsc } from 'viem/chains'
import { VAULTS_CONFIG, getVaultById, type VaultConfig } from '@/lib/vaults-config'
import { SUPPORTED_CHAINS, getTokensForChain, getDepositQuote, checkTransferStatus, getBridgeFromQuote, getQuoteWithContractCall, getQuote, type TokenInfo, type DepositQuote } from '@/lib/lifi'
import { getVaultState } from '@/lib/lagoon'
import { useVaults } from '@/hooks/useVaults'
import { fetchMorphoVaultData, fetchMorphoVaultDisplayData, type MorphoVaultDisplayData } from '@/lib/morpho'
import { signDepositIntent, getIntentHash, type DepositIntent } from '@/lib/eip712'
import { useWalletClient } from 'wagmi'
import DEPOSIT_ROUTER_ABI from '@/lib/deposit-router-abi.json'
import ERC20_ABI from '@/lib/erc20-abi.json'
import ERC4626_ABI from '@/lib/erc4626-abi.json'
import { CustomSelect } from '@/components/CustomSelect'
import { TransactionLoader } from '@/components/TransactionLoader'
import { TransactionStatus } from '@/components/TransactionStatus'
import { PendingTransactions } from '@/components/PendingTransactions'
import { TransactionHistory } from '@/components/TransactionHistory'
import { WhaleWatcher } from '@/components/WhaleWatcher'
import { getIndexerApiUrl, getRatingColor, type VaultRating, type VaultRatingMetrics } from '@/lib/vault-ratings'
import { resolveEnsToAddress } from '@/lib/ens-batch'

const chainConfigs: Record<number, any> = {
  1: mainnet,
  43114: avalanche,
  8453: base,
  10: optimism,
  42161: arbitrum,
  56: bsc,
}

function VaultsPageContent() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const searchParams = useSearchParams()

  const { vaults: allVaults, loading: vaultsLoading } = useVaults()
  const initialVaultId = searchParams.get('vault') || allVaults[0]?.id || VAULTS_CONFIG[0].id
  const [selectedVaultId, setSelectedVaultId] = useState<string>(initialVaultId)
  const selectedVault = useMemo(() => allVaults.find(v => v.id === selectedVaultId) || allVaults[0] || VAULTS_CONFIG[0], [selectedVaultId, allVaults])

  const [fromChainId, setFromChainId] = useState<number>(43114)
  const [fromToken, setFromToken] = useState<TokenInfo | null>(null)
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState(0.5)

  const [availableTokens, setAvailableTokens] = useState<TokenInfo[]>([])
  const [loadingTokens, setLoadingTokens] = useState(false)
  const [quote, setQuote] = useState<DepositQuote | null>(null)
  const [loadingQuote, setLoadingQuote] = useState(false)
  const [vaultState, setVaultState] = useState<any>(null)
  const [morphoVaultData, setMorphoVaultData] = useState<MorphoVaultDisplayData | null>(null)
  const [loadingMorphoData, setLoadingMorphoData] = useState(false)
  const [vaultRating, setVaultRating] = useState<VaultRating | null>(null)
  const [loadingVaultRating, setLoadingVaultRating] = useState(false)
  const [vaultAUM, setVaultAUM] = useState<{ aum: string; deposits: string; withdrawals: string } | null>(null)
  const [vaultSharesPerAsset, setVaultSharesPerAsset] = useState<bigint>(BigInt(10 ** 30))
  const [executing, setExecuting] = useState(false)
  const [executionStatus, setExecutionStatus] = useState<string | null>(null)
  const [executionStep, setExecutionStep] = useState<'idle' | 'approving' | 'swapping' | 'bridging' | 'depositing' | 'complete'>('idle')
  const [userNonce, setUserNonce] = useState<bigint>(BigInt(0))
  const [txHashes, setTxHashes] = useState<{
    approve?: string
    swap?: string
    bridge?: string
    deposit?: string
  }>({})
  const [transactionId, setTransactionId] = useState<string | null>(null)
  const [lifiStatus, setLifiStatus] = useState<any>(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [successTxHashes, setSuccessTxHashes] = useState<{
    swap?: string
    bridge?: string
    deposit?: string
  }>({})
  const [showError, setShowError] = useState(false)
  const [errorInfo, setErrorInfo] = useState<{
    message: string
    txHash?: string
  } | null>(null)
  const [vaultCapacityError, setVaultCapacityError] = useState<string | null>(null)
  const [lockedParams, setLockedParams] = useState<{
    fromChainId: number
    fromToken: TokenInfo
    amount: string
  } | null>(null)

  const [referralInput, setReferralInput] = useState('')
  const [resolvedReferrer, setResolvedReferrer] = useState<Address | null>(null)
  const [referralError, setReferralError] = useState<string | null>(null)
  const [resolvingReferral, setResolvingReferral] = useState(false)
  const [showVaultMetrics, setShowVaultMetrics] = useState(true)

  const { data: tokenBalance, refetch: refetchBalance } = useBalance({
    address,
    token: fromToken && !fromToken.isNative ? fromToken.address : undefined,
    chainId: fromChainId,
    query: { enabled: !!fromToken && !!address },
  })

  useEffect(() => {
    if (fromToken && address) {
      refetchBalance()
    }
  }, [fromToken, fromChainId, address, refetchBalance])

  const { data: contractNonce } = useReadContract({
    address: selectedVault.depositRouter as Address,
    abi: DEPOSIT_ROUTER_ABI,
    functionName: 'getNonce',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!selectedVault.depositRouter && chainId === selectedVault.chainId },
  })

  useEffect(() => {
    if (contractNonce !== undefined) setUserNonce(contractNonce as bigint)
  }, [contractNonce])

  useEffect(() => {
    if (chainId && !executing) setFromChainId(chainId)
  }, [chainId, executing])

  useEffect(() => {
    if (selectedVault) {
      fetchVaultState()
      fetchVaultRating()
      fetchVaultAUM()
      setShowVaultMetrics(true)
    }
  }, [selectedVault, address])

  useEffect(() => {
    if (!executing) fetchTokens()
  }, [fromChainId, executing])

  useEffect(() => {
    if (executing) return
    const timeoutId = setTimeout(fetchQuote, 500)
    return () => clearTimeout(timeoutId)
  }, [amount, fromToken, selectedVault, fromChainId, address, chainId, vaultSharesPerAsset, slippage, executing])

  useEffect(() => {
    if (!referralInput.trim()) {
      setResolvedReferrer(null)
      setReferralError(null)
      setResolvingReferral(false)
      return
    }

    const input = referralInput.trim()

    if (input.endsWith('.eth')) {
      setResolvingReferral(true)
      setReferralError(null)
      const timeoutId = setTimeout(async () => {
        try {
          const addr = await resolveEnsToAddress(input)
          if (addr) {
            setResolvedReferrer(addr)
            setReferralError(null)
          } else {
            setResolvedReferrer(null)
            setReferralError('Could not resolve ENS name')
          }
        } catch {
          setResolvedReferrer(null)
          setReferralError('Failed to resolve ENS name')
        } finally {
          setResolvingReferral(false)
        }
      }, 500)
      return () => clearTimeout(timeoutId)
    }

    if (input.startsWith('0x')) {
      if (isAddress(input)) {
        setResolvedReferrer(input as Address)
        setReferralError(null)
      } else {
        setResolvedReferrer(null)
        setReferralError('Invalid address')
      }
      setResolvingReferral(false)
    } else {
      setResolvedReferrer(null)
      setReferralError('Enter an ENS name (.eth) or address (0x...)')
      setResolvingReferral(false)
    }
  }, [referralInput])

  const fetchVaultState = async () => {
    if (!selectedVault) return
    setMorphoVaultData(null)
    setVaultCapacityError(null)
    try {
      if (selectedVault.type === 'lagoon') {
        const state = await getVaultState(selectedVault.address as Address, selectedVault.chain, true)
        setVaultState(state)
        if (state?.totalAssets && state?.totalSupply) {
          const assets = BigInt(state.totalAssets)
          const supply = BigInt(state.totalSupply)
          if (supply > 0n && assets > 0n) {
            const sharesPerAsset = (supply * BigInt(10 ** 18)) / assets
            console.log('Lagoon vault sharesPerAsset:', sharesPerAsset.toString())
            setVaultSharesPerAsset(sharesPerAsset)
          } else {
            console.warn('Lagoon vault has no supply or assets, using default 1:1 ratio')
            setVaultSharesPerAsset(BigInt(10 ** 30))
          }
        }
      } else if (selectedVault.type?.startsWith('morpho')) {
        setLoadingMorphoData(true)
        try {
          const displayData = await fetchMorphoVaultDisplayData(
            selectedVault.address,
            selectedVault.chainId,
            address || undefined
          )

          if (displayData) {
            setMorphoVaultData(displayData)
            const totalAssets = BigInt(displayData.totalAssets || '0')
            const totalSupply = BigInt(displayData.totalSupply || '0')

            setVaultState({
              totalAssets: totalAssets.toString(),
              totalSupply: totalSupply.toString(),
              apr: displayData.apy ? (displayData.apy / 100).toString() : '0',
              name: displayData.name,
              tvlUsd: displayData.tvlUsd,
            })

            if (totalSupply > 0n && totalAssets > 0n) {
              const sharesPerAsset = (totalSupply * BigInt(10 ** 18)) / totalAssets
              console.log('Morpho vault sharesPerAsset calculation:', {
                totalSupply: totalSupply.toString(),
                totalAssets: totalAssets.toString(),
                sharesPerAsset: sharesPerAsset.toString(),
                assetDecimals: selectedVault.asset.decimals,
              })
              setVaultSharesPerAsset(sharesPerAsset)
            } else {
              console.warn('Morpho vault has no supply or assets, using default 1:1 ratio')
              setVaultSharesPerAsset(BigInt(10 ** 30))
            }
          } else {
            const morphoData = await fetchMorphoVaultData(selectedVault.address as Address, selectedVault.chainId)
            if (morphoData) {
              const totalAssets = morphoData.totalAssets || 0n
              const totalSupply = morphoData.totalSupply || 0n

              setVaultState({
                totalAssets: totalAssets.toString(),
                totalSupply: totalSupply.toString(),
                apr: morphoData.apy ? (morphoData.apy / 100).toString() : '0',
              })

              if (totalSupply > 0n && totalAssets > 0n) {
                const sharesPerAsset = (totalSupply * BigInt(10 ** 18)) / totalAssets
                setVaultSharesPerAsset(sharesPerAsset)
              }
            }
          }
        } catch (error) {
          console.error('Error fetching Morpho vault data:', error)
          setVaultState({
            totalAssets: '0',
            totalSupply: '0',
            apr: '0',
          })
          setVaultSharesPerAsset(BigInt(10 ** 30))
        } finally {
          setLoadingMorphoData(false)
        }
      }
    } catch (error) {
      console.error('Error fetching vault state:', error)
    }
  }

  const fetchVaultRating = async () => {
    if (!selectedVault) return
    setLoadingVaultRating(true)
    setVaultRating(null)
    try {
      const apiUrl = getIndexerApiUrl()
      const url = selectedVault.chain
        ? `${apiUrl}/api/vault-ratings?vault_id=${encodeURIComponent(selectedVault.id)}&chain=${encodeURIComponent(selectedVault.chain)}`
        : `${apiUrl}/api/vault-ratings?vault_id=${encodeURIComponent(selectedVault.id)}`
      
      console.log('Fetching vault rating from:', url)
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        console.log('Vault rating API response:', data)
        if (Array.isArray(data) && data.length > 0) {
          console.log('Setting vault rating:', data[0])
          setVaultRating(data[0])
        } else {
          console.warn('Vault rating API returned empty array or no data')
        }
      } else {
        console.error('Vault rating API error:', response.status, response.statusText)
      }
    } catch (error) {
      console.error('Error fetching vault rating:', error)
    } finally {
      setLoadingVaultRating(false)
    }
  }

  const fetchVaultAUM = async () => {
    if (!selectedVault || !address) {
      setVaultAUM(null)
      return
    }
    try {
      const apiUrl = getIndexerApiUrl()
      const url = `${apiUrl}/api/aum?user=${address}&vault_id=${encodeURIComponent(selectedVault.id)}&chain=${encodeURIComponent(selectedVault.chain)}`
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        if (data && data.aumFromYieldo) {
          setVaultAUM({
            aum: data.aumFromYieldo,
            deposits: data.totalDepositsYieldo || '0',
            withdrawals: data.totalWithdrawalsYieldo || '0',
          })
        } else {
          setVaultAUM(null)
        }
      }
    } catch (error) {
      console.error('Error fetching vault AUM:', error)
      setVaultAUM(null)
    }
  }

  const fetchTokens = async () => {
    setLoadingTokens(true)
    const tokens = await getTokensForChain(fromChainId)
    setAvailableTokens(tokens)
    if (tokens.length > 0) {
      const usdcToken = tokens.find(t => t.symbol === 'USDC')
      setFromToken(usdcToken || tokens[0])
    }
    setLoadingTokens(false)
  }

  const fetchQuote = async () => {
    if (!amount || !fromToken || !selectedVault || !address || parseFloat(amount) <= 0 || chainId !== fromChainId) {
      setQuote(null)
      return
    }
    setShowSuccess(false)
    setSuccessTxHashes({})
    setShowError(false)
    setErrorInfo(null)
    setVaultCapacityError(null)
    setLoadingQuote(true)
    try {
      const fromAmount = parseUnits(amount, fromToken.decimals).toString()
      const depositRouterAddress = selectedVault.depositRouter as Address
      if (!depositRouterAddress) {
        setQuote(null)
        setLoadingQuote(false)
        return
      }

      if (selectedVault.type?.startsWith('morpho')) {
        try {
          const vaultChainConfig = chainConfigs[selectedVault.chainId]
          if (vaultChainConfig) {
            const vaultClient = createPublicClient({
              chain: vaultChainConfig,
              transport: http(),
            })
            const maxDepositAmount = await vaultClient.readContract({
              address: selectedVault.address as Address,
              abi: ERC4626_ABI,
              functionName: 'maxDeposit',
              args: [depositRouterAddress],
            }) as bigint
            const depositAmountInAsset = parseUnits(amount, selectedVault.asset.decimals)
            if (maxDepositAmount === 0n) {
              setVaultCapacityError('This vault has reached its supply cap and cannot accept deposits right now. Please try another vault.')
              setQuote(null)
              setLoadingQuote(false)
              return
            } else if (maxDepositAmount < depositAmountInAsset) {
              const maxFormatted = formatUnits(maxDepositAmount, selectedVault.asset.decimals)
              setVaultCapacityError(`This vault can only accept up to ${Number(maxFormatted).toLocaleString()} ${selectedVault.asset.symbol} more. Please reduce your amount or try another vault.`)
              setQuote(null)
              setLoadingQuote(false)
              return
            }
          }
        } catch (e) {
          console.warn('Could not check vault maxDeposit:', e)
        }
      }
      const toTokenForSwap = selectedVault.asset.address as Address
      const isDirectDeposit = fromChainId === selectedVault.chainId && fromToken.address.toLowerCase() === toTokenForSwap.toLowerCase()
      const needsSwap = !isDirectDeposit
      
      console.log('Fetching quote with:', {
        fromChainId,
        fromToken: fromToken.address,
        fromAmount,
        toChainId: selectedVault.chainId,
        toToken: toTokenForSwap,
        vaultType: selectedVault.type,
        isDirectDeposit,
        needsSwap,
        vaultSharesPerAsset: vaultSharesPerAsset.toString(),
        assetDecimals: selectedVault.asset.decimals,
        slippage: slippage / 100,
      })
      
      let quoteResult: DepositQuote | null = null
      
      if (needsSwap) {
        try {
          console.log('Attempting to get contract call quote for swap + deposit...')
          const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
          const tempQuote = await getQuote({
            fromChain: fromChainId,
            fromToken: fromToken.address,
            fromAmount,
            toChain: selectedVault.chainId,
            toToken: toTokenForSwap,
            fromAddress: address,
            slippage: slippage / 100,
            order: 'RECOMMENDED',
          })
          
          if (tempQuote) {
            const q = tempQuote as any
            const toAmountStr = q.estimate?.toAmount || q.action?.toAmount || q.toAmount || '0'
            const toAmount = BigInt(toAmountStr)
            const feeAmount = (toAmount * BigInt(10)) / BigInt(10000)
            const depositAmount = toAmount - feeAmount
            
            const intent: DepositIntent = {
              user: address!,
              vault: selectedVault.address as Address,
              asset: toTokenForSwap,
              amount: depositAmount,
              nonce: userNonce,
              deadline,
            }
            
            const isERC4626 = selectedVault.type?.startsWith('morpho')
            const functionName = selectedVault.hasSettlement
              ? 'depositWithIntentCrossChainRequest'
              : (isERC4626 ? 'depositWithIntentCrossChainERC4626' : 'depositWithIntentCrossChain')
            const callData = encodeFunctionData({
              abi: DEPOSIT_ROUTER_ABI,
              functionName,
              args: [[intent.user, intent.vault, intent.asset, intent.amount, intent.nonce, intent.deadline], '0x' as `0x${string}`, resolvedReferrer || '0x0000000000000000000000000000000000000000'],
            })
            
            console.log('Requesting contract call quote:', {
              fromChainId,
              fromToken: fromToken.address,
              fromAmount,
              toChainId: selectedVault.chainId,
              toToken: toTokenForSwap,
              contractAddress: depositRouterAddress,
              vaultType: selectedVault.type,
            })
            
            const contractCallQuote = await getQuoteWithContractCall(
              fromChainId,
              fromToken.address,
              fromAmount,
              selectedVault.chainId,
              toTokenForSwap,
              address,
              depositRouterAddress,
              callData,
              undefined,
              slippage / 100
            )
            
            if (contractCallQuote && contractCallQuote.transactionRequest) {
              console.log('✅ Successfully got contract call quote!', {
                hasTransactionRequest: !!contractCallQuote.transactionRequest,
                steps: contractCallQuote.steps?.length,
              })
              
              const calculateShares = (depositAmount: bigint): bigint => {
                return (depositAmount * vaultSharesPerAsset) / BigInt(10 ** 18)
              }
              const estimatedShares = calculateShares(depositAmount)
              const toAmountMinStr = tempQuote.estimate?.toAmountMin || toAmountStr
              const toAmountMinBigInt = BigInt(toAmountMinStr)
              const minReceivedAmount = toAmountMinBigInt - ((toAmountMinBigInt * BigInt(10)) / BigInt(10000))
              const minReceived = calculateShares(minReceivedAmount)
              
              const totalGasCosts = contractCallQuote.estimate?.gasCosts?.reduce((acc: number, cost: any) => acc + parseFloat(cost.amountUSD || '0'), 0) || 0
              const totalFeeCosts = contractCallQuote.estimate?.feeCosts?.reduce((acc: number, cost: any) => acc + parseFloat(cost.amountUSD || '0'), 0) || 0
              
              const stepDetails = contractCallQuote.includedSteps?.map((step: any) => ({
                type: step.type,
                tool: step.tool || step.toolDetails?.name || 'Unknown',
                toolKey: step.toolDetails?.key || step.tool,
                logoURI: step.toolDetails?.logoURI,
                fromToken: step.action?.fromToken?.symbol,
                toToken: step.action?.toToken?.symbol,
                fromAmount: step.action?.fromAmount,
                toAmount: step.estimate?.toAmount,
                gasCosts: step.estimate?.gasCosts?.reduce((acc: number, cost: any) => acc + parseFloat(cost.amountUSD || '0'), 0) || 0,
                feeCosts: step.estimate?.feeCosts?.reduce((acc: number, cost: any) => acc + parseFloat(cost.amountUSD || '0'), 0) || 0,
                executionDuration: step.estimate?.executionDuration,
              })) || []

              const usedBridge = getBridgeFromQuote(contractCallQuote)
              console.log('📌 Quote used bridge:', usedBridge)

              quoteResult = {
                quote: contractCallQuote,
                estimatedShares,
                estimatedAssets: depositAmount,
                minAssets: minReceivedAmount,
                toAmountMin: toAmountMinBigInt,  // Use this for intent signing
                feeAmount,
                minReceived,
                toDecimals: selectedVault.asset.decimals,
                estimatedTime: contractCallQuote.estimate?.executionDuration,
                gasCosts: totalGasCosts,
                feeCosts: totalFeeCosts,
                steps: contractCallQuote.includedSteps?.length || contractCallQuote.steps?.length || 0,
                stepDetails,
                hasContractCall: true,
                usedBridge,
              }
              console.log('✅ Got contract call quote (swap + deposit in one transaction):', quoteResult)
            } else {
              console.warn('⚠️ Contract call quote returned but no transactionRequest:', {
                hasQuote: !!contractCallQuote,
                hasTransactionRequest: contractCallQuote?.transactionRequest ? true : false,
              })
            }
          } else {
            console.warn('⚠️ No temp quote available for contract call estimation')
          }
        } catch (error: any) {
          console.error('❌ Failed to get contract call quote:', {
            error: error?.message || error,
            code: error?.code,
            vaultType: selectedVault.type,
            fromChainId,
            toChainId: selectedVault.chainId,
          })
          console.warn('Falling back to regular quote (swap then deposit separately)')
        }
      }
      
      if (!quoteResult) {
        console.log('Using regular quote (no contract call available)')
        quoteResult = await getDepositQuote(
          fromChainId,
          fromToken.address,
          fromAmount,
          selectedVault.chainId,
          toTokenForSwap,
          selectedVault.address as Address,
          depositRouterAddress,
          address,
          selectedVault.hasSettlement,
          vaultSharesPerAsset,
          selectedVault.asset.decimals,
          slippage / 100
        )
      }
      
      console.log('Quote result:', {
        estimatedShares: quoteResult?.estimatedShares?.toString(),
        estimatedAssets: quoteResult?.estimatedAssets?.toString(),
        minReceived: quoteResult?.minReceived?.toString(),
        vaultSharesPerAsset: vaultSharesPerAsset.toString(),
      })
      
      setQuote(quoteResult)
    } catch (error) {
      console.error('Error fetching quote:', error)
      setQuote(null)
    } finally {
      setLoadingQuote(false)
    }
  }

  const executeVaultDeposit = async (
    vault: typeof selectedVault,
    depositAmount: bigint,
    txId: string,
    bridgeTxHash: string
  ) => {
    const apiUrl = process.env.NEXT_PUBLIC_INDEXER_API_URL || 'http://localhost:3001'
    const depositRouterAddress = vault.depositRouter as Address
    
    try {
      setExecutionStatus('Checking token balance...')
      
      const balance = await publicClient?.readContract({
        address: vault.asset.address as Address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address],
      }) as bigint

      if (balance < depositAmount) {
        depositAmount = balance
      }

      if (depositAmount === BigInt(0)) {
        throw new Error('No tokens received from bridge')
      }

      setExecutionStatus('Approving deposit router...')
      
      const allowance = await publicClient?.readContract({
        address: vault.asset.address as Address,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, depositRouterAddress],
      }) as bigint

      if (allowance < depositAmount) {
        const approveHash = await walletClient!.writeContract({
          address: vault.asset.address as Address,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [depositRouterAddress, depositAmount],
        })
        await publicClient?.waitForTransactionReceipt({ hash: approveHash })
      }

      const pendingDepositKey = `pending_deposit_${txId}`
      const storedPending = localStorage.getItem(pendingDepositKey)
      
      let intent: DepositIntent
      let signature: string
      
      if (storedPending) {
        try {
          const pending = JSON.parse(storedPending)
          if (pending.intent && pending.signature) {
            console.log('Using stored intent and signature from bridge flow')
            intent = {
              user: pending.intent.user as Address,
              vault: pending.intent.vault as Address,
              asset: pending.intent.asset as Address,
              amount: BigInt(pending.intent.amount),
              nonce: BigInt(pending.intent.nonce),
              deadline: BigInt(pending.intent.deadline),
            }
            signature = pending.signature
            
            if (intent.amount !== depositAmount) {
              console.warn('Intent amount mismatch, updating intent amount')
              intent.amount = depositAmount
              setExecutionStatus('Updating deposit intent...')
              signature = await signDepositIntent(intent, vault.chainId, depositRouterAddress, walletClient!)
            }
          } else {
            throw new Error('Stored pending deposit missing intent or signature')
          }
        } catch (err) {
          console.warn('Failed to use stored intent, creating new one:', err)
          setExecutionStatus('Please sign the deposit intent...')
          let freshNonce = userNonce
          try {
            const nonceResult = await publicClient?.readContract({
              address: depositRouterAddress,
              abi: DEPOSIT_ROUTER_ABI,
              functionName: 'getNonce',
              args: [address],
            })
            freshNonce = nonceResult as bigint
            console.log('Fresh nonce for fallback intent:', freshNonce.toString())
          } catch (e) {
            console.warn('Failed to fetch fresh nonce, using cached:', e)
          }

          const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
          intent = {
            user: address!,
            vault: vault.address as Address,
            asset: vault.asset.address as Address,
            amount: depositAmount,
            nonce: freshNonce,
            deadline,
          }
          signature = await signDepositIntent(intent, vault.chainId, depositRouterAddress, walletClient!)
        }
      } else {
        setExecutionStatus('Please sign the deposit intent...')
        // Fetch fresh nonce to avoid "Invalid nonce" errors
        let freshNonce = userNonce
        try {
          const nonceResult = await publicClient?.readContract({
            address: depositRouterAddress,
            abi: DEPOSIT_ROUTER_ABI,
            functionName: 'getNonce',
            args: [address],
          })
          freshNonce = nonceResult as bigint
          console.log('Fresh nonce for resume deposit:', freshNonce.toString())
        } catch (e) {
          console.warn('Failed to fetch fresh nonce, using cached:', e)
        }

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
        intent = {
          user: address!,
          vault: vault.address as Address,
          asset: vault.asset.address as Address,
          amount: depositAmount,
          nonce: freshNonce,
          deadline,
        }
        signature = await signDepositIntent(intent, vault.chainId, depositRouterAddress, walletClient!)
      }

      setExecutionStatus('Please confirm the deposit transaction...')

      const isERC4626 = vault.type?.startsWith('morpho')
      const functionName = vault.hasSettlement
        ? 'depositWithIntentRequest'
        : (isERC4626 ? 'depositWithIntentERC4626' : 'depositWithIntent')
      const depositHash = await walletClient!.writeContract({
        address: depositRouterAddress,
        abi: DEPOSIT_ROUTER_ABI,
        functionName,
        args: [[intent.user, intent.vault, intent.asset, intent.amount, intent.nonce, intent.deadline], signature as `0x${string}`, resolvedReferrer || '0x0000000000000000000000000000000000000000'],
      })

      setTxHashes(prev => ({ ...prev, deposit: depositHash }))
      setExecutionStatus('Deposit submitted! Waiting for confirmation...')

      await publicClient?.waitForTransactionReceipt({ hash: depositHash })

      await fetch(`${apiUrl}/api/transaction-states`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: txId,
          user_address: address,
          source_chain: 'cross-chain',
          destination_chain: vault.chain,
          status: 'completed',
          current_step: 'completed',
          deposit_tx_hash: depositHash,
          bridge_tx_hash: bridgeTxHash,
        }),
      })

      setExecutionStep('complete')
      setExecutionStatus('🎉 Deposit completed successfully!')

      setSuccessTxHashes({
        bridge: bridgeTxHash,
        deposit: depositHash,
      })
      setShowSuccess(true)

      setUserNonce(intent.nonce + BigInt(1))
      refetchBalance()

      localStorage.removeItem(`pending_deposit_${txId}`)

      setAmount('')
      setQuote(null)
      setTransactionId(null)
      setTxHashes({})
      setExecuting(false)
    } catch (error: any) {
      console.error('Vault deposit error:', error)
      throw error
    }
  }

  useEffect(() => {
      const checkPendingDeposits = async () => {
      if (!address || !chainId || !walletClient) return
      
      const keys = Object.keys(localStorage).filter(k => k.startsWith('pending_deposit_'))
      
      for (const key of keys) {
        try {
          const pending = JSON.parse(localStorage.getItem(key) || '{}')
          
          if (pending.chainId === chainId && pending.userAddress?.toLowerCase() === address.toLowerCase()) {
            const vault = getVaultById(pending.vaultId)
            if (!vault) continue
            
            const shouldComplete = window.confirm(
              `You have a pending deposit from a cross-chain bridge. Would you like to complete the deposit of ~${(Number(pending.estimatedAmount) / 1e6).toFixed(2)} ${vault.asset.symbol} into ${vault.name}?`
            )
            
            if (shouldComplete) {
              setSelectedVaultId(pending.vaultId)
              setExecuting(true)
              setTransactionId(pending.transactionId)
              setExecutionStep('depositing')
              
              try {
                await executeVaultDeposit(
                  vault,
                  BigInt(pending.estimatedAmount),
                  pending.transactionId,
                  ''
                )
              } catch (error: any) {
                setExecutionStatus(`Deposit failed: ${error.message}`)
                setExecuting(false)
              }
            } else {
              localStorage.removeItem(key)
            }
          }
        } catch (e) {
          console.error('Error processing pending deposit:', e)
        }
      }
    }
    
    checkPendingDeposits()
  }, [chainId, address, walletClient])

  const handleExecute = async () => {
    if (!quote || !walletClient || !address || !selectedVault || !fromToken) return

    const isDirectDeposit = fromChainId === selectedVault.chainId && 
      fromToken.address.toLowerCase() === selectedVault.asset.address.toLowerCase()

    if (isDirectDeposit) {
      await handleDirectDeposit()
      return
    }

    const isSameChainSwap = fromChainId === selectedVault.chainId
    if (isSameChainSwap) {
      await handleSameChainSwapDeposit()
      return
    }

    if (!quote.quote) {
      alert('Quote not available')
      return
    }

    const capturedQuote = quote
    const capturedAmount = amount
    const capturedFromToken = fromToken
    const capturedVault = selectedVault
    const capturedFromChainId = fromChainId
    const depositRouterAddress = capturedVault.depositRouter as Address

    setExecuting(true)
    setExecutionStep('approving')
    setExecutionStatus('Step 1/3: Please sign the deposit intent...')
    setTxHashes({})

    const txId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    setTransactionId(txId)

    const apiUrl = process.env.NEXT_PUBLIC_INDEXER_API_URL || 'http://localhost:3001'
    const chainIdToKey: Record<number, string> = {
      1: 'ethereum',
      43114: 'avalanche',
      8453: 'base',
      10: 'optimism',
      42161: 'arbitrum',
      56: 'bsc',
    }
    const sourceChainKey = chainIdToKey[capturedFromChainId] || fromChain?.name.toLowerCase() || 'unknown'
    const isCrossChain = capturedFromChainId !== capturedVault.chainId
    const baseAmount = capturedQuote.toAmountMin || (capturedQuote.estimatedAssets + capturedQuote.feeAmount)
    const crossChainSlippageBuffer = isCrossChain ? 0.95 : 1.0 // 5% extra buffer for cross-chain
    const depositAmount = isCrossChain
      ? (baseAmount * BigInt(Math.floor(crossChainSlippageBuffer * 100))) / 100n
      : baseAmount

    console.log('Intent amount calculation:', {
      baseAmount: baseAmount.toString(),
      depositAmount: depositAmount.toString(),
      isCrossChain,
      crossChainSlippageBuffer,
      reduction: isCrossChain ? '5%' : '0%',
    })
    const parsedFromAmount = parseUnits(capturedAmount, capturedFromToken.decimals)

    const updateTransactionState = async (status: string, currentStep: string, errorMessage?: string, lifiStatusData?: any, bridgeTxHash?: string) => {
      try {
        await fetch(`${apiUrl}/api/transaction-states`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transaction_id: txId,
            user_address: address,
            source_chain: sourceChainKey,
            destination_chain: capturedVault.chain,
            vault_id: capturedVault.id,
            vault_address: capturedVault.address,
            from_token: capturedFromToken.address,
            from_token_symbol: capturedFromToken.symbol,
            from_amount: parsedFromAmount.toString(),
            to_token: capturedVault.asset.address,
            to_token_symbol: capturedVault.asset.symbol,
            to_amount: depositAmount.toString(),
            bridge_tx_hash: bridgeTxHash || null,
            deposit_router_address: depositRouterAddress,
            status,
            current_step: currentStep,
            error_message: errorMessage || null,
            lifi_status: lifiStatusData ? JSON.stringify(lifiStatusData) : null,
          }),
        })
      } catch (err) {
        console.error('Error updating transaction state:', err)
      }
    }

    let bridgeHash: `0x${string}` | null = null

    try {
      await updateTransactionState('pending', 'initiated')

      setExecutionStatus('Step 1/3: Signing deposit intent...')

      const destChainConfig = chainConfigs[capturedVault.chainId]
      const destPublicClient = createPublicClient({
        chain: destChainConfig,
        transport: http(),
      })

      let freshNonce = userNonce
      try {
        const nonceResult = await destPublicClient.readContract({
          address: depositRouterAddress,
          abi: DEPOSIT_ROUTER_ABI,
          functionName: 'getNonce',
          args: [address],
        })
        freshNonce = nonceResult as bigint
        console.log('Fresh nonce from destination chain:', freshNonce.toString(), '(cached was:', userNonce.toString(), ')')
      } catch (nonceError) {
        console.warn('Failed to fetch fresh nonce, using cached value:', nonceError)
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200)
      const intent: DepositIntent = {
        user: address!,
        vault: capturedVault.address as Address,
        asset: capturedVault.asset.address as Address,
        amount: depositAmount,
        nonce: freshNonce,
        deadline,
      }

      let needsChainSwitchForSigning = chainId !== capturedVault.chainId
      let originalChainId = capturedFromChainId // Use the captured source chain ID
      
      if (needsChainSwitchForSigning) {
        const destChainName = capturedVault.chain === 'avalanche' ? 'Avalanche' : 
                              capturedVault.chain === 'ethereum' ? 'Ethereum' :
                              capturedVault.chain.charAt(0).toUpperCase() + capturedVault.chain.slice(1)
        setExecutionStatus(`Step 1/3: Switching to ${destChainName} to sign deposit intent...`)
        try {
          await switchChain?.({ chainId: capturedVault.chainId })
          await new Promise(resolve => setTimeout(resolve, 3000))
        } catch (switchError: any) {
          throw new Error(`Please switch to ${destChainName} to sign the deposit intent. ${switchError.message}`)
        }
      }

      setExecutionStatus('Step 1/3: Please sign the deposit intent in your wallet...')
      let signature: string
      try {
        signature = await signDepositIntent(intent, capturedVault.chainId, depositRouterAddress, walletClient!)
        console.log('Deposit intent signed:', { intent, signature })
      } catch (signError: any) {
        if (needsChainSwitchForSigning && originalChainId) {
          try {
            await switchChain?.({ chainId: originalChainId })
          } catch {}
        }
        throw new Error(`Failed to sign deposit intent: ${signError.message}`)
      }

      if (needsChainSwitchForSigning && originalChainId) {
        const sourceChainName = SUPPORTED_CHAINS.find(c => c.id === originalChainId)?.name || 'source chain'
        setExecutionStatus(`Step 1/3: Switching back to ${sourceChainName}...`)
        try {
          await switchChain?.({ chainId: originalChainId })
          await new Promise(resolve => setTimeout(resolve, 3000))
        } catch (switchError: any) {
          console.warn('Failed to switch back to source chain:', switchError)
        }
      }
      
      const isERC4626 = capturedVault.type?.startsWith('morpho')
      const functionName = capturedVault.hasSettlement
        ? 'depositWithIntentCrossChainRequest'
        : (isERC4626 ? 'depositWithIntentCrossChainERC4626' : 'depositWithIntentCrossChain')
      const callData = encodeFunctionData({
        abi: DEPOSIT_ROUTER_ABI,
        functionName,
        args: [[intent.user, intent.vault, intent.asset, intent.amount, intent.nonce, intent.deadline], signature as `0x${string}`, resolvedReferrer || '0x0000000000000000000000000000000000000000'],
      })
      
      console.log('Encoded callData:', callData)

      setExecutionStatus('Step 2/3: Finding bridge that supports automatic deposit...')
      
      const bridgeFromRegularQuote = getBridgeFromQuote(capturedQuote.quote)
      const preferredBridges = bridgeFromRegularQuote ? [bridgeFromRegularQuote] : undefined
      
      const toTokenForContractCall = capturedVault.asset.address as Address
      
      const crossChainSlippage = 0.05

      let quoteWithCall = await getQuoteWithContractCall(
        capturedFromChainId,
        capturedFromToken.address,
        parsedFromAmount.toString(),
        capturedVault.chainId,
        toTokenForContractCall,
        address,
        depositRouterAddress,
        callData,
        preferredBridges,
        crossChainSlippage
      )

      if (!quoteWithCall || !quoteWithCall.transactionRequest) {
        console.warn(`Bridge ${bridgeFromRegularQuote} does not support contract calls, trying other bridges...`)
        setExecutionStatus('Step 2/3: Trying alternative bridges that support automatic deposit...')

        quoteWithCall = await getQuoteWithContractCall(
          capturedFromChainId,
          capturedFromToken.address,
          parsedFromAmount.toString(),
          capturedVault.chainId,
          toTokenForContractCall,
          address,
          depositRouterAddress,
          callData,
          undefined,
          crossChainSlippage
        )
      }

      if (!quoteWithCall || !quoteWithCall.transactionRequest) {
        console.warn('⚠️ Contract call quote not available - falling back to regular bridge flow')
        console.warn('User will complete deposit manually on destination chain after bridge')
        
        setExecutionStatus('⚠️ Automatic deposit not available for this route. Bridge will complete, then you can finish deposit on destination chain.')
        
        const transactionRequest = capturedQuote.quote!.transactionRequest
        if (!transactionRequest) {
          throw new Error('No transaction request available')
        }
        
        const isNative = capturedFromToken.isNative || isNativeToken(capturedFromToken.address)
        
        if (!isNative) {
          const sourceChainConfig = chainConfigs[capturedFromChainId]
          const sourcePublicClient = createPublicClient({
            chain: sourceChainConfig,
            transport: http(),
          })

          const quoteFromAmount = capturedQuote.quote?.action?.fromAmount
            ? BigInt(capturedQuote.quote.action.fromAmount)
            : parsedFromAmount
          const approvalAmount = quoteFromAmount + (quoteFromAmount / 100n)

          const allowance = await sourcePublicClient.readContract({
            address: capturedFromToken.address,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [address!, transactionRequest.to as Address],
          }) as bigint

          if (allowance < approvalAmount) {
            setExecutionStatus('Step 2/3: Approving token spend on source chain...')
            setExecutionStep('approving')
            await updateTransactionState('pending', 'approving')

            if (chainId !== capturedFromChainId) {
              await switchChain?.({ chainId: capturedFromChainId })
              await new Promise(resolve => setTimeout(resolve, 3000))
            }

            const approveHash = await walletClient.writeContract({
              address: capturedFromToken.address,
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [transactionRequest.to as Address, approvalAmount],
              chain: chainConfigs[capturedFromChainId],
            })

            setTxHashes(prev => ({ ...prev, approve: approveHash }))
            setExecutionStatus('Waiting for approval...')
            await sourcePublicClient.waitForTransactionReceipt({ hash: approveHash })
          }
        }

        setExecutionStatus('Step 2/3: Please confirm the bridge transaction...')
        setExecutionStep('bridging')
        await updateTransactionState('pending', 'bridging')
        
        bridgeHash = await walletClient.sendTransaction({
          to: transactionRequest.to as Address,
          data: transactionRequest.data as `0x${string}`,
          value: BigInt(transactionRequest.value || '0'),
          chain: chainConfigs[capturedFromChainId],
        })

        setTxHashes(prev => ({ ...prev, bridge: bridgeHash! }))
        setExecutionStatus('Bridge transaction sent! Waiting for confirmation...')
        await updateTransactionState('pending', 'bridging', undefined, { txHash: bridgeHash, status: 'PENDING' }, bridgeHash)
        
        const sourceChainConfig = chainConfigs[capturedFromChainId]
        const sourcePublicClient = createPublicClient({
          chain: sourceChainConfig,
          transport: http(),
        })
        await sourcePublicClient.waitForTransactionReceipt({ hash: bridgeHash })
        
        localStorage.setItem(`pending_deposit_${txId}`, JSON.stringify({
          vaultId: capturedVault.id,
          vaultAddress: capturedVault.address,
          assetAddress: capturedVault.asset.address,
          depositRouterAddress,
          estimatedAmount: depositAmount.toString(),
          userAddress: address,
          chainId: capturedVault.chainId,
          transactionId: txId,
          intent: {
            user: intent.user,
            vault: intent.vault,
            asset: intent.asset,
            amount: intent.amount.toString(),
            nonce: intent.nonce.toString(),
            deadline: intent.deadline.toString(),
          },
          signature,
        }))
        
        await updateTransactionState('pending', 'bridging', undefined, { txHash: bridgeHash, status: 'CONFIRMED' }, bridgeHash)
        
        const bridge = getBridgeFromQuote(capturedQuote.quote)
        console.log('Polling for bridge completion:', bridge)
        
        const pollInterval = setInterval(async () => {
          try {
            const status = await checkTransferStatus(
              bridge,
              capturedFromChainId,
              capturedVault.chainId,
              bridgeHash!
            )

            if (status) {
              setLifiStatus(status)
              const statusValue = status.status || status.sending?.status || 'PENDING'
              const isDone = statusValue === 'DONE' || statusValue === 'COMPLETED'
              const isFailed = statusValue === 'FAILED' || statusValue === 'NOT_FOUND'
              const isPartial = isDone && status.substatus === 'PARTIAL'

              if (isPartial) {
                clearInterval(pollInterval)
                const partialMsg = status.substatusMessage || 'Partial fill: tokens received but may not be deposited to vault'
                await updateTransactionState('partial', 'bridge_partial', partialMsg, status, bridgeHash!)

                setExecutionStep('idle')
                setExecutionStatus(`⚠️ Partial fill: ${partialMsg}`)
                setErrorInfo({ message: partialMsg, txHash: bridgeHash! })
                setShowError(true)
                setExecuting(false)
              } else if (isDone) {
                clearInterval(pollInterval)
                await updateTransactionState('pending', 'bridge_completed', 'Bridge completed - please complete deposit on destination chain', status, bridgeHash!)

                setExecutionStep('depositing')
                setExecutionStatus(`✅ Bridge completed! Switch to ${capturedVault.chain === 'avalanche' ? 'Avalanche' : capturedVault.chain} to complete deposit.`)
                setExecuting(false)
              } else if (isFailed) {
                clearInterval(pollInterval)
                const errMsg = status.error?.message || 'Bridge transaction failed'
                setExecutionStep('idle')
                setExecutionStatus(null)
                setErrorInfo({ message: errMsg, txHash: bridgeHash! })
                setShowError(true)
                await updateTransactionState('failed', 'failed', errMsg, status, bridgeHash!)
                setExecuting(false)
                setTxHashes({})
              } else {
                const substatus = status.substatus || status.sending?.substatus || ''
                setExecutionStatus(`Bridging in progress... ${substatus}`)
                await updateTransactionState('pending', 'bridging', undefined, status, bridgeHash!)
              }
            }
          } catch (err) {
            console.error('Error checking bridge status:', err)
          }
        }, 5000)

        setTimeout(async () => {
          try {
            const status = await checkTransferStatus(bridge, capturedFromChainId, capturedVault.chainId, bridgeHash!)
            if (status) {
              setLifiStatus(status)
            }
          } catch (err) {
            console.error('Error on initial status check:', err)
          }
        }, 2000)

        setTimeout(() => {
          clearInterval(pollInterval)
          if (executionStep !== 'complete' && executionStep !== 'depositing' && executionStep !== 'idle') {
            setExecutionStatus('Bridge is taking longer than expected. Check LI.FI explorer for status.')
            setExecuting(false)
          }
        }, 900000)

        return
      }

      console.log('Got quote with contract call:', quoteWithCall)
      console.log('Source chain:', capturedFromChainId, 'Source token:', capturedFromToken.symbol, capturedFromToken.address)
      console.log('Is native?', capturedFromToken.isNative, isNativeToken(capturedFromToken.address))
      
      if (chainId !== capturedFromChainId) {
        const sourceChainName = SUPPORTED_CHAINS.find(c => c.id === capturedFromChainId)?.name || 'source chain'
        setExecutionStatus(`Step 2/3: Switching to ${sourceChainName}...`)
        await switchChain?.({ chainId: capturedFromChainId })
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
      
      const sourceChainConfig = chainConfigs[capturedFromChainId]
      if (!sourceChainConfig) {
        throw new Error(`Unsupported source chain: ${capturedFromChainId}`)
      }
      
      const sourcePublicClient = createPublicClient({
        chain: sourceChainConfig,
        transport: http(),
      })
      
      const isNative = capturedFromToken.isNative || isNativeToken(capturedFromToken.address)
      
      if (!isNative) {
        console.log('Token is not native, checking allowance on source chain:', capturedFromChainId)

        // Get user's token balance to check if MAX was selected
        const userBalance = await sourcePublicClient.readContract({
          address: capturedFromToken.address,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address!],
        }) as bigint

        const quoteFromAmount = quoteWithCall.action?.fromAmount
          ? BigInt(quoteWithCall.action.fromAmount)
          : parsedFromAmount
        
        // Check if this is a MAX amount (within 0.2% of balance, accounting for fee)
        const feeBps = 10n // 0.1% fee
        const maxAmountAfterFee = userBalance - (userBalance * feeBps / 10000n)
        const isMaxAmount = parsedFromAmount >= (maxAmountAfterFee * 98n / 100n) && parsedFromAmount <= userBalance
        
        // Don't add buffer if MAX was selected - amount already accounts for fee
        // For non-MAX, add minimal buffer (0.1%) for safety
        const approvalAmount = isMaxAmount 
          ? quoteFromAmount 
          : quoteFromAmount + (quoteFromAmount / 1000n) // 0.1% buffer instead of 1%

        console.log('Approval amounts:', {
          userInput: parsedFromAmount.toString(),
          quoteNeeds: quoteFromAmount.toString(),
          approvalWithBuffer: approvalAmount.toString(),
        })

        const allowance = await sourcePublicClient.readContract({
          address: capturedFromToken.address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address!, quoteWithCall.transactionRequest.to as Address],
        }) as bigint

        if (allowance < approvalAmount) {
          setExecutionStatus(`Step 2/3: Approving ${capturedFromToken.symbol} on ${fromChain?.name || 'source chain'}...`)
          setExecutionStep('approving')
          await updateTransactionState('pending', 'approving')

          const approveHash = await walletClient.writeContract({
            address: capturedFromToken.address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [quoteWithCall.transactionRequest.to as Address, approvalAmount],
            chain: chainConfigs[capturedFromChainId],
          })

          setTxHashes(prev => ({ ...prev, approve: approveHash }))
          setExecutionStatus('Waiting for approval...')
          await sourcePublicClient.waitForTransactionReceipt({ hash: approveHash })
        }
      } else {
        console.log('Token is native (ETH), skipping approval')
      }

      setExecutionStatus('Step 3/3: Please confirm the cross-chain deposit...')
      setExecutionStep('bridging')
      await updateTransactionState('pending', 'bridging')
      
      bridgeHash = await walletClient.sendTransaction({
        to: quoteWithCall.transactionRequest.to as Address,
        data: quoteWithCall.transactionRequest.data as `0x${string}`,
        value: BigInt(quoteWithCall.transactionRequest.value || '0'),
        chain: chainConfigs[capturedFromChainId],
      })

      setTxHashes(prev => ({ ...prev, bridge: bridgeHash! }))
      setExecutionStatus('Transaction sent! Waiting for confirmation...')
      await updateTransactionState('pending', 'bridging', undefined, { txHash: bridgeHash, status: 'PENDING' }, bridgeHash)
      
      await publicClient?.waitForTransactionReceipt({ hash: bridgeHash })
      
      setExecutionStep('depositing')
      setExecutionStatus('Confirmed! Bridging and depositing into vault...')
      await updateTransactionState('pending', 'depositing', undefined, { txHash: bridgeHash, status: 'CONFIRMED' }, bridgeHash)

      setUserNonce(intent.nonce + BigInt(1))

      const bridge = getBridgeFromQuote(quoteWithCall)
      console.log('Using bridge for status check:', bridge)
      
      const pollInterval = setInterval(async () => {
        try {
          const status = await checkTransferStatus(
            bridge,
            capturedFromChainId,
            capturedVault.chainId,
            bridgeHash!
          )

          console.log('LI.FI Status:', status)

          if (status) {
            setLifiStatus(status)
            const statusValue = status.status || status.sending?.status || 'PENDING'
            const isDone = statusValue === 'DONE' || statusValue === 'COMPLETED'
            const isFailed = statusValue === 'FAILED' || statusValue === 'NOT_FOUND'
            const isPartial = isDone && status.substatus === 'PARTIAL'

            if (isPartial) {
              clearInterval(pollInterval)
              const partialMsg = status.substatusMessage || 'Partial fill: tokens received on destination chain but not deposited to vault'

              setExecutionStep('idle')
              setExecutionStatus(`⚠️ Partial fill: ${partialMsg}`)
              await updateTransactionState('partial', 'bridge_partial', partialMsg, status, bridgeHash!)

              setErrorInfo({ message: `Partial fill: ${partialMsg}. Check your wallet on the destination chain.`, txHash: bridgeHash! })
              setShowError(true)
              setExecuting(false)
              setTransactionId(null)
              setTxHashes({})
            } else if (isDone) {
              clearInterval(pollInterval)

              setExecutionStep('complete')
              setExecutionStatus('🎉 Cross-chain deposit completed! Shares issued to your wallet.')
              await updateTransactionState('completed', 'completed', undefined, status, bridgeHash!)

              setSuccessTxHashes({
                bridge: bridgeHash || txHashes.bridge,
                deposit: txHashes.deposit,
              })
              setShowSuccess(true)

              setAmount('')
              setQuote(null)
              refetchBalance()
              setExecuting(false)
              setTransactionId(null)
              setTxHashes({})
            } else if (isFailed) {
              clearInterval(pollInterval)
              const errMsg = status.error?.message || status.receiving?.error?.message || 'Transaction failed'
              setExecutionStep('idle')
              setExecutionStatus(null)
              setErrorInfo({ message: errMsg, txHash: bridgeHash! })
              setShowError(true)
              await updateTransactionState('failed', 'failed', errMsg, status, bridgeHash!)
              setExecuting(false)
              setTransactionId(null)
              setTxHashes({})
            } else {
              const substatus = status.substatus || status.sending?.substatus || ''
              setExecutionStatus(`Bridging and depositing... ${substatus}`)
              await updateTransactionState('pending', 'bridging', undefined, status, bridgeHash!)
            }
          }
        } catch (err) {
          console.error('Error checking LI.FI status:', err)
        }
      }, 5000)

      setTimeout(async () => {
        try {
          const status = await checkTransferStatus(bridge, capturedFromChainId, capturedVault.chainId, bridgeHash!)
          if (status) {
            setLifiStatus(status)
            console.log('Initial LI.FI Status:', status)
          }
        } catch (err) {
          console.error('Error on initial status check:', err)
        }
      }, 2000)

      setTimeout(() => {
        clearInterval(pollInterval)
        if (executionStep !== 'complete' && executionStep !== 'idle') {
          setExecutionStatus('Taking longer than expected. Check LI.FI explorer for status.')
          setExecuting(false)
        }
      }, 900000)

    } catch (error: any) {
      console.error('Execution error:', error)
      const errorMessage = error?.shortMessage || error?.message || 'Transaction failed'
      setExecutionStep('idle')
      setExecutionStatus(null)
      setErrorInfo({ message: errorMessage, txHash: bridgeHash || txHashes.bridge })
      setShowError(true)
      setExecuting(false)

      await updateTransactionState('failed', 'error', errorMessage, undefined, bridgeHash || undefined)
      setTxHashes({})
      setTransactionId(null)
    }
  }

  const handleSameChainSwapDeposit = async () => {
    if (!quote || !walletClient || !address || !selectedVault || !fromToken || !quote.quote) return

    setExecuting(true)
    setExecutionStatus('Preparing swap transaction...')

    const txId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    setTransactionId(txId)

    const apiUrl = process.env.NEXT_PUBLIC_INDEXER_API_URL || 'http://localhost:3001'
    const sourceChainKey = SUPPORTED_CHAINS.find(c => c.id === fromChainId)?.name?.toLowerCase() || 'unknown'

    const updateTransactionState = async (status: string, currentStep: string, errorMessage?: string, lifiStatusData?: any, bridgeTxHash?: string) => {
      try {
        await fetch(`${apiUrl}/api/transaction-states`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transaction_id: txId,
            user_address: address,
            source_chain: sourceChainKey,
            destination_chain: selectedVault.chain,
            vault_id: selectedVault.id,
            vault_address: selectedVault.address,
            from_token: fromToken.address,
            from_token_symbol: fromToken.symbol,
            from_amount: parseUnits(amount, fromToken.decimals).toString(),
            to_token: selectedVault.asset.address,
            to_token_symbol: selectedVault.asset.symbol,
            to_amount: quote.estimatedAssets.toString(),
            deposit_router_address: selectedVault.depositRouter,
            status,
            current_step: currentStep,
            error_message: errorMessage || null,
            swap_tx_hash: bridgeTxHash || txHashes.swap || null,
            bridge_tx_hash: bridgeTxHash || txHashes.swap || null,
            deposit_tx_hash: bridgeTxHash || txHashes.deposit || null,
            lifi_status: lifiStatusData ? JSON.stringify(lifiStatusData) : null,
          }),
        })
      } catch (err) {
        console.error('Error updating transaction state:', err)
      }
    }

    try {
      const transactionRequest = quote.quote.transactionRequest
      if (!transactionRequest) throw new Error('No transaction request in quote')

      const fromAmount = parseUnits(amount, fromToken.decimals)
      const isNative = fromToken.isNative || isNativeToken(fromToken.address)
      const txValue = BigInt(transactionRequest.value || '0')

      if (isNative) {
        const balance = await publicClient?.getBalance({ address: address! })
        if (!balance) throw new Error('Failed to fetch balance')
        
        const gasPrice = await publicClient?.getGasPrice()
        const estimatedGasCost = gasPrice ? gasPrice * BigInt(200000) : BigInt(0)
        
        if (balance < txValue + estimatedGasCost) {
          throw new Error(`Insufficient balance. You need ${formatUnits(txValue + estimatedGasCost, 18)} ETH (including gas), but you have ${formatUnits(balance, 18)} ETH`)
        }
      } else {
        const balance = await publicClient?.readContract({
          address: fromToken.address,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address!],
        }) as bigint

        if (balance < fromAmount) {
          throw new Error(`Insufficient ${fromToken.symbol} balance. You have ${formatUnits(balance, fromToken.decimals)} but need ${formatUnits(fromAmount, fromToken.decimals)}`)
        }

        const nativeBalance = await publicClient?.getBalance({ address: address! })
        const gasPrice = await publicClient?.getGasPrice()
        const estimatedGasCost = gasPrice ? gasPrice * BigInt(200000) : BigInt(0)
        
        if (nativeBalance && nativeBalance < estimatedGasCost) {
          throw new Error(`Insufficient native token balance for gas. You need at least ${formatUnits(estimatedGasCost, 18)} ETH for gas fees`)
        }
      }

      if (!isNative) {
        const quoteFromAmount = quote.quote?.action?.fromAmount
          ? BigInt(quote.quote.action.fromAmount)
          : fromAmount
        const approvalAmount = quoteFromAmount + (quoteFromAmount / 100n)

        const allowance = await publicClient?.readContract({
          address: fromToken.address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, transactionRequest.to as Address],
        }) as bigint

        if (allowance < approvalAmount) {
          setExecutionStatus('Approving token spend...')
          setExecutionStep('approving')
          const approveHash = await walletClient.writeContract({
            address: fromToken.address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [transactionRequest.to as Address, approvalAmount],
          })
          await publicClient?.waitForTransactionReceipt({ hash: approveHash })
        }
      }

      const depositRouterAddress = selectedVault.depositRouter as Address
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const estimatedDepositAmount = quote.estimatedAssets
      const feeAmount = (estimatedDepositAmount * BigInt(10)) / BigInt(10000)
      const depositAmount = estimatedDepositAmount - feeAmount

      if (depositAmount <= 0n) {
        throw new Error('Deposit amount is too small after fees')
      }

      const intent: DepositIntent = {
        user: address!,
        vault: selectedVault.address as Address,
        asset: selectedVault.asset.address as Address,
        amount: depositAmount,
        nonce: userNonce,
        deadline,
      }

      const isERC4626 = selectedVault.type?.startsWith('morpho')
      const isLagoon = selectedVault.type === 'lagoon'
      
      setExecutionStatus('Step 1/2: Please sign the deposit intent...')
      setExecutionStep('idle')
      const signature = await signDepositIntent(intent, chainId, depositRouterAddress, walletClient)
      console.log('Deposit intent signed:', { intent, signature })
      
      const functionName = selectedVault.hasSettlement
        ? 'depositWithIntentCrossChainRequest'
        : (isERC4626 ? 'depositWithIntentCrossChainERC4626' : 'depositWithIntentCrossChain')
      const localFunctionName = isERC4626 ? 'depositWithIntentERC4626' : 'depositWithIntent'
      
      let useContractCall = false
      let freshQuote: any = null
      
      if (quote.hasContractCall && !isLagoon) {
        console.log('Attempting contract call quote: swap + deposit in one transaction')
        
        setExecutionStatus('Preparing swap + deposit transaction...')

        console.log('=== DEPOSIT INTENT DEBUG ===')
        console.log('Vault type:', selectedVault.type)
        console.log('Is ERC4626:', isERC4626)
        console.log('Function name:', functionName)

        const callData = encodeFunctionData({
          abi: DEPOSIT_ROUTER_ABI,
          functionName,
          args: [[intent.user, intent.vault, intent.asset, intent.amount, intent.nonce, intent.deadline], signature as `0x${string}`, resolvedReferrer || '0x0000000000000000000000000000000000000000'],
        })

        const preferredBridges = quote.usedBridge ? [quote.usedBridge] : undefined
        console.log('📌 Using preferred bridges for fresh quote:', preferredBridges)

        freshQuote = await getQuoteWithContractCall(
          fromChainId,
          fromToken.address,
          parseUnits(amount, fromToken.decimals).toString(),
          selectedVault.chainId,
          selectedVault.asset.address as Address,
          address,
          depositRouterAddress,
          callData,
          preferredBridges,
          slippage / 100
        )
        
        if (freshQuote && freshQuote.transactionRequest) {
          useContractCall = true
          console.log('✅ Contract call quote successful - using one-step process')
        } else {
          console.warn('=== CONTRACT CALL QUOTE FAILED - FALLING BACK TO TWO-STEP PROCESS ===')
          console.warn('Will bridge first, then user completes deposit on destination chain')
        }
      } else if (isLagoon) {
        console.log('⚠️ Lagoon vault detected - skipping contract calls')
        console.log('LI.FI composer may not properly support Lagoon vaults with contract calls')
        console.log('Using two-step process (bridge + deposit) instead')
      }
      
      if (useContractCall && freshQuote) {
        console.log('=== FRESH QUOTE RECEIVED ===')
        console.log('Quote transactionRequest.to:', freshQuote.transactionRequest.to)
        console.log('Quote transactionRequest.value:', freshQuote.transactionRequest.value)
        console.log('Quote transactionRequest.data length:', freshQuote.transactionRequest.data?.length)
        console.log('Quote transactionRequest.gasLimit:', freshQuote.transactionRequest.gasLimit)
        console.log('Quote tool:', freshQuote.tool)
        console.log('Quote includedSteps:', freshQuote.includedSteps?.length)

        console.log('Skipping gas estimation - using LI.FI gas estimate (gas estimation would fail because tokens arrive during execution)')

        setExecutionStatus('Step 2/2: Please confirm the swap + deposit transaction...')
        setExecutionStep('swapping')
        await updateTransactionState('pending', 'swapping')
        
        const txRequest = freshQuote.transactionRequest
        const gasParams: any = {}

        const toBigInt = (value: any): bigint | undefined => {
          if (!value) return undefined
          if (typeof value === 'bigint') return value
          if (typeof value === 'string') {
            return value.startsWith('0x') ? BigInt(value) : BigInt(value)
          }
          return BigInt(value)
        }

        if (txRequest.gasLimit) {
          const baseGas = toBigInt(txRequest.gasLimit)!
          gasParams.gas = baseGas + (baseGas * 20n / 100n)
        }

        const eip1559Chains = [1, 8453, 10, 42161]
        const isEip1559Chain = eip1559Chains.includes(fromChainId)
      
      if (!useContractCall) {
        if (isLagoon) {
          setExecutionStatus('⚠️ Lagoon vault: Using two-step process (bridge + deposit)')
        } else {
          setExecutionStatus('⚠️ One-step deposit unavailable. Using bridge + deposit flow...')
        }

          const regularQuote = await getQuote({
            fromChain: fromChainId,
            fromToken: fromToken.address,
            fromAmount: parseUnits(amount, fromToken.decimals).toString(),
            toChain: selectedVault.chainId,
            toToken: selectedVault.asset.address as Address,
            fromAddress: address,
            slippage: slippage / 100,
            order: 'RECOMMENDED',
          })

          if (!regularQuote || !regularQuote.transactionRequest) {
            throw new Error('Failed to get quote for bridging. Please try again.')
          }

          const isNative = fromToken.isNative || isNativeToken(fromToken.address)

          if (!isNative) {
            const sourceChainConfig = chainConfigs[fromChainId]
            const sourcePublicClient = createPublicClient({
              chain: sourceChainConfig,
              transport: http(),
            })

            const parsedFromAmount = parseUnits(amount, fromToken.decimals)
            const quoteFromAmount = regularQuote.action?.fromAmount
              ? BigInt(regularQuote.action.fromAmount)
              : parsedFromAmount
            const approvalAmount = quoteFromAmount + (quoteFromAmount / 100n)

            const allowance = await sourcePublicClient.readContract({
              address: fromToken.address,
              abi: ERC20_ABI,
              functionName: 'allowance',
              args: [address!, regularQuote.transactionRequest.to as Address],
            }) as bigint

            if (allowance < approvalAmount) {
              setExecutionStatus('Step 2/4: Approving token spend...')
              setExecutionStep('approving')
              await updateTransactionState('pending', 'approving')

              const approveHash = await walletClient.writeContract({
                address: fromToken.address,
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [regularQuote.transactionRequest.to as Address, approvalAmount],
                chain: chainConfigs[fromChainId],
              })

              setTxHashes(prev => ({ ...prev, approve: approveHash }))
              setExecutionStatus('Waiting for approval confirmation...')
              await sourcePublicClient.waitForTransactionReceipt({ hash: approveHash })
            }
          }

          setExecutionStatus('Step 3/4: Please confirm the bridge transaction...')
          setExecutionStep('bridging')
          await updateTransactionState('pending', 'bridging')

          const bridgeHash = await walletClient.sendTransaction({
            to: regularQuote.transactionRequest.to as Address,
            data: regularQuote.transactionRequest.data as `0x${string}`,
            value: BigInt(regularQuote.transactionRequest.value || '0'),
            chain: chainConfigs[fromChainId],
          })

          setTxHashes(prev => ({ ...prev, bridge: bridgeHash }))
          setExecutionStatus('Bridge transaction sent! Waiting for confirmation...')
          await updateTransactionState('pending', 'bridging', undefined, { txHash: bridgeHash, status: 'PENDING' }, bridgeHash)

          const sourceChainConfig = chainConfigs[fromChainId]
          const sourcePublicClient = createPublicClient({
            chain: sourceChainConfig,
            transport: http(),
          })
          await sourcePublicClient.waitForTransactionReceipt({ hash: bridgeHash })

          localStorage.setItem(`pending_deposit_${txId}`, JSON.stringify({
            vaultId: selectedVault.id,
            vaultAddress: selectedVault.address,
            assetAddress: selectedVault.asset.address,
            depositRouterAddress,
            estimatedAmount: depositAmount.toString(),
            userAddress: address,
            intent: {
              user: intent.user,
              vault: intent.vault,
              asset: intent.asset,
              amount: intent.amount.toString(),
              nonce: intent.nonce.toString(),
              deadline: intent.deadline.toString(),
            },
            signature,
            functionName,
            bridgeTxHash: bridgeHash,
            fromChainId,
            toChainId: selectedVault.chainId,
            timestamp: Date.now(),
          }))

          setExecutionStatus('Step 4/4: Waiting for bridge to complete...')
          setExecutionStep('bridging')

          const bridge = getBridgeFromQuote(regularQuote)

          let bridgeComplete = false
          let pollCount = 0
          const maxPolls = 60 // 5 minutes max

          while (!bridgeComplete && pollCount < maxPolls) {
            await new Promise(resolve => setTimeout(resolve, 5000))
            pollCount++

            try {
              const status = await checkTransferStatus(bridge, fromChainId, selectedVault.chainId, bridgeHash)
              console.log('Bridge status:', status)

              if (status?.status === 'DONE') {
                if (status.substatus === 'PARTIAL') {
                  const partialMsg = status.substatusMessage || 'Partial fill: tokens received but deposit may have failed'
                  await updateTransactionState('partial', 'bridge_partial', partialMsg, status, bridgeHash)
                  throw new Error(`Partial fill: ${partialMsg}. Check your wallet on the destination chain.`)
                }
                bridgeComplete = true
                setExecutionStatus('Bridge complete! Now completing vault deposit...')
              } else if (status?.status === 'FAILED') {
                throw new Error('Bridge transfer failed')
              }
            } catch (err) {
              console.warn('Error checking bridge status:', err)
            }
          }

          if (!bridgeComplete) {
            setExecutionStatus('Bridge is taking longer than expected. You can complete the deposit from the Pending Transactions section.')
            await updateTransactionState('pending', 'pending_deposit', undefined, { txHash: bridgeHash, status: 'PENDING' }, bridgeHash)
            return
          }

          if (chainId !== selectedVault.chainId) {
            setExecutionStatus('Switching to destination chain...')
            await switchChain?.({ chainId: selectedVault.chainId })
            await new Promise(resolve => setTimeout(resolve, 3000))
          }

          setExecutionStatus('Approving vault deposit...')
          setExecutionStep('approving')

          const destChainConfig = chainConfigs[selectedVault.chainId]
          const destPublicClient = createPublicClient({
            chain: destChainConfig,
            transport: http(),
          })

          const vaultAllowance = await destPublicClient.readContract({
            address: selectedVault.asset.address as Address,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [address!, depositRouterAddress],
          }) as bigint

          if (vaultAllowance < depositAmount) {
            const approveHash = await walletClient.writeContract({
              address: selectedVault.asset.address as Address,
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [depositRouterAddress, depositAmount * 2n], // Approve extra for slippage
              chain: chainConfigs[selectedVault.chainId],
            })

            setTxHashes(prev => ({ ...prev, approve: approveHash }))
            await destPublicClient.waitForTransactionReceipt({ hash: approveHash })
          }

          setExecutionStatus('Please confirm the vault deposit...')
          setExecutionStep('depositing')

          const depositHash = await walletClient.writeContract({
            address: depositRouterAddress,
            abi: DEPOSIT_ROUTER_ABI,
            functionName: localFunctionName,
            args: [[intent.user, intent.vault, intent.asset, intent.amount, intent.nonce, intent.deadline], signature as `0x${string}`, resolvedReferrer || '0x0000000000000000000000000000000000000000'],
            chain: chainConfigs[selectedVault.chainId],
          })

          setTxHashes(prev => ({ ...prev, deposit: depositHash }))
          setExecutionStatus('Deposit transaction sent! Waiting for confirmation...')

          const depositReceipt = await destPublicClient.waitForTransactionReceipt({ hash: depositHash })

          if (depositReceipt.status === 'reverted') {
            throw new Error('Deposit transaction was reverted')
          }

          localStorage.removeItem(`pending_deposit_${txId}`)
          setExecutionStatus('🎉 Deposit successful! Shares received.')
          setExecutionStep('complete')
          await updateTransactionState('completed', 'completed', undefined, undefined, depositHash)

          setSuccessTxHashes({
            bridge: txHashes.bridge,
            deposit: depositHash,
          })
          setShowSuccess(true)

          setAmount('')
          setQuote(null)
          setExecuting(false)
          setTxHashes({})
          refetchBalance()
          return
        }

        if (isEip1559Chain) {
          if (txRequest.maxFeePerGas) {
            gasParams.maxFeePerGas = toBigInt(txRequest.maxFeePerGas)
            if (txRequest.maxPriorityFeePerGas) {
              gasParams.maxPriorityFeePerGas = toBigInt(txRequest.maxPriorityFeePerGas)
            }
          } else if (txRequest.gasPrice) {
            const gasPrice = toBigInt(txRequest.gasPrice)!
            gasParams.maxFeePerGas = gasPrice + (gasPrice * 10n / 100n)
            gasParams.maxPriorityFeePerGas = gasPrice > 1000000000n ? 1000000000n : gasPrice / 10n
          }
        } else {
          if (txRequest.gasPrice) {
            gasParams.gasPrice = toBigInt(txRequest.gasPrice)
          }
        }
        
        const gasLimitNum = gasParams.gas ? Number(gasParams.gas) : 0
        const gasPriceNum = gasParams.gasPrice 
          ? Number(gasParams.gasPrice) 
          : (gasParams.maxFeePerGas ? Number(gasParams.maxFeePerGas) : 0)
        const estimatedGasCostETH = gasLimitNum && gasPriceNum ? (gasLimitNum * gasPriceNum) / 1e18 : 0
        
        console.log('Sending LI.FI contract call transaction with gas parameters:', {
          to: txRequest.to,
          value: txRequest.value,
          gasLimit: gasParams.gas?.toString(),
          gasPrice: gasParams.gasPrice?.toString(),
          maxFeePerGas: gasParams.maxFeePerGas?.toString(),
          maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas?.toString(),
          estimatedGasCostETH: estimatedGasCostETH.toFixed(6),
          estimatedGasCostUSD: quote.gasCosts || 0,
          note: 'Using LI.FI gas parameters to ensure accurate costs',
        })

        console.log('=== FULL TRANSACTION REQUEST ===')
        console.log('To:', txRequest.to)
        console.log('Value:', txRequest.value)
        console.log('Data (first 200 chars):', txRequest.data?.substring(0, 200))
        console.log('Chain ID:', fromChainId)
        console.log('Gas params:', JSON.stringify(gasParams, (k, v) => typeof v === 'bigint' ? v.toString() : v))

        let swapHash: `0x${string}`
        try {
          swapHash = await walletClient.sendTransaction({
            to: txRequest.to as Address,
            data: txRequest.data as `0x${string}`,
            value: BigInt(txRequest.value || '0'),
            chainId: fromChainId,
            ...gasParams, // Spread all gas parameters - this ensures MetaMask uses LI.FI's estimates
          })
        } catch (sendError: any) {
          console.error('=== TRANSACTION SEND ERROR ===')
          console.error('Error:', sendError)
          console.error('Error message:', sendError?.message)
          console.error('Error shortMessage:', sendError?.shortMessage)
          console.error('Error details:', sendError?.details)
          console.error('Error cause:', sendError?.cause)
          throw new Error(`Failed to send transaction: ${sendError?.shortMessage || sendError?.message || 'Unknown error'}`)
        }
        
        console.log('Transaction sent, hash:', swapHash)
        console.log('Transaction details:', {
          to: txRequest.to,
          value: txRequest.value,
          gasLimit: gasParams.gas?.toString(),
          dataLength: txRequest.data?.length,
        })
        
        setTxHashes({ swap: swapHash, deposit: swapHash }) // Same transaction for both
        setExecutionStatus('Swapping and depositing... Waiting for confirmation...')
        await updateTransactionState('pending', 'depositing', undefined, swapHash)
        
        const receipt = await publicClient?.waitForTransactionReceipt({ 
          hash: swapHash,
          timeout: 120000, // 2 minutes timeout
        })
        
        if (!receipt) {
          throw new Error('Transaction receipt not found')
        }
        
        if (receipt.status === 'reverted') {
          let revertReason = 'Transaction was reverted'
          try {
            const tx = await publicClient?.getTransaction({ hash: swapHash })
            if (tx) {
              try {
                await publicClient?.call({
                  to: tx.to!,
                  data: tx.input,
                  value: tx.value,
                })
              } catch (simError: any) {
                revertReason = simError?.shortMessage || simError?.message || revertReason
              }
            }
          } catch (err) {
            console.error('Could not get revert reason:', err)
          }
          
          throw new Error(`Transaction failed: ${revertReason}. Check the transaction on explorer for more details.`)
        }
        
        await updateTransactionState('completed', 'completed', undefined, swapHash)
        setExecutionStep('complete')
        setExecutionStatus('🎉 Swap and deposit successful!')

        // Save tx hashes for success display
        setSuccessTxHashes({
          swap: swapHash,
        })
        setShowSuccess(true)

        setAmount('')
        setQuote(null)
        setUserNonce(userNonce + BigInt(1))
        refetchBalance()
        setTxHashes({})
        setTransactionId(null)
        setExecuting(false)
        return
      }
    } catch (error: any) {
      console.error('=== SAME CHAIN SWAP DEPOSIT ERROR ===')
      console.error('Error object:', error)
      console.error('Error message:', error?.message)
      console.error('Error shortMessage:', error?.shortMessage)
      console.error('Error details:', error?.details)
      console.error('Error cause:', error?.cause)
      console.error('Error stack:', error?.stack)
      const errorMessage = error?.shortMessage || error?.message || 'Transaction failed'
      setExecutionStep('idle')
      setExecutionStatus(null)

      setErrorInfo({
        message: errorMessage,
        txHash: txHashes.swap || txHashes.bridge || txHashes.deposit,
      })
      setShowError(true)

      try {
        await updateTransactionState('failed', 'error', errorMessage)
      } catch (err) {
        console.error('Error updating failed transaction state:', err)
      }

      setTxHashes({})
      setTransactionId(null)
    } finally {
      setExecuting(false)
    }
  }

  const handleDirectDeposit = async () => {
    if (!walletClient || !address || !selectedVault || !fromToken) return

    setExecuting(true)
    setExecutionStep('approving')
    setExecutionStatus('Preparing transaction...')
    setTxHashes({})

    const txId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    setTransactionId(txId)

    const apiUrl = process.env.NEXT_PUBLIC_INDEXER_API_URL || 'http://localhost:3001'
    const chainIdToKey: Record<number, string> = {
      1: 'ethereum',
      43114: 'avalanche',
      8453: 'base',
      10: 'optimism',
      42161: 'arbitrum',
      56: 'bsc',
    }
    const sourceChainKey = chainIdToKey[fromChainId] || fromChain?.name.toLowerCase() || 'unknown'

    const updateTransactionState = async (status: string, currentStep: string, errorMessage?: string) => {
      try {
        const depositRouterAddress = selectedVault.depositRouter as Address
        const depositAmount = parseUnits(amount, fromToken.decimals)

        await fetch(`${apiUrl}/api/transaction-states`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transaction_id: txId,
            user_address: address,
            source_chain: sourceChainKey,
            destination_chain: selectedVault.chain,
            vault_id: selectedVault.id,
            vault_address: selectedVault.address,
            from_token: fromToken.address,
            from_token_symbol: fromToken.symbol,
            from_amount: depositAmount.toString(),
            to_token: selectedVault.asset.address,
            to_token_symbol: selectedVault.asset.symbol,
            to_amount: depositAmount.toString(),
            deposit_tx_hash: txHashes.deposit || null,
            deposit_router_address: depositRouterAddress,
            status,
            current_step: currentStep,
            error_message: errorMessage || null,
          }),
        })
      } catch (err) {
        console.error('Error updating transaction state:', err)
      }
    }

    try {
      const depositRouterAddress = selectedVault.depositRouter as Address
      if (!depositRouterAddress) throw new Error('Deposit router not configured')

      await updateTransactionState('pending', 'initiated')

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const depositAmount = parseUnits(amount, fromToken.decimals)

      const intent: DepositIntent = {
        user: address,
        vault: selectedVault.address as Address,
        asset: fromToken.address,
        amount: depositAmount,
        nonce: userNonce,
        deadline,
      }

      const signature = await signDepositIntent(intent, chainId, depositRouterAddress, walletClient)

      const isNative = fromToken.isNative || isNativeToken(fromToken.address)

      if (!isNative) {
        const allowance = await publicClient?.readContract({
          address: fromToken.address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, depositRouterAddress],
        }) as bigint

        if (allowance < depositAmount) {
          setExecutionStatus('Approving deposit router...')
          setExecutionStep('approving')
          await updateTransactionState('pending', 'approving')
          const approveHash = await walletClient.writeContract({
            address: fromToken.address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [depositRouterAddress, depositAmount],
          })
          await publicClient?.waitForTransactionReceipt({ hash: approveHash })
        }
      }

      const isERC4626 = selectedVault.type?.startsWith('morpho')
      const functionName = selectedVault.hasSettlement
        ? 'depositWithIntentRequest'
        : (isERC4626 ? 'depositWithIntentERC4626' : 'depositWithIntent')
      setExecutionStatus('Please confirm transaction in your wallet...')
      setExecutionStep('depositing')
      await updateTransactionState('pending', 'depositing')

      const hash = await walletClient.writeContract({
        address: depositRouterAddress,
        abi: DEPOSIT_ROUTER_ABI,
        functionName,
        args: [[intent.user, intent.vault, intent.asset, intent.amount, intent.nonce, intent.deadline], signature as `0x${string}`, resolvedReferrer || '0x0000000000000000000000000000000000000000'],
      })

      setTxHashes({ deposit: hash })
      setExecutionStatus('Deposit submitted! Waiting for confirmation...')
      await publicClient?.waitForTransactionReceipt({ hash })

      await updateTransactionState('completed', 'completed')
      setExecutionStep('complete')
      setExecutionStatus('🎉 Deposit successful!')

      // Save tx hashes for success display
      setSuccessTxHashes({
        deposit: hash,
      })
      setShowSuccess(true)

      setAmount('')
      setQuote(null)
      setUserNonce(userNonce + BigInt(1))
      refetchBalance()
      setExecuting(false)
      setTxHashes({})
      setTransactionId(null)
    } catch (error: any) {
      console.error('Direct deposit error:', error)
      const errorMessage = error?.shortMessage || error?.message || 'Transaction failed'
      setExecutionStep('idle')
      setExecutionStatus(null)
      setErrorInfo({ message: errorMessage, txHash: txHashes.deposit })
      setShowError(true)

      if (txId) {
        try {
          await fetch(`${apiUrl}/api/transaction-states`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transaction_id: txId,
              user_address: address,
              source_chain: sourceChainKey,
              destination_chain: selectedVault.chain,
              status: 'failed',
              current_step: 'error',
              error_message: errorMessage,
              deposit_tx_hash: txHashes.deposit || null,
            }),
          })
        } catch (err) {
          console.error('Error updating failed transaction state:', err)
        }
      }

      setTxHashes({})
      setTransactionId(null)
    } finally {
      setExecuting(false)
    }
  }

  const needsChainSwitch = chainId !== fromChainId
  const hasInsufficientBalance = tokenBalance && amount && parseFloat(amount) > parseFloat(formatUnits(tokenBalance.value, tokenBalance.decimals))
  const canExecute = quote && !executing && !needsChainSwitch && !hasInsufficientBalance && parseFloat(amount) > 0
  const fromChain = SUPPORTED_CHAINS.find(c => c.id === fromChainId)
  const toChain = SUPPORTED_CHAINS.find(c => c.id === selectedVault.chainId)

  const formatTVL = (value: string | undefined) => {
    if (!value) return '$0'
    const num = parseFloat(value) / 1e6
    if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`
    if (num >= 1000) return `$${(num / 1000).toFixed(2)}K`
    return `$${num.toFixed(2)}`
  }

  const formatShares = (shares: bigint | undefined, decimals: number): string => {
    if (!shares || shares === 0n) return '0.0000'
    
    const sharesNum = parseFloat(formatUnits(shares, 18))
    if (sharesNum === 0) return '0.0000'
    if (sharesNum < 0.0001) return sharesNum.toExponential(2)
    if (sharesNum < 0.01) return sharesNum.toFixed(4)
    if (sharesNum < 1) return sharesNum.toFixed(4)
    if (sharesNum < 1000) return sharesNum.toFixed(3)
    return sharesNum.toLocaleString(undefined, { maximumFractionDigits: 3, minimumFractionDigits: 3 })
  }

  const formatTime = (seconds: number | undefined): string => {
    if (!seconds) return '-'
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  }

  const isNativeToken = (tokenAddress: string | Address | undefined): boolean => {
    if (!tokenAddress) return false
    const addr = tokenAddress.toLowerCase()
    return addr === '0x0000000000000000000000000000000000000000' || 
           addr === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Modern Nav */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-2xl font-black bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
              Yieldo
            </Link>
            <Link href="/" className="text-sm font-medium text-gray-700 hover:text-black transition-colors">
              Vaults
            </Link>
            <Link href="/dashboard" className="text-sm font-medium text-gray-700 hover:text-black transition-colors">
              Dashboard
            </Link>
          </div>
          <ConnectButton />
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Vault Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center gap-4 mb-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              selectedVault.type === 'lagoon' 
                ? 'bg-gradient-to-br from-blue-400 to-blue-600' 
                : selectedVault.type?.startsWith('morpho')
                ? 'bg-gradient-to-br from-purple-500 to-indigo-600'
                : 'bg-gradient-to-br from-gray-400 to-gray-600'
            }`}>
              {selectedVault.type === 'lagoon' ? (
                <span className="text-white text-lg font-bold">L</span>
              ) : selectedVault.type?.startsWith('morpho') ? (
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                <span className="text-white text-lg font-bold">V</span>
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <h1 className="text-2xl font-bold text-gray-900">
                  {vaultRating?.vault_name || morphoVaultData?.name || selectedVault.name}
                </h1>
                {vaultRating?.score != null && (() => {
                  const breakdown = vaultRating.score_breakdown ?? {}
                  const { label, style: ratingStyle } = getRatingColor(vaultRating.score)
                  return (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="rounded-lg px-3 py-1.5 text-sm font-bold"
                          style={{ backgroundColor: ratingStyle.backgroundColor, color: ratingStyle.color }}
                        >
                          {Math.round(vaultRating.score)}/100
                        </div>
                        <div className="text-xs text-gray-500">
                          <div className="font-medium text-gray-700">{label}</div>
                          <div className="flex items-center gap-1 mt-0.5">
                            {breakdown.capital != null && (
                              <span className="text-gray-500">C:{Math.round(breakdown.capital)}</span>
                            )}
                            {breakdown.performance != null && (
                              <>
                                <span className="text-gray-300">•</span>
                                <span className="text-gray-500">P:{Math.round(breakdown.performance)}</span>
                              </>
                            )}
                            {breakdown.risk != null && (
                              <>
                                <span className="text-gray-300">•</span>
                                <span className="text-gray-500">R:{Math.round(breakdown.risk)}</span>
                              </>
                            )}
                            {breakdown.userTrust != null && (
                              <>
                                <span className="text-gray-300">•</span>
                                <span className="text-gray-500">UT:{Math.round(breakdown.userTrust)}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <span className="capitalize">{selectedVault.chain}</span>
                <span>•</span>
                <span>{selectedVault.asset.symbol}</span>
              </div>
            </div>
          </div>

          {/* Comprehensive Vault Metrics - Collapsible */}
          {selectedVault && (vaultRating?.metrics || morphoVaultData || loadingVaultRating) && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <button
                onClick={() => setShowVaultMetrics(!showVaultMetrics)}
                className="cursor-pointer text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors flex items-center gap-2"
              >
                <span className="text-purple-600">
                  {vaultRating?.vault_name || morphoVaultData?.name || selectedVault.name}
                </span>
                <span className="text-gray-400">-</span>
                <span>{showVaultMetrics ? 'Hide Vault Info' : 'View Vault Info'}</span>
                {loadingVaultRating && (
                  <span className="text-xs text-gray-400">(Loading...)</span>
                )}
                {vaultRating && !vaultRating.metrics && (
                  <span className="text-xs text-yellow-600">(No metrics data)</span>
                )}
              </button>
              {showVaultMetrics && (<>
              
              {loadingVaultRating ? (
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                    <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : vaultRating?.metrics ? (
                <div className="mt-4 space-y-4">
                  {/* Key Metrics - Simplified */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {typeof vaultRating.metrics.tvlUsd === 'number' && (
                      <div className="bg-gradient-to-br from-gray-50 to-slate-50 rounded-xl p-4 text-center">
                        <p className="text-xs text-gray-600 mb-1">TVL</p>
                        <p className="text-xl font-bold text-gray-900">
                          ${(vaultRating.metrics.tvlUsd / 1e6).toFixed(2)}M
                        </p>
                      </div>
                    )}
                    {typeof vaultRating.metrics.netApy === 'number' ? (
                      <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 text-center">
                        <p className="text-xs text-green-600 mb-1">Net APY</p>
                        <p className="text-xl font-bold text-green-700">{(vaultRating.metrics.netApy * 100).toFixed(2)}%</p>
                      </div>
                    ) : typeof vaultRating.metrics.apy === 'number' && (
                      <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 text-center">
                        <p className="text-xs text-green-600 mb-1">APY</p>
                        <p className="text-xl font-bold text-green-700">{(vaultRating.metrics.apy * 100).toFixed(2)}%</p>
                      </div>
                    )}
                    {typeof vaultRating.metrics.sharePrice === 'number' && (
                      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 text-center">
                        <p className="text-xs text-blue-600 mb-1">Share Price</p>
                        <p className="text-xl font-bold text-blue-700">
                          {vaultRating.metrics.sharePrice.toFixed(4)}
                        </p>
                      </div>
                    )}
                    <div className="bg-gradient-to-br from-gray-50 to-slate-50 rounded-xl p-4 text-center">
                      <p className="text-xs text-gray-600 mb-1">Fees</p>
                      <p className="text-xl font-bold text-gray-900">
                        {(() => {
                          const isLagoon = selectedVault.type === 'lagoon'
                          const formatFee = (fee: number) => isLagoon ? (fee / 100).toFixed(2) : (fee * 100).toFixed(2)
                          
                          if (typeof vaultRating.metrics.performanceFee === 'number' && typeof vaultRating.metrics.managementFee === 'number') {
                            return `${formatFee(vaultRating.metrics.performanceFee)}% / ${formatFee(vaultRating.metrics.managementFee)}%`
                          } else if (typeof vaultRating.metrics.performanceFee === 'number') {
                            return `${formatFee(vaultRating.metrics.performanceFee)}%`
                          } else if (typeof vaultRating.metrics.managementFee === 'number') {
                            return `${formatFee(vaultRating.metrics.managementFee)}%`
                          }
                          return '—'
                        })()}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">Perf / Mgmt</p>
                    </div>
                  </div>

                  {/* Vault Info */}
                  {(vaultRating?.metrics?.curatorInfo || vaultRating?.metrics?.description) && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 mb-3 uppercase tracking-wide">Vault Information</h4>
                      <div className="bg-gradient-to-br from-gray-50 to-slate-50 rounded-xl p-4 space-y-3">
                        {vaultRating?.metrics?.curatorInfo && (
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-600 font-medium">Curator:</span>
                            <div className="flex items-center gap-2">
                              {vaultRating.metrics.curatorInfo.image && (
                                <img src={vaultRating.metrics.curatorInfo.image} alt="" className="w-6 h-6 rounded-full" />
                              )}
                              <span className="text-sm font-semibold text-gray-900">
                                {vaultRating.metrics.curatorInfo.name}
                              </span>
                              {vaultRating.metrics.curatorInfo.verified && (
                                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Verified</span>
                              )}
                            </div>
                            {vaultRating.metrics.curatorInfo.url && (
                              <a
                                href={vaultRating.metrics.curatorInfo.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline"
                              >
                                Visit →
                              </a>
                            )}
                          </div>
                        )}
                        {vaultRating?.metrics?.description && (
                          <div>
                            <p className="text-xs text-gray-600 font-medium mb-1">Description:</p>
                            <p className="text-sm text-gray-700 leading-relaxed">
                              {vaultRating.metrics.description}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* User Position (if connected) - Show Yieldo AUM instead of on-chain balance */}
                  {address && (vaultAUM || (morphoVaultData?.userShares && BigInt(morphoVaultData.userShares) > 0n)) && (
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4">
                      <h4 className="text-xs font-semibold text-blue-700 mb-2">Your Position (Yieldo)</h4>
                      <div className="flex gap-6">
                        {vaultAUM && parseFloat(vaultAUM.aum) > 0 && (
                          <>
                            <div>
                              <p className="text-xs text-blue-500">AUM (Yieldo)</p>
                              <p className="font-bold text-blue-900">
                                ${(parseFloat(vaultAUM.aum) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-blue-500">Deposits</p>
                              <p className="font-bold text-blue-900">
                                ${(parseFloat(vaultAUM.deposits) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                              </p>
                            </div>
                          </>
                        )}
                        {morphoVaultData?.userShares && BigInt(morphoVaultData.userShares) > 0n && !vaultAUM && (
                          <>
                            <div>
                              <p className="text-xs text-blue-500">Shares</p>
                              <p className="font-bold text-blue-900">{(Number(morphoVaultData.userShares) / 10 ** 18).toLocaleString(undefined, { maximumFractionDigits: 4 })}</p>
                            </div>
                            <div>
                              <p className="text-xs text-blue-500">Value</p>
                              <p className="font-bold text-blue-900">
                                {morphoVaultData.userAssetsUsd ? `$${morphoVaultData.userAssetsUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}` :
                                  `${(Number(morphoVaultData.userAssets || 0) / 10 ** morphoVaultData.assetDecimals).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${morphoVaultData.assetSymbol}`}
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                      {vaultAUM && parseFloat(vaultAUM.aum) > 0 && (
                        <p className="text-xs text-gray-500 mt-2">Based on Yieldo deposits only</p>
                      )}
                    </div>
                  )}
                </div>
              ) : morphoVaultData ? (
                <div className="mt-4 space-y-4">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center">
                    <p className="text-sm text-yellow-800">
                      Vault rating data not available. Showing basic metrics from Morpho API.
                    </p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 mb-3 uppercase tracking-wide">Performance</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {morphoVaultData.dailyApy != null && (
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-green-600 mb-1">24h APY</p>
                  <p className="text-lg font-bold text-green-700">{(morphoVaultData.dailyApy || 0).toFixed(2)}%</p>
                </div>
                      )}
                      {morphoVaultData.weeklyApy != null && (
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-green-600 mb-1">7d APY</p>
                  <p className="text-lg font-bold text-green-700">{(morphoVaultData.weeklyApy || 0).toFixed(2)}%</p>
                </div>
                      )}
                      {morphoVaultData.monthlyApy != null && (
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-green-600 mb-1">30d APY</p>
                  <p className="text-lg font-bold text-green-700">{(morphoVaultData.monthlyApy || 0).toFixed(2)}%</p>
                </div>
                      )}
                      {morphoVaultData.performanceFee != null && (
                <div className="bg-gradient-to-br from-gray-50 to-slate-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-500 mb-1">Fee</p>
                  <p className="text-lg font-bold text-gray-700">{(morphoVaultData.performanceFee || 0).toFixed(1)}%</p>
                        </div>
                      )}
                </div>
              </div>
              {address && (vaultAUM || (morphoVaultData.userShares && BigInt(morphoVaultData.userShares) > 0n)) && (
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4">
                      <h4 className="text-xs font-semibold text-blue-700 mb-2">Your Position (Yieldo)</h4>
                      <div className="flex gap-6">
                        {vaultAUM && parseFloat(vaultAUM.aum) > 0 && (
                          <>
                            <div>
                              <p className="text-xs text-blue-500">AUM (Yieldo)</p>
                              <p className="font-bold text-blue-900">
                                ${(parseFloat(vaultAUM.aum) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-blue-500">Deposits</p>
                              <p className="font-bold text-blue-900">
                                ${(parseFloat(vaultAUM.deposits) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                              </p>
                            </div>
                          </>
                        )}
                        {morphoVaultData.userShares && BigInt(morphoVaultData.userShares) > 0n && !vaultAUM && (
                          <>
                            <div>
                              <p className="text-xs text-blue-500">Shares</p>
                              <p className="font-bold text-blue-900">{(Number(morphoVaultData.userShares) / 10 ** 18).toLocaleString(undefined, { maximumFractionDigits: 4 })}</p>
                            </div>
                            <div>
                              <p className="text-xs text-blue-500">Value</p>
                              <p className="font-bold text-blue-900">
                                {morphoVaultData.userAssetsUsd ? `$${morphoVaultData.userAssetsUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}` :
                                  `${(Number(morphoVaultData.userAssets || 0) / 10 ** morphoVaultData.assetDecimals).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${morphoVaultData.assetSymbol}`}
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                      {vaultAUM && parseFloat(vaultAUM.aum) > 0 && (
                        <p className="text-xs text-gray-500 mt-2">Based on Yieldo deposits only</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 text-center py-8">
                  <p className="text-gray-500">No vault metrics available. Please try refreshing the page.</p>
                </div>
              )}
            </>)}
            </div>
          )}
        </div>

        {/* Main Content Grid - 2 columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Deposit Form */}
          <div className="space-y-6">
            {!isConnected ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <p className="text-gray-600 mb-4">Connect your wallet to start depositing</p>
                <ConnectButton />
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
                <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <span className="w-8 h-8 bg-gradient-to-br from-gray-900 to-gray-700 rounded-lg flex items-center justify-center text-white text-sm">$</span>
                  Deposit
                </h2>

                <div className="mb-4">
                  <PendingTransactions
                    excludeTransactionId={transactionId}
                    onResume={async (tx) => {
                      
                      const vault = tx.vault_id ? getVaultById(tx.vault_id) : null
                      if (!vault) {
                        alert('Could not find vault for this transaction')
                        return
                      }
                      
                      
                      if (chainId !== vault.chainId) {
                        alert(`Please switch to ${vault.chain === 'avalanche' ? 'Avalanche' : vault.chain} to complete this deposit`)
                        return
                      }
                      
                     
                      let estimatedAmount = BigInt(tx.to_amount || '0')
                      try {
                        if (tx.lifi_status) {
                          const lifiStatus = JSON.parse(tx.lifi_status)
                          if (lifiStatus.receiving?.amount) {
                            estimatedAmount = BigInt(lifiStatus.receiving.amount)
                          }
                        }
                      } catch {}
                      
                      if (estimatedAmount === BigInt(0)) {
                        alert('Could not determine deposit amount')
                        return
                      }
                      
                      
                      setSelectedVaultId(vault.id)
                      setExecuting(true)
                      setTransactionId(tx.transaction_id)
                      setExecutionStep('depositing')
                      
                      try {
                        await executeVaultDeposit(
                          vault,
                          estimatedAmount,
                          tx.transaction_id,
                          tx.bridge_tx_hash || ''
                        )
                      } catch (error: any) {
                        setExecutionStatus(`Deposit failed: ${error.message}`)
                        setExecuting(false)
                      }
                    }}
                  />
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">From Chain</label>
                    <CustomSelect
                      options={SUPPORTED_CHAINS.map(chain => ({
                        value: chain.id.toString(),
                        label: chain.name,
                        logoURI: chain.logoURI,
                      }))}
                      value={fromChainId.toString()}
                      onChange={(val) => {
                        setFromChainId(Number(val))
                        setFromToken(null)
                      }}
                    />
                  </div>

                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700">Token</label>
                      {fromToken && tokenBalance && (
                        <span className="text-sm text-gray-500">
                          Balance: {parseFloat(formatUnits(tokenBalance.value, tokenBalance.decimals)).toFixed(4)} {fromToken.symbol}
                        </span>
                      )}
                    </div>
                    {loadingTokens ? (
                      <div className="border-2 border-gray-300 rounded-lg px-4 py-3 text-gray-500">Loading tokens...</div>
                    ) : (
                      <CustomSelect
                        options={[
                          { value: '', label: 'Select token' },
                          ...availableTokens.map(token => ({
                            value: token.address,
                            label: `${token.symbol}${token.name ? ` - ${token.name}` : ''}`,
                            logoURI: token.logoURI,
                          }))
                        ]}
                        value={fromToken?.address || ''}
                        onChange={(val) => {
                          const token = availableTokens.find(t => t.address === val)
                          setFromToken(token || null)
                        }}
                      />
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Amount</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-lg focus:bg-white focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none transition-all"
                      />
                      <button
                        onClick={() => {
                          if (tokenBalance) {
                            // Calculate MAX amount: balance - fee (0.1% = 10 bps)
                            const balance = tokenBalance.value
                            const feeBps = 10n // 0.1% fee
                            const feeAmount = (balance * feeBps) / 10000n
                            const maxAmount = balance - feeAmount
                            const maxAmountFormatted = formatUnits(maxAmount, tokenBalance.decimals)
                            setAmount(maxAmountFormatted)
                          }
                        }}
                        className="px-4 py-3 bg-gray-900 text-white hover:bg-gray-800 rounded-xl font-medium transition-colors"
                      >
                        Max
                      </button>
                    </div>
                    {hasInsufficientBalance && (
                      <p className="mt-2 text-sm text-red-500">Amount exceeds your available balance</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Referral (optional)</label>
                    <input
                      type="text"
                      value={referralInput}
                      onChange={(e) => setReferralInput(e.target.value)}
                      placeholder="ENS name or 0x address"
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:outline-none transition-all"
                    />
                    {resolvingReferral && (
                      <p className="mt-1 text-xs text-gray-500">Resolving ENS...</p>
                    )}
                    {referralError && !resolvingReferral && (
                      <p className="mt-1 text-xs text-red-500">{referralError}</p>
                    )}
                    {resolvedReferrer && !resolvingReferral && !referralError && (
                      <p className="mt-1 text-xs text-green-600">
                        {referralInput.endsWith('.eth')
                          ? `Resolved: ${resolvedReferrer.slice(0, 6)}...${resolvedReferrer.slice(-4)}`
                          : 'Valid address'}
                      </p>
                    )}
                  </div>

                  {needsChainSwitch && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <p className="text-amber-800 mb-2 text-sm">Please switch to {fromChain?.name} network</p>
                      <button
                        onClick={() => switchChain({ chainId: fromChainId })}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors"
                      >
                        Switch Network
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Transaction History */}
            {address && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <TransactionHistory />
              </div>
            )}

          </div>

          {/* Right Column - Quote & Actions */}
          <div className="space-y-6">
            {/* Quote Card */}
            {loadingQuote && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-center gap-3">
                  <div className="w-5 h-5 border-2 border-gray-900 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-gray-600">Fetching best route...</span>
                </div>
              </div>
            )}

            {quote && !loadingQuote && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 lg:sticky lg:top-20">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-lg">Quote Summary</h3>
                  {quote?.hasContractCall && (
                    <div className="flex items-center gap-2">
                    <span className="text-xs bg-gradient-to-r from-green-100 to-emerald-100 text-green-700 px-3 py-1 rounded-full font-medium">
                      Auto-deposit
                    </span>
                      <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 rounded-full border border-gray-200">
                        <span className="text-xs text-gray-500">Powered by</span>
                        <img src="/lifi.png" alt="LI.FI" className="h-3.5" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Pay/Receive Card */}
                <div className="bg-gradient-to-br from-gray-50 to-slate-50 rounded-xl p-4 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Pay</span>
                    <span className="font-semibold">{amount} {fromToken?.symbol}</span>
                  </div>
                  <div className="flex justify-center my-1">
                    <span className="text-gray-400">↓</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Receive</span>
                    <span className="font-semibold text-green-600">{formatShares(quote.estimatedShares, 18)} Shares</span>
                  </div>
                </div>

                {/* Key Details - Horizontal */}
                <div className="flex flex-wrap gap-3 text-xs mb-4">
                  <div className="flex items-center gap-1.5 bg-gray-100 rounded-lg px-3 py-1.5">
                    <span className="text-gray-500">Est.</span>
                    <span className="font-semibold">{parseFloat(formatUnits(quote.estimatedAssets, selectedVault.asset.decimals)).toFixed(2)} {selectedVault.asset.symbol}</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-gray-100 rounded-lg px-3 py-1.5">
                    <span className="text-gray-500">Fee</span>
                    <span className="font-semibold">{parseFloat(formatUnits(quote.feeAmount, selectedVault.asset.decimals)).toFixed(4)}</span>
                  </div>
                  {quote.estimatedTime && (
                    <div className="flex items-center gap-1.5 bg-blue-50 rounded-lg px-3 py-1.5">
                      <span className="text-blue-500">Time</span>
                      <span className="font-semibold text-blue-700">{formatTime(quote.estimatedTime)}</span>
                    </div>
                  )}
                  {quote.gasCosts !== undefined && quote.gasCosts > 0 && (
                    <div className="flex items-center gap-1.5 bg-gray-100 rounded-lg px-3 py-1.5">
                      <span className="text-gray-500">Gas</span>
                      <span className="font-semibold">${quote.gasCosts.toFixed(2)}</span>
                    </div>
                  )}
                </div>

                {/* Route Info - Inline */}
                {quote.stepDetails && quote.stepDetails.length > 0 && (
                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-4 flex-wrap">
                    <span className="font-medium">Route:</span>
                    {quote.stepDetails.map((step, idx) => (
                      <span key={idx} className="flex items-center gap-1">
                        {step.logoURI && <img src={step.logoURI} alt="" className="w-4 h-4 rounded" />}
                        <span className="font-medium text-gray-700">{step.tool}</span>
                        {idx < quote.stepDetails!.length - 1 && <span className="text-gray-400 mx-1">→</span>}
                      </span>
                    ))}
                  </div>
                )}

                {/* Warnings */}
                {quote.priceImpact !== undefined && quote.priceImpact > 1 && (
                  <div className={`text-xs p-3 rounded-xl mb-3 ${quote.priceImpact > 2 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                    ⚠️ Price impact: {quote.priceImpact.toFixed(2)}%
                  </div>
                )}

                {quote?.hasContractCall && (
                  <div className="text-xs p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 mb-3">
                    <strong>Note:</strong> MetaMask may show "likely to fail" - this is normal.
                  </div>
                )}

                {executing && (
                  <div className="mt-4 space-y-4">
                    <TransactionLoader
                      step={executionStep}
                      status={executionStatus}
                      txHashes={txHashes}
                      sourceChainId={fromChainId}
                      destChainId={selectedVault.chainId}
                    />
                    {transactionId && (
                      <TransactionStatus
                        transactionId={transactionId}
                        userAddress={address as Address}
                      />
                    )}
                  </div>
                )}

                {/* Success Message - Persistent until dismissed */}
                {showSuccess && (
                  <div className="mt-4 bg-green-50 border-2 border-green-400 rounded-lg p-4 relative">
                    <button
                      onClick={() => {
                        setShowSuccess(false)
                        setSuccessTxHashes({})
                        setExecutionStatus(null)
                        setExecutionStep('idle')
                      }}
                      className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-full transition-colors"
                      title="Dismiss"
                    >
                      ✕
                    </button>

                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-2xl">🎉</span>
                      <h3 className="text-lg font-bold text-green-800">Transaction Successful!</h3>
                    </div>

                    <p className="text-green-700 mb-3">Your deposit has been completed. Shares have been issued to your wallet.</p>

                    <div className="space-y-2">
                      {successTxHashes.swap && (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-green-600">✓</span>
                          <span className="text-gray-600">Swap:</span>
                          <a
                            href={`https://scan.li.fi/tx/${successTxHashes.swap}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline font-mono"
                          >
                            {successTxHashes.swap.slice(0, 10)}...{successTxHashes.swap.slice(-6)}
                          </a>
                        </div>
                      )}
                      {successTxHashes.bridge && (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-green-600">✓</span>
                          <span className="text-gray-600">Bridge:</span>
                          <a
                            href={`https://scan.li.fi/tx/${successTxHashes.bridge}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline font-mono"
                          >
                            {successTxHashes.bridge.slice(0, 10)}...{successTxHashes.bridge.slice(-6)}
                          </a>
                        </div>
                      )}
                      {successTxHashes.deposit && (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-green-600">✓</span>
                          <span className="text-gray-600">Deposit:</span>
                          <a
                            href={`${
                              selectedVault.chainId === 8453 ? 'https://basescan.org/tx/' :
                              selectedVault.chainId === 43114 ? 'https://snowtrace.io/tx/' :
                              selectedVault.chainId === 1 ? 'https://etherscan.io/tx/' :
                              'https://etherscan.io/tx/'
                            }${successTxHashes.deposit}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline font-mono"
                          >
                            {successTxHashes.deposit.slice(0, 10)}...{successTxHashes.deposit.slice(-6)}
                          </a>
                        </div>
                      )}
                    </div>

                    {(successTxHashes.swap || successTxHashes.bridge) && (
                      <div className="mt-3 pt-3 border-t border-green-300">
                        <a
                          href={`https://scan.li.fi/tx/${successTxHashes.bridge || successTxHashes.swap}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-purple-600 hover:underline font-medium text-sm"
                        >
                          🔗 View full details on LI.FI Explorer ↗
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {/* Error Status - Persistent until dismissed */}
                {showError && errorInfo && (
                  <div className="mt-4 bg-red-50 border-2 border-red-400 rounded-lg p-4 relative">
                    <button
                      onClick={() => {
                        setShowError(false)
                        setErrorInfo(null)
                      }}
                      className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-full transition-colors"
                      title="Dismiss"
                    >
                      ✕
                    </button>

                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-2xl">❌</span>
                      <h3 className="text-lg font-bold text-red-800">Transaction Failed</h3>
                    </div>

                    <p className="text-red-700 mb-3">{errorInfo.message}</p>

                    {errorInfo.txHash && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-gray-600">Transaction:</span>
                          <a
                            href={`https://scan.li.fi/tx/${errorInfo.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline font-mono"
                          >
                            {errorInfo.txHash.slice(0, 10)}...{errorInfo.txHash.slice(-6)}
                          </a>
                        </div>
                        <div className="flex gap-2 text-sm">
                          <a
                            href={`https://scan.li.fi/tx/${errorInfo.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-purple-600 hover:underline"
                          >
                            🔗 Check on LI.FI Explorer
                          </a>
                          <span className="text-gray-300">|</span>
                          <a
                            href={`${
                              fromChainId === 8453 ? 'https://basescan.org/tx/' :
                              fromChainId === 43114 ? 'https://snowtrace.io/tx/' :
                              fromChainId === 1 ? 'https://etherscan.io/tx/' :
                              fromChainId === 42161 ? 'https://arbiscan.io/tx/' :
                              fromChainId === 10 ? 'https://optimistic.etherscan.io/tx/' :
                              'https://etherscan.io/tx/'
                            }${errorInfo.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            🔍 Check on Block Explorer
                          </a>
                        </div>
                      </div>
                    )}

                    <p className="text-xs text-gray-500 mt-3">
                      Try refreshing the quote or adjusting the amount. If the issue persists, check the transaction details.
                    </p>
                  </div>
                )}

                <button
                  onClick={handleExecute}
                  disabled={!canExecute}
                  className="w-full mt-4 py-4 bg-gradient-to-r from-gray-900 to-gray-800 text-white rounded-xl font-bold text-lg hover:from-gray-800 hover:to-gray-700 disabled:from-gray-300 disabled:to-gray-300 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl disabled:shadow-none"
                >
                  {executing ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Processing...
                    </span>
                  ) : needsChainSwitch ? 'Switch Network First' : 'Deposit'}
                </button>
              </div>
            )}

            {/* Vault at Capacity */}
            {vaultCapacityError && !loadingQuote && (
              <div className="bg-amber-50 rounded-2xl shadow-sm border border-amber-200 p-6 text-center">
                <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <p className="text-amber-700 text-sm font-medium">{vaultCapacityError}</p>
              </div>
            )}

            {/* No Quote Available */}
            {!quote && !loadingQuote && !vaultCapacityError && amount && fromToken && !needsChainSwitch && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-gray-500 text-sm">Unable to get quote. Try a different amount or token.</p>
              </div>
            )}

            {/* Empty State */}
            {!quote && !loadingQuote && (!amount || !fromToken) && (
              <div className="bg-gradient-to-br from-gray-50 to-slate-50 rounded-2xl border border-gray-200 p-8 text-center">
                <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-gray-700 mb-1">Ready to Deposit</h3>
                <p className="text-sm text-gray-500">Select a token and enter an amount to see your quote</p>
              </div>
            )}
          </div>
        </div>

        {/* Top Depositors & Composite Score - Side by Side */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Top Depositors */}
          {selectedVault?.type?.startsWith('morpho') && (
            <div className="h-full">
              <WhaleWatcher
                vaultAddress={selectedVault.address}
                chainId={selectedVault.chainId}
                minPositionUsd={100}
                maxWhales={12}
              />
            </div>
          )}

          {/* Right: Composite Score & Breakdown */}
          {vaultRating && vaultRating.metrics && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden h-full flex flex-col">
              <div className="p-6 flex-1 flex flex-col">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Composite Score</h2>
                {(() => {
                  const score = vaultRating.score ?? null
                  const breakdown = vaultRating.score_breakdown ?? {}
                  const { label, style: ratingStyle } = getRatingColor(score)
                  const isMorpho = selectedVault.type?.startsWith('morpho')
                  
                  return (
                    <div className="space-y-6 flex-1">
                      <div className="flex flex-wrap items-center gap-6">
                        <div
                          className="rounded-xl px-6 py-4"
                          style={{ backgroundColor: ratingStyle.backgroundColor, color: ratingStyle.color }}
                        >
                          <span className="text-4xl font-bold">{score != null ? Math.round(score) : '—'}</span>
                          <span className="ml-2 text-lg opacity-90">/ 100</span>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{label}</p>
                          <p className="text-sm text-gray-500">Updated {vaultRating.updated_at ? new Date(vaultRating.updated_at).toLocaleString() : '—'}</p>
                        </div>
                      </div>
                      
                      <div className="pt-4 border-t border-gray-100">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-4">Score Breakdown</h3>
                        <div className={`grid grid-cols-1 gap-4 ${breakdown.userTrust != null ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
                          <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-xs font-medium text-gray-500 uppercase mb-2">Capital ({breakdown.userTrust != null ? '20%' : '25%'})</p>
                            <p className="text-2xl font-bold text-gray-900">{breakdown.capital != null ? Math.round(breakdown.capital) : '—'}</p>
                            <p className="text-xs text-gray-400 mt-1">{isMorpho ? 'TVL, liquidity, positions' : 'TVL size'}</p>
                          </div>
                          <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-xs font-medium text-gray-500 uppercase mb-2">Performance ({breakdown.userTrust != null ? '30%' : '35%'})</p>
                            <p className="text-2xl font-bold text-gray-900">{breakdown.performance != null ? Math.round(breakdown.performance) : '—'}</p>
                            <p className="text-xs text-gray-400 mt-1">{isMorpho ? 'APY (daily, weekly, monthly)' : 'APR (7d, 30d, all-time)'}</p>
                          </div>
                          <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-xs font-medium text-gray-500 uppercase mb-2">Risk ({breakdown.userTrust != null ? '30%' : '40%'})</p>
                            <p className="text-2xl font-bold text-gray-900">{breakdown.risk != null ? Math.round(breakdown.risk) : '—'}</p>
                            <p className="text-xs text-gray-400 mt-1">{isMorpho ? 'Depeg, fees, governance, warnings' : 'Pause, depeg, fees'}</p>
                          </div>
                          {breakdown.userTrust != null && (
                            <div className="rounded-lg bg-blue-50 p-4">
                              <p className="text-xs font-medium text-blue-600 uppercase mb-2">User Trust (20%)</p>
                              <p className="text-2xl font-bold text-blue-700">{Math.round(breakdown.userTrust)}</p>
                              <p className="text-xs text-blue-400 mt-1">Retention, holding time</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="pt-4 border-t border-gray-100">
                        <p className="text-xs text-gray-500">
                          <span className="font-medium">Score Guide:</span>{' '}
                          <span className="inline-block px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: '#10b981' }}>80-100 Excellent</span>{' '}
                          <span className="inline-block px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: '#22c55e' }}>60-79 Good</span>{' '}
                          <span className="inline-block px-1.5 py-0.5 rounded text-black" style={{ backgroundColor: '#f59e0b' }}>40-59 Moderate</span>{' '}
                          <span className="inline-block px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: '#ef4444' }}>0-39 Poor</span>
                        </p>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          )}
        </div>

        {/* Detailed Vault Scoring - Collapsible Sections */}
        {vaultRating && vaultRating.metrics && (
          <div className="mt-8 space-y-3">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Detailed Scoring & Metrics</h2>

            {/* Capital Metrics */}
            <details className="group bg-white rounded-lg border border-gray-200 overflow-hidden">
              <summary className="cursor-pointer flex items-center justify-between p-4 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50 transition-colors">
                <span>Capital Metrics</span>
                <svg className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="p-6 border-t border-gray-200 bg-gray-50">
                <p className="text-xs text-gray-400 mb-4">Data curated by Yieldo from different protocols</p>
                <table className="w-full">
                  <tbody>
                    {vaultRating.metrics.tvlUsd != null && (
                      <tr className="border-b border-gray-200 last:border-0">
                        <td className="py-3 pr-4 text-sm text-gray-600">TVL (USD)</td>
                        <td className="py-3 text-right font-mono text-sm text-gray-900">
                          {vaultRating.metrics.tvlUsd >= 1e6 
                            ? `$${(vaultRating.metrics.tvlUsd / 1e6).toFixed(2)}M`
                            : vaultRating.metrics.tvlUsd >= 1e3
                            ? `$${(vaultRating.metrics.tvlUsd / 1e3).toFixed(2)}K`
                            : `$${vaultRating.metrics.tvlUsd.toFixed(2)}`}
                        </td>
                      </tr>
                    )}
                    {vaultRating.metrics.totalSupply != null && (
                      <tr className="border-b border-gray-200 last:border-0">
                        <td className="py-3 pr-4 text-sm text-gray-600">Total supply (shares)</td>
                        <td className="py-3 text-right font-mono text-sm text-gray-900">{(Number(vaultRating.metrics.totalSupply) / 1e18).toFixed(2)}</td>
                      </tr>
                    )}
                    {selectedVault.type?.startsWith('morpho') && vaultRating.metrics.liquidityUsd != null && (
                      <>
                        <tr className="border-b border-gray-200 last:border-0">
                          <td className="py-3 pr-4 text-sm text-gray-600">Liquidity (USD)</td>
                          <td className="py-3 text-right font-mono text-sm text-gray-900">
                            {vaultRating.metrics.liquidityUsd >= 1e6 
                              ? `$${(vaultRating.metrics.liquidityUsd / 1e6).toFixed(2)}M`
                              : vaultRating.metrics.liquidityUsd >= 1e3
                              ? `$${(vaultRating.metrics.liquidityUsd / 1e3).toFixed(2)}K`
                              : `$${vaultRating.metrics.liquidityUsd.toFixed(2)}`}
                          </td>
                        </tr>
                        {vaultRating.metrics.liquidityRatio != null && (
                          <tr className="border-b border-gray-200 last:border-0">
                            <td className="py-3 pr-4 text-sm text-gray-600">Liquidity ratio</td>
                            <td className="py-3 text-right font-mono text-sm text-gray-900">{(vaultRating.metrics.liquidityRatio * 100).toFixed(2)}%</td>
                          </tr>
                        )}
                        {vaultRating.metrics.positionCount != null && (
                          <tr className="border-b border-gray-200 last:border-0">
                            <td className="py-3 pr-4 text-sm text-gray-600">Positions</td>
                            <td className="py-3 text-right font-mono text-sm text-gray-900">{vaultRating.metrics.positionCount.toLocaleString()}</td>
                          </tr>
                        )}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </details>

            {/* Performance Metrics */}
            <details className="group bg-white rounded-lg border border-gray-200 overflow-hidden">
              <summary className="cursor-pointer flex items-center justify-between p-4 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50 transition-colors">
                <span>Performance Metrics</span>
                <svg className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="p-6 border-t border-gray-200 bg-gray-50">
                <p className="text-xs text-gray-400 mb-4">Data curated by Yieldo from different protocols</p>
                <table className="w-full">
                  <tbody>
                    {selectedVault.type === 'lagoon' ? (
                      <>
                        {vaultRating.metrics.apr7d != null && (
                          <tr className="border-b border-gray-200 last:border-0">
                            <td className="py-3 pr-4 text-sm text-gray-600">Net APR (7d)</td>
                            <td className="py-3 text-right font-mono text-sm text-gray-900">{(vaultRating.metrics.apr7d * 100).toFixed(2)}%</td>
                          </tr>
                        )}
                        {vaultRating.metrics.apr30d != null && (
                          <tr className="border-b border-gray-200 last:border-0">
                            <td className="py-3 pr-4 text-sm text-gray-600">Net APR (30d)</td>
                            <td className="py-3 text-right font-mono text-sm text-gray-900">{(vaultRating.metrics.apr30d * 100).toFixed(2)}%</td>
                          </tr>
                        )}
                        {vaultRating.metrics.aprAll != null && (
                          <tr className="border-b border-gray-200 last:border-0">
                            <td className="py-3 pr-4 text-sm text-gray-600">Net APR (All-time)</td>
                            <td className="py-3 text-right font-mono text-sm text-gray-900">{(vaultRating.metrics.aprAll * 100).toFixed(2)}%</td>
                          </tr>
                        )}
                        {vaultRating.metrics.aprBase != null && (
                          <tr className="border-b border-gray-200 last:border-0">
                            <td className="py-3 pr-4 text-sm text-gray-600">Base APR (no airdrops)</td>
                            <td className="py-3 text-right font-mono text-sm text-gray-900">{(vaultRating.metrics.aprBase * 100).toFixed(2)}%</td>
                          </tr>
                        )}
                        {vaultRating.metrics.pricePerShareUsd != null && (
                          <tr className="border-b border-gray-200 last:border-0">
                            <td className="py-3 pr-4 text-sm text-gray-600">Share price (USD)</td>
                            <td className="py-3 text-right font-mono text-sm text-gray-900">${vaultRating.metrics.pricePerShareUsd.toFixed(6)}</td>
                          </tr>
                        )}
                      </>
                    ) : selectedVault.type?.startsWith('morpho') ? (
                      <>
                        {vaultRating.metrics.apy != null && (
                          <tr className="border-b border-gray-200 last:border-0">
                            <td className="py-3 pr-4 text-sm text-gray-600">APY (current)</td>
                            <td className="py-3 text-right font-mono text-sm text-gray-900">{(vaultRating.metrics.apy * 100).toFixed(2)}%</td>
                          </tr>
                        )}
                        {vaultRating.metrics.netApy != null && (
                          <tr className="border-b border-gray-200 last:border-0">
                            <td className="py-3 pr-4 text-sm text-gray-600">Net APY (current)</td>
                            <td className="py-3 text-right font-mono text-sm text-gray-900">{(vaultRating.metrics.netApy * 100).toFixed(2)}%</td>
                          </tr>
                        )}
                        {vaultRating.metrics.dailyApy != null && (
                          <tr className="border-b border-gray-200 last:border-0">
                            <td className="py-3 pr-4 text-sm text-gray-600">Daily avg APY</td>
                            <td className="py-3 text-right font-mono text-sm text-gray-900">{(vaultRating.metrics.dailyApy * 100).toFixed(2)}%</td>
                          </tr>
                        )}
                        {vaultRating.metrics.weeklyApy != null && (
                          <tr className="border-b border-gray-200 last:border-0">
                            <td className="py-3 pr-4 text-sm text-gray-600">Weekly avg APY</td>
                            <td className="py-3 text-right font-mono text-sm text-gray-900">{(vaultRating.metrics.weeklyApy * 100).toFixed(2)}%</td>
                          </tr>
                        )}
                        {vaultRating.metrics.monthlyApy != null && (
                          <tr className="border-b border-gray-200 last:border-0">
                            <td className="py-3 pr-4 text-sm text-gray-600">Monthly avg APY</td>
                            <td className="py-3 text-right font-mono text-sm text-gray-900">{(vaultRating.metrics.monthlyApy * 100).toFixed(2)}%</td>
                          </tr>
                        )}
                        {vaultRating.metrics.sharePrice != null && (
                          <tr className="border-b border-gray-200 last:border-0">
                            <td className="py-3 pr-4 text-sm text-gray-600">Share price</td>
                            <td className="py-3 text-right font-mono text-sm text-gray-900">{Number(vaultRating.metrics.sharePrice).toFixed(6)}</td>
                          </tr>
                        )}
                      </>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </details>

            {/* Risk Flags */}
            <details className="group bg-white rounded-lg border border-gray-200 overflow-hidden">
              <summary className="cursor-pointer flex items-center justify-between p-4 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50 transition-colors">
                <span>Risk Flags</span>
                <svg className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="p-6 border-t border-gray-200 bg-gray-50">
                <table className="w-full">
                  <tbody>
                    {selectedVault.type === 'lagoon' ? (
                      <>
                        {vaultRating.metrics.vaultState != null && (
                          <tr className="border-b border-gray-200 last:border-0">
                            <td className="py-3 pr-4 text-sm text-gray-600">Vault state</td>
                            <td className="py-3 text-right font-mono text-sm text-gray-900">{vaultRating.metrics.vaultState}</td>
                          </tr>
                        )}
                        <tr className="border-b border-gray-200 last:border-0">
                          <td className="py-3 pr-4 text-sm text-gray-600">Vault paused</td>
                          <td className="py-3 text-right font-mono text-sm text-gray-900">{vaultRating.metrics.vaultPaused ? 'Yes' : 'No'}</td>
                        </tr>
                        {vaultRating.metrics.assetDepeg != null && (
                          <tr className="border-b border-gray-200 last:border-0">
                            <td className="py-3 pr-4 text-sm text-gray-600">Asset depeg</td>
                            <td className="py-3 text-right font-mono text-sm text-gray-900">{vaultRating.metrics.assetDepeg ? 'Yes' : 'No'}</td>
                          </tr>
                        )}
                        <tr className="border-b border-gray-200 last:border-0">
                          <td className="py-3 pr-4 text-sm text-gray-600">Whitelist activated</td>
                          <td className="py-3 text-right font-mono text-sm text-gray-900">{vaultRating.metrics.isWhitelistActivated ? 'Yes' : 'No'}</td>
                        </tr>
                      </>
                    ) : selectedVault.type?.startsWith('morpho') ? (
                      <>
                        {vaultRating.metrics.assetDepeg != null && (
                          <tr className="border-b border-gray-200 last:border-0">
                            <td className="py-3 pr-4 text-sm text-gray-600">Asset depeg</td>
                            <td className="py-3 text-right font-mono text-sm text-gray-900">{vaultRating.metrics.assetDepeg ? 'Yes' : 'No'}</td>
                          </tr>
                        )}
                        <tr className="border-b border-gray-200 last:border-0">
                          <td className="py-3 pr-4 text-sm text-gray-600">Listed on Morpho</td>
                          <td className="py-3 text-right font-mono text-sm text-gray-900">{vaultRating.metrics.listed ? 'Yes' : 'No'}</td>
                        </tr>
                        {vaultRating.metrics.warningCount != null && (
                          <tr className="border-b border-gray-200 last:border-0">
                            <td className="py-3 pr-4 text-sm text-gray-600">Warnings</td>
                            <td className="py-3 text-right font-mono text-sm text-gray-900">{vaultRating.metrics.warningCount}</td>
                          </tr>
                        )}
                      </>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </details>

            {/* User Analytics (if available) */}
            {vaultRating.metrics.userAnalytics && (
              <details className="group bg-white rounded-lg border border-gray-200 overflow-hidden">
                <summary className="cursor-pointer flex items-center justify-between p-4 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50 transition-colors">
                  <span>User Behavior Analytics</span>
                  <svg className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                  <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-200">
                    <span className="text-xs text-gray-500">Trust Score</span>
                    <span
                      className="px-3 py-1.5 rounded text-sm font-bold text-white"
                      style={{
                        backgroundColor: vaultRating.metrics.userAnalytics.trustScore >= 70 ? '#10b981' : vaultRating.metrics.userAnalytics.trustScore >= 50 ? '#f59e0b' : '#ef4444'
                      }}
                    >
                      {vaultRating.metrics.userAnalytics.trustScore}
                    </span>
                  </div>
                  <table className="w-full">
                    <tbody>
                      <tr className="border-b border-gray-200 last:border-0">
                        <td className="py-3 pr-4 text-sm text-gray-600">Total Users</td>
                        <td className="py-3 text-right font-mono text-sm text-gray-900">{vaultRating.metrics.userAnalytics.totalUsers}</td>
                      </tr>
                      <tr className="border-b border-gray-200 last:border-0">
                        <td className="py-3 pr-4 text-sm text-gray-600">Active Holders</td>
                        <td className="py-3 text-right font-mono text-sm text-green-600">{vaultRating.metrics.userAnalytics.activeHolders}</td>
                      </tr>
                      <tr className="border-b border-gray-200 last:border-0">
                        <td className="py-3 pr-4 text-sm text-gray-600">Retention Rate</td>
                        <td className="py-3 text-right font-mono text-sm text-gray-900">{vaultRating.metrics.userAnalytics.retentionRate}%</td>
                      </tr>
                      <tr className="border-b border-gray-200 last:border-0">
                        <td className="py-3 pr-4 text-sm text-gray-600">Avg Holding</td>
                        <td className="py-3 text-right font-mono text-sm text-gray-900">{vaultRating.metrics.userAnalytics.avgHoldingDays}d</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function VaultsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-gray-900 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading Yieldo...</p>
        </div>
      </div>
    }>
      <VaultsPageContent />
    </Suspense>
  )
}

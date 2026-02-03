'use client'

import { useAccount, useChainId, useSwitchChain, useBalance, usePublicClient, useReadContract } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useState, useEffect, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { parseUnits, formatUnits, Address, createPublicClient, http, encodeFunctionData } from 'viem'
import { avalanche, mainnet, base, optimism, arbitrum, bsc } from 'viem/chains'
import { VAULTS_CONFIG, getVaultById, type VaultConfig } from '@/lib/vaults-config'
import { SUPPORTED_CHAINS, getTokensForChain, getDepositQuote, checkTransferStatus, getBridgeFromQuote, getQuoteWithContractCall, type TokenInfo, type DepositQuote } from '@/lib/lifi'
import { getQuote } from '@lifi/sdk'
import { getVaultState } from '@/lib/lagoon'
import { useVaults } from '@/hooks/useVaults'
import { fetchMorphoVaultData } from '@/lib/morpho'
import { signDepositIntent, getIntentHash, type DepositIntent } from '@/lib/eip712'
import { useWalletClient } from 'wagmi'
import DEPOSIT_ROUTER_ABI from '@/lib/deposit-router-abi.json'
import ERC20_ABI from '@/lib/erc20-abi.json'
import { CustomSelect } from '@/components/CustomSelect'
import { TransactionLoader } from '@/components/TransactionLoader'
import { TransactionStatus } from '@/components/TransactionStatus'
import { PendingTransactions } from '@/components/PendingTransactions'
import { TransactionHistory } from '@/components/TransactionHistory'

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
  // Default to 1:1 ratio: if 1 USDC (1e6) = 1 share (1e18), then vaultSharesPerAsset = (1e18 * 1e18) / 1e6 = 1e30
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
    if (chainId) setFromChainId(chainId)
  }, [chainId])

  useEffect(() => {
    if (selectedVault) {
      fetchVaultState()
    }
  }, [selectedVault])

  useEffect(() => {
    fetchTokens()
  }, [fromChainId])

  useEffect(() => {
    // Don't fetch quote if we're executing a transaction - prevents UI refresh
    if (executing) return
    const timeoutId = setTimeout(fetchQuote, 500)
    return () => clearTimeout(timeoutId)
  }, [amount, fromToken, selectedVault, fromChainId, address, chainId, vaultSharesPerAsset, slippage, executing])

  const fetchVaultState = async () => {
    if (!selectedVault) return
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
            // For ERC4626: shares = (depositAmount * totalSupply) / totalAssets
            // vaultSharesPerAsset = (totalSupply * 10^18) / totalAssets
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
          console.error('Failed to fetch Morpho vault data, using default 1:1 ratio')
          setVaultState({
            totalAssets: '0',
            totalSupply: '0',
            apr: '0',
          })
          setVaultSharesPerAsset(BigInt(10 ** 30))
        }
      }
    } catch (error) {
      console.error('Error fetching vault state:', error)
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
    setLoadingQuote(true)
    try {
      const fromAmount = parseUnits(amount, fromToken.decimals).toString()
      const depositRouterAddress = selectedVault.depositRouter as Address
      if (!depositRouterAddress) {
        setQuote(null)
        setLoadingQuote(false)
        return
      }
      // Always try to use LI.FI Composer with contract call for ALL routes (same-chain and cross-chain)
      // This allows swap + deposit in one transaction from any chain
      // For swaps, always swap to the underlying asset (USDC), not vault shares
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
      
      // For any route that needs a swap (same-chain or cross-chain), try contract call first
      // This works for all vault types including Morpho (LI.FI Composer supports Morpho)
      if (needsSwap) {
        try {
          console.log('Attempting to get contract call quote for swap + deposit...')
          // First, create the deposit intent and encode the contract call
          const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
          // Get estimated amount from a regular quote first
          const tempQuote = await getQuote({
            fromChain: fromChainId,
            fromToken: fromToken.address,
            fromAmount,
            toChain: selectedVault.chainId,
            toToken: toTokenForSwap, // Swap to underlying asset (USDC)
            fromAddress: address,
            slippage: slippage / 100,
            order: 'RECOMMENDED',
          })
          
          if (tempQuote) {
            const toAmountStr = tempQuote.estimate?.toAmount || tempQuote.action?.toAmount || tempQuote.toAmount || '0'
            const toAmount = BigInt(toAmountStr)
            const feeAmount = (toAmount * BigInt(10)) / BigInt(10000) // 0.1% fee
            const depositAmount = toAmount - feeAmount
            
            // Create intent (we'll sign it later, but need it for encoding)
            // For Morpho vaults, the asset is still the underlying asset (USDC), not vault shares
            const intent: DepositIntent = {
              user: address!,
              vault: selectedVault.address as Address,
              asset: toTokenForSwap, // Always use underlying asset (USDC) for deposit
              amount: depositAmount,
              nonce: userNonce,
              deadline,
            }
            
            // Encode the contract call data (we'll sign the intent when executing)
            // Use ERC4626 functions for Morpho vaults, Lagoon functions for others
            const isERC4626 = selectedVault.type?.startsWith('morpho')
            const functionName = selectedVault.hasSettlement
              ? 'depositWithIntentCrossChainRequest'
              : (isERC4626 ? 'depositWithIntentCrossChainERC4626' : 'depositWithIntentCrossChain')
            const callData = encodeFunctionData({
              abi: DEPOSIT_ROUTER_ABI,
              functionName,
              args: [[intent.user, intent.vault, intent.asset, intent.amount, intent.nonce, intent.deadline], '0x' as `0x${string}`], // Placeholder signature
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
            
            // Get quote with contract call
            // For Morpho vaults, LI.FI Composer should support this
            const contractCallQuote = await getQuoteWithContractCall(
              fromChainId,
              fromToken.address,
              fromAmount,
              selectedVault.chainId,
              toTokenForSwap, // Swap to underlying asset (USDC)
              address,
              depositRouterAddress,
              callData,
              undefined, // Let LI.FI choose the best route (it supports Morpho)
              slippage / 100
            )
            
            if (contractCallQuote && contractCallQuote.transactionRequest) {
              console.log('✅ Successfully got contract call quote!', {
                hasTransactionRequest: !!contractCallQuote.transactionRequest,
                steps: contractCallQuote.steps?.length,
              })
              
              // Calculate shares
              const calculateShares = (depositAmount: bigint): bigint => {
                return (depositAmount * vaultSharesPerAsset) / BigInt(10 ** 18)
              }
              const estimatedShares = calculateShares(depositAmount)
              const minReceivedAmount = BigInt(tempQuote.estimate?.toAmountMin || toAmountStr) - ((BigInt(tempQuote.estimate?.toAmountMin || toAmountStr) * BigInt(10)) / BigInt(10000))
              const minReceived = calculateShares(minReceivedAmount)
              
              // Extract detailed fee and cost information
              const totalGasCosts = contractCallQuote.estimate?.gasCosts?.reduce((acc: number, cost: any) => acc + parseFloat(cost.amountUSD || '0'), 0) || 0
              const totalFeeCosts = contractCallQuote.estimate?.feeCosts?.reduce((acc: number, cost: any) => acc + parseFloat(cost.amountUSD || '0'), 0) || 0
              
              // Extract step details for display
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
              
              quoteResult = {
                quote: contractCallQuote,
                estimatedShares,
                estimatedAssets: depositAmount,
                feeAmount,
                minReceived,
                toDecimals: selectedVault.asset.decimals,
                estimatedTime: contractCallQuote.estimate?.executionDuration,
                gasCosts: totalGasCosts,
                feeCosts: totalFeeCosts,
                steps: contractCallQuote.includedSteps?.length || contractCallQuote.steps?.length || 0,
                stepDetails, // Add detailed step information
                hasContractCall: true, // Mark that this quote includes contract call
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
      
      // Fallback to regular quote if contract call quote failed or not applicable (direct deposits don't need contract calls)
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

  // Execute deposit on destination chain after bridge completes
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
      
      // Get the current balance of vault asset
      const balance = await publicClient?.readContract({
        address: vault.asset.address as Address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address],
      }) as bigint

      if (balance < depositAmount) {
        // Use actual balance if less than expected (slippage)
        depositAmount = balance
      }

      if (depositAmount === BigInt(0)) {
        throw new Error('No tokens received from bridge')
      }

      setExecutionStatus('Approving deposit router...')
      
      // Check and approve deposit router
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

      // Check if we have a stored intent and signature from the fallback flow
      const pendingDepositKey = `pending_deposit_${txId}`
      const storedPending = localStorage.getItem(pendingDepositKey)
      
      let intent: DepositIntent
      let signature: string
      
      if (storedPending) {
        try {
          const pending = JSON.parse(storedPending)
          if (pending.intent && pending.signature) {
            // Use stored intent and signature (already signed during bridge flow)
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
            
            // Verify the intent amount matches (might have changed due to slippage)
            if (intent.amount !== depositAmount) {
              console.warn('Intent amount mismatch, updating intent amount')
              intent.amount = depositAmount
              // Need to re-sign with updated amount
              setExecutionStatus('Updating deposit intent...')
              signature = await signDepositIntent(intent, vault.chainId, depositRouterAddress, walletClient!)
            }
          } else {
            throw new Error('Stored pending deposit missing intent or signature')
          }
        } catch (err) {
          console.warn('Failed to use stored intent, creating new one:', err)
          // Fall through to create new intent
          setExecutionStatus('Please sign the deposit intent...')
          const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
          intent = {
            user: address!,
            vault: vault.address as Address,
            asset: vault.asset.address as Address,
            amount: depositAmount,
            nonce: userNonce,
            deadline,
          }
          signature = await signDepositIntent(intent, vault.chainId, depositRouterAddress, walletClient!)
        }
      } else {
        // No stored intent - create and sign new one
        setExecutionStatus('Please sign the deposit intent...')
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
        intent = {
          user: address!,
          vault: vault.address as Address,
          asset: vault.asset.address as Address,
          amount: depositAmount,
          nonce: userNonce,
          deadline,
        }
        signature = await signDepositIntent(intent, vault.chainId, depositRouterAddress, walletClient!)
      }

      setExecutionStatus('Please confirm the deposit transaction...')

      // Execute deposit - use ERC4626 functions for Morpho vaults
      const isERC4626 = vault.type?.startsWith('morpho')
      const functionName = vault.hasSettlement
        ? 'depositWithIntentRequest'
        : (isERC4626 ? 'depositWithIntentERC4626' : 'depositWithIntent')
      const depositHash = await walletClient!.writeContract({
        address: depositRouterAddress,
        abi: DEPOSIT_ROUTER_ABI,
        functionName,
        args: [[intent.user, intent.vault, intent.asset, intent.amount, intent.nonce, intent.deadline], signature as `0x${string}`],
      })

      setTxHashes(prev => ({ ...prev, deposit: depositHash }))
      setExecutionStatus('Deposit submitted! Waiting for confirmation...')

      await publicClient?.waitForTransactionReceipt({ hash: depositHash })

      // Update transaction state as fully completed
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
      
      // Increment nonce (contract already incremented it, sync our state)
      // Use the intent's nonce + 1 since contract increments on execution
      setUserNonce(intent.nonce + BigInt(1))
      refetchBalance()
      
      // Clear pending deposit from localStorage
      localStorage.removeItem(`pending_deposit_${txId}`)

      setTimeout(() => {
        setAmount('')
        setQuote(null)
        setTransactionId(null)
        setTxHashes({})
        setExecutionStatus(null)
        setExecutionStep('idle')
      }, 10000)

      setExecuting(false)
    } catch (error: any) {
      console.error('Vault deposit error:', error)
      throw error
    }
  }

  // Check for pending deposits when chain changes
  useEffect(() => {
    const checkPendingDeposits = async () => {
      if (!address || !chainId || !walletClient) return
      
      // Look for any pending deposits for this user
      const keys = Object.keys(localStorage).filter(k => k.startsWith('pending_deposit_'))
      
      for (const key of keys) {
        try {
          const pending = JSON.parse(localStorage.getItem(key) || '{}')
          
          // Check if this pending deposit is for the current chain
          if (pending.chainId === chainId && pending.userAddress?.toLowerCase() === address.toLowerCase()) {
            const vault = getVaultById(pending.vaultId)
            if (!vault) continue
            
            // Ask user if they want to complete the deposit
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
                  '' // No bridge hash available from localStorage
                )
              } catch (error: any) {
                setExecutionStatus(`Deposit failed: ${error.message}`)
                setExecuting(false)
              }
            } else {
              // User declined, remove the pending deposit
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

    // Capture all values at the start to prevent stale closures
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
    const depositAmount = capturedQuote.estimatedAssets + capturedQuote.feeAmount
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

      // STEP 1: Sign the deposit intent (EIP-712 signature for destination chain)
      // MetaMask requires the wallet to be on the destination chain for EIP-712 signing
      setExecutionStatus('Step 1/3: Signing deposit intent...')
      
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200) // 2 hours
      const intent: DepositIntent = {
        user: address!,
        vault: capturedVault.address as Address,
        asset: capturedVault.asset.address as Address,
        amount: depositAmount, // Amount after fees
        nonce: userNonce,
        deadline,
      }

      // Check if we need to switch chains for signing
      // MetaMask requires wallet to be on the destination chain for EIP-712 signing
      let needsChainSwitchForSigning = chainId !== capturedVault.chainId
      let originalChainId = capturedFromChainId // Use the captured source chain ID
      
      if (needsChainSwitchForSigning) {
        const destChainName = capturedVault.chain === 'avalanche' ? 'Avalanche' : 
                              capturedVault.chain === 'ethereum' ? 'Ethereum' :
                              capturedVault.chain.charAt(0).toUpperCase() + capturedVault.chain.slice(1)
        setExecutionStatus(`Step 1/3: Switching to ${destChainName} to sign deposit intent...`)
        try {
          await switchChain?.({ chainId: capturedVault.chainId })
          // Wait for chain switch to complete (MetaMask needs time to switch)
          await new Promise(resolve => setTimeout(resolve, 3000))
        } catch (switchError: any) {
          throw new Error(`Please switch to ${destChainName} to sign the deposit intent. ${switchError.message}`)
        }
      }

      // Sign the intent for the DESTINATION chain
      setExecutionStatus('Step 1/3: Please sign the deposit intent in your wallet...')
      let signature: string
      try {
        signature = await signDepositIntent(intent, capturedVault.chainId, depositRouterAddress, walletClient!)
        console.log('Deposit intent signed:', { intent, signature })
      } catch (signError: any) {
        // If signing failed and we switched chains, switch back
        if (needsChainSwitchForSigning && originalChainId) {
          try {
            await switchChain?.({ chainId: originalChainId })
          } catch {}
        }
        throw new Error(`Failed to sign deposit intent: ${signError.message}`)
      }

      // Switch back to source chain if we switched for signing
      if (needsChainSwitchForSigning && originalChainId) {
        const sourceChainName = SUPPORTED_CHAINS.find(c => c.id === originalChainId)?.name || 'source chain'
        setExecutionStatus(`Step 1/3: Switching back to ${sourceChainName}...`)
        try {
          await switchChain?.({ chainId: originalChainId })
          // Wait for chain switch
          await new Promise(resolve => setTimeout(resolve, 3000))
        } catch (switchError: any) {
          console.warn('Failed to switch back to source chain:', switchError)
          // Continue anyway - user can manually switch
        }
      }
      
      // Encode the calldata for depositWithIntentCrossChain - use ERC4626 for Morpho vaults
      const isERC4626 = capturedVault.type?.startsWith('morpho')
      const functionName = capturedVault.hasSettlement
        ? 'depositWithIntentCrossChainRequest'
        : (isERC4626 ? 'depositWithIntentCrossChainERC4626' : 'depositWithIntentCrossChain')
      const callData = encodeFunctionData({
        abi: DEPOSIT_ROUTER_ABI,
        functionName,
        args: [[intent.user, intent.vault, intent.asset, intent.amount, intent.nonce, intent.deadline], signature as `0x${string}`],
      })
      
      console.log('Encoded callData:', callData)

      // STEP 2: Get LI.FI quote with contract call
      // We MUST use a bridge that supports contract calls - no fallback to regular bridge
      setExecutionStatus('Step 2/3: Finding bridge that supports automatic deposit...')
      
      // First, get the bridge name from the regular quote to try it first
      const bridgeFromRegularQuote = getBridgeFromQuote(capturedQuote.quote)
      const preferredBridges = bridgeFromRegularQuote ? [bridgeFromRegularQuote] : undefined
      
      // Try to get contract call quote with preferred bridge first, then fallback to supported bridges
      // Always use the underlying asset (e.g., USDC) as toToken - LI.FI delivers this to DepositRouter
      // which then deposits into the vault (Lagoon or Morpho)
      const toTokenForContractCall = capturedVault.asset.address as Address
      
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
        0.03
      )

      // If preferred bridge doesn't support contract calls, try other supported bridges
      if (!quoteWithCall || !quoteWithCall.transactionRequest) {
        console.warn(`Bridge ${bridgeFromRegularQuote} does not support contract calls, trying other bridges...`)
        setExecutionStatus('Step 2/3: Trying alternative bridges that support automatic deposit...')
        
        // Try without preferred bridges - let LI.FI choose from supported bridges
        quoteWithCall = await getQuoteWithContractCall(
          capturedFromChainId,
          capturedFromToken.address,
          parsedFromAmount.toString(),
          capturedVault.chainId,
          toTokenForContractCall,
          address,
          depositRouterAddress,
          callData,
          undefined, // No preferred bridges - use all supported ones
          0.03
        )
      }

      // If contract call quote still fails, fall back to regular bridge flow
      // User will need to complete deposit manually on destination chain
      if (!quoteWithCall || !quoteWithCall.transactionRequest) {
        console.warn('⚠️ Contract call quote not available - falling back to regular bridge flow')
        console.warn('User will complete deposit manually on destination chain after bridge')
        
        setExecutionStatus('⚠️ Automatic deposit not available for this route. Bridge will complete, then you can finish deposit on destination chain.')
        
        // Use regular quote for bridge only
        const transactionRequest = capturedQuote.quote!.transactionRequest
        if (!transactionRequest) {
          throw new Error('No transaction request available')
        }
        
        // Continue with regular bridge flow (user completes deposit manually)
        const isNative = capturedFromToken.isNative || isNativeToken(capturedFromToken.address)
        
        // Approve on SOURCE chain if needed
        if (!isNative) {
          const sourceChainConfig = chainConfigs[capturedFromChainId]
          const sourcePublicClient = createPublicClient({
            chain: sourceChainConfig,
            transport: http(),
          })
          
          const allowance = await sourcePublicClient.readContract({
            address: capturedFromToken.address,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [address!, transactionRequest.to as Address],
          }) as bigint

          if (allowance < parsedFromAmount) {
            setExecutionStatus('Step 2/3: Approving token spend on source chain...')
            setExecutionStep('approving')
            await updateTransactionState('pending', 'approving')
            
            // Make sure we're on source chain
            if (chainId !== capturedFromChainId) {
              await switchChain?.({ chainId: capturedFromChainId })
              await new Promise(resolve => setTimeout(resolve, 3000))
            }
            
            const approveHash = await walletClient.writeContract({
              address: capturedFromToken.address,
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [transactionRequest.to as Address, parsedFromAmount],
              chainId: capturedFromChainId,
            })
            
            setTxHashes(prev => ({ ...prev, approve: approveHash }))
            setExecutionStatus('Waiting for approval...')
            await sourcePublicClient.waitForTransactionReceipt({ hash: approveHash })
          }
        }

        // Execute bridge transaction on SOURCE chain
        setExecutionStatus('Step 2/3: Please confirm the bridge transaction...')
        setExecutionStep('bridging')
        await updateTransactionState('pending', 'bridging')
        
        bridgeHash = await walletClient.sendTransaction({
          to: transactionRequest.to as Address,
          data: transactionRequest.data as `0x${string}`,
          value: BigInt(transactionRequest.value || '0'),
          chainId: capturedFromChainId,
        })

        setTxHashes(prev => ({ ...prev, bridge: bridgeHash! }))
        setExecutionStatus('Bridge transaction sent! Waiting for confirmation...')
        await updateTransactionState('pending', 'bridging', undefined, { txHash: bridgeHash, status: 'PENDING' }, bridgeHash)
        
        // Wait for source chain confirmation
        const sourceChainConfig = chainConfigs[capturedFromChainId]
        const sourcePublicClient = createPublicClient({
          chain: sourceChainConfig,
          transport: http(),
        })
        await sourcePublicClient.waitForTransactionReceipt({ hash: bridgeHash })
        
        // Store pending deposit info for manual completion
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
        
        // Start polling for bridge completion
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
              
              if (isDone) {
                clearInterval(pollInterval)
                await updateTransactionState('pending', 'bridge_completed', 'Bridge completed - please complete deposit on destination chain', status, bridgeHash!)
                
                setExecutionStep('depositing')
                setExecutionStatus(`✅ Bridge completed! Switch to ${capturedVault.chain === 'avalanche' ? 'Avalanche' : capturedVault.chain} to complete deposit.`)
                setExecuting(false)
              } else if (isFailed) {
                clearInterval(pollInterval)
                const errMsg = status.error?.message || 'Bridge transaction failed'
                setExecutionStep('idle')
                setExecutionStatus(`Error: ${errMsg}`)
                await updateTransactionState('failed', 'failed', errMsg, status, bridgeHash!)
                setExecuting(false)
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

        // Initial check
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

        // Timeout after 15 minutes
        setTimeout(() => {
          clearInterval(pollInterval)
          if (executionStep !== 'bridge_completed' && executionStep !== 'idle') {
            setExecutionStatus('Bridge is taking longer than expected. Check LI.FI explorer for status.')
            setExecuting(false)
          }
        }, 900000)

        // Don't increment nonce yet - will increment when deposit completes
        return
      }

      // We have a quote with contract call - this will deposit automatically!
      console.log('Got quote with contract call:', quoteWithCall)
      console.log('Source chain:', capturedFromChainId, 'Source token:', capturedFromToken.symbol, capturedFromToken.address)
      console.log('Is native?', capturedFromToken.isNative, isNativeToken(capturedFromToken.address))
      
      // Make sure we're on the SOURCE chain before any operations
      if (chainId !== capturedFromChainId) {
        const sourceChainName = SUPPORTED_CHAINS.find(c => c.id === capturedFromChainId)?.name || 'source chain'
        setExecutionStatus(`Step 2/3: Switching to ${sourceChainName}...`)
        await switchChain?.({ chainId: capturedFromChainId })
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
      
      // Create a publicClient for the SOURCE chain (where we're sending from)
      // Don't use wagmi's publicClient as it follows the connected chain
      const sourceChainConfig = chainConfigs[capturedFromChainId]
      if (!sourceChainConfig) {
        throw new Error(`Unsupported source chain: ${capturedFromChainId}`)
      }
      
      const sourcePublicClient = createPublicClient({
        chain: sourceChainConfig,
        transport: http(),
      })
      
      const isNative = capturedFromToken.isNative || isNativeToken(capturedFromToken.address)
      
      // STEP 3: Approve if needed (on SOURCE chain, with SOURCE token - ETH on Base)
      // ETH is native, so no approval needed!
      if (!isNative) {
        console.log('Token is not native, checking allowance on source chain:', capturedFromChainId)
        // Check allowance on SOURCE chain for SOURCE token
        const allowance = await sourcePublicClient.readContract({
          address: capturedFromToken.address, // This should be the token on Base
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address!, quoteWithCall.transactionRequest.to as Address],
        }) as bigint

        if (allowance < parsedFromAmount) {
          setExecutionStatus(`Step 2/3: Approving ${capturedFromToken.symbol} on ${fromChain?.name || 'source chain'}...`)
          setExecutionStep('approving')
          await updateTransactionState('pending', 'approving')
          
          const approveHash = await walletClient.writeContract({
            address: capturedFromToken.address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [quoteWithCall.transactionRequest.to as Address, parsedFromAmount],
            chainId: capturedFromChainId, // Explicitly set chain to source
          })
          
          setTxHashes(prev => ({ ...prev, approve: approveHash }))
          setExecutionStatus('Waiting for approval...')
          await sourcePublicClient.waitForTransactionReceipt({ hash: approveHash })
        }
      } else {
        console.log('Token is native (ETH), skipping approval')
      }

      // STEP 3: Execute the bridge + deposit transaction
      setExecutionStatus('Step 3/3: Please confirm the cross-chain deposit...')
      setExecutionStep('bridging')
      await updateTransactionState('pending', 'bridging')
      
      bridgeHash = await walletClient.sendTransaction({
        to: quoteWithCall.transactionRequest.to as Address,
        data: quoteWithCall.transactionRequest.data as `0x${string}`,
        value: BigInt(quoteWithCall.transactionRequest.value || '0'),
        chainId: capturedFromChainId,
      })

      setTxHashes(prev => ({ ...prev, bridge: bridgeHash! }))
      setExecutionStatus('Transaction sent! Waiting for confirmation...')
      await updateTransactionState('pending', 'bridging', undefined, { txHash: bridgeHash, status: 'PENDING' }, bridgeHash)
      
      // Wait for source chain confirmation
      await publicClient?.waitForTransactionReceipt({ hash: bridgeHash })
      
      setExecutionStep('depositing')
      setExecutionStatus('Confirmed! Bridging and depositing into vault...')
      await updateTransactionState('pending', 'depositing', undefined, { txHash: bridgeHash, status: 'CONFIRMED' }, bridgeHash)

      // Increment nonce since we signed an intent
      setUserNonce(userNonce + BigInt(1))

      // Poll for completion
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
            
            if (isDone) {
              clearInterval(pollInterval)
              
              // Since we only use bridges that support contract calls, deposit should have happened automatically
              // If LI.FI reports DONE, the entire flow (bridge + contract call) is complete
              setExecutionStep('complete')
              setExecutionStatus('🎉 Cross-chain deposit completed! Shares issued to your wallet.')
              await updateTransactionState('completed', 'completed', undefined, status, bridgeHash!)
              
              setAmount('')
              setQuote(null)
              refetchBalance()
              setExecuting(false)
              
              setTimeout(() => {
                setTransactionId(null)
                setTxHashes({})
                setExecutionStatus(null)
                setExecutionStep('idle')
              }, 15000)
            } else if (isFailed) {
              clearInterval(pollInterval)
              const errMsg = status.error?.message || status.receiving?.error?.message || 'Transaction failed'
              setExecutionStep('idle')
              setExecutionStatus(`Error: ${errMsg}`)
              await updateTransactionState('failed', 'failed', errMsg, status, bridgeHash!)
              setExecuting(false)
              
              setTimeout(() => {
                setTransactionId(null)
                setTxHashes({})
                setExecutionStatus(null)
              }, 30000)
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

      // Initial check
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

      // Timeout after 15 minutes
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
      setExecutionStatus(`Error: ${errorMessage}`)
      setExecuting(false)
      
      // Update transaction state with error
      await updateTransactionState('failed', 'error', errorMessage, undefined, bridgeHash || undefined)
      
      // Keep error visible for 30 seconds
      setTimeout(() => {
        setExecutionStatus(null)
        setTxHashes({})
        setTransactionId(null)
      }, 30000)
    }
    // Note: Don't use finally { setExecuting(false) } - it would cancel the polling
  }

  const handleSameChainSwapDeposit = async () => {
    if (!quote || !walletClient || !address || !selectedVault || !fromToken || !quote.quote) return

    setExecuting(true)
    setExecutionStatus('Preparing swap transaction...')

    const txId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    setTransactionId(txId)

    const apiUrl = process.env.NEXT_PUBLIC_INDEXER_API_URL || 'http://localhost:3001'
    const sourceChainKey = SUPPORTED_CHAINS.find(c => c.id === fromChainId)?.name?.toLowerCase() || 'unknown'

    const updateTransactionState = async (status: string, currentStep: string, errorMessage?: string) => {
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
            swap_tx_hash: txHashes.swap || null,
            deposit_tx_hash: txHashes.deposit || null,
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

      // Check balance before proceeding
      if (isNative) {
        const balance = await publicClient?.getBalance({ address: address! })
        if (!balance) throw new Error('Failed to fetch balance')
        
        // Estimate gas cost (rough estimate: 200k gas * gas price)
        const gasPrice = await publicClient?.getGasPrice()
        const estimatedGasCost = gasPrice ? gasPrice * BigInt(200000) : BigInt(0)
        
        if (balance < txValue + estimatedGasCost) {
          throw new Error(`Insufficient balance. You need ${formatUnits(txValue + estimatedGasCost, 18)} ETH (including gas), but you have ${formatUnits(balance, 18)} ETH`)
        }
      } else {
        // For ERC20, check token balance
        const balance = await publicClient?.readContract({
          address: fromToken.address,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address!],
        }) as bigint

        if (balance < fromAmount) {
          throw new Error(`Insufficient ${fromToken.symbol} balance. You have ${formatUnits(balance, fromToken.decimals)} but need ${formatUnits(fromAmount, fromToken.decimals)}`)
        }

        // Also check native token balance for gas
        const nativeBalance = await publicClient?.getBalance({ address: address! })
        const gasPrice = await publicClient?.getGasPrice()
        const estimatedGasCost = gasPrice ? gasPrice * BigInt(200000) : BigInt(0)
        
        if (nativeBalance && nativeBalance < estimatedGasCost) {
          throw new Error(`Insufficient native token balance for gas. You need at least ${formatUnits(estimatedGasCost, 18)} ETH for gas fees`)
        }
      }

      if (!isNative) {
        const allowance = await publicClient?.readContract({
          address: fromToken.address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, transactionRequest.to as Address],
        }) as bigint

        if (allowance < fromAmount) {
          setExecutionStatus('Approving token spend...')
          setExecutionStep('approving')
          const approveHash = await walletClient.writeContract({
            address: fromToken.address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [transactionRequest.to as Address, fromAmount],
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

      // Check if this quote includes a contract call (swap + deposit in one transaction)
      if (quote.hasContractCall) {
        // Contract call quote: swap + deposit in one transaction
        console.log('Using contract call quote: swap + deposit in one transaction')
        
        // STEP 1: Sign deposit intent
        setExecutionStatus('Step 1/2: Please sign the deposit intent...')
        setExecutionStep('idle')
        const signature = await signDepositIntent(intent, chainId, depositRouterAddress, walletClient)
        console.log('Deposit intent signed:', { intent, signature })
        
        // STEP 2: Get fresh quote with real signature
        setExecutionStatus('Preparing swap + deposit transaction...')
        // Use ERC4626 functions for Morpho vaults
        const isERC4626 = selectedVault.type?.startsWith('morpho')
        const functionName = selectedVault.hasSettlement
          ? 'depositWithIntentCrossChainRequest'
          : (isERC4626 ? 'depositWithIntentCrossChainERC4626' : 'depositWithIntentCrossChain')
        const callData = encodeFunctionData({
          abi: DEPOSIT_ROUTER_ABI,
          functionName,
          args: [[intent.user, intent.vault, intent.asset, intent.amount, intent.nonce, intent.deadline], signature as `0x${string}`],
        })
        
        const freshQuote = await getQuoteWithContractCall(
          fromChainId,
          fromToken.address,
          parseUnits(amount, fromToken.decimals).toString(),
          selectedVault.chainId,
          selectedVault.asset.address as Address,
          address,
          depositRouterAddress,
          callData,
          undefined,
          slippage / 100
        )
        
        if (!freshQuote || !freshQuote.transactionRequest) {
          throw new Error('Failed to get contract call quote with signature. Please try again.')
        }
        
        // For contract call quotes, skip gas estimation because:
        // 1. LI.FI handles the complex multi-step transaction (swap + contract call)
        // 2. Tokens arrive during transaction execution, not before
        // 3. Gas estimation can't properly simulate this flow
        // We'll use LI.FI's gas estimate from the quote instead
        console.log('Skipping gas estimation for contract call quote (using LI.FI gas estimate)')
        
        // Optional: Try to validate, but don't fail on "Insufficient tokens" error
        // This error is expected during simulation because tokens arrive during execution
        try {
          setExecutionStatus('Validating transaction...')
          const freshTxValue = BigInt(freshQuote.transactionRequest.value || '0')
          await publicClient?.estimateGas({
            account: address!,
            to: freshQuote.transactionRequest.to as Address,
            data: freshQuote.transactionRequest.data as `0x${string}`,
            value: freshTxValue,
          })
          console.log('Gas estimation successful')
        } catch (gasError: any) {
          const errorMsg = gasError?.shortMessage || gasError?.message || ''
          // "Insufficient tokens in contract" is expected for contract call quotes
          // because tokens arrive during transaction execution, not before
          if (errorMsg.includes('Insufficient tokens in contract')) {
            console.log('Gas estimation shows "Insufficient tokens" - this is expected for contract call quotes. Tokens will arrive during execution.')
            // Allow transaction to proceed - LI.FI will handle the flow correctly
          } else {
            // For other errors, log but still allow (LI.FI's quote should be valid)
            console.warn('Gas estimation warning (non-critical):', errorMsg)
            // Don't throw - trust LI.FI's quote
          }
        }
        
        // STEP 3: Execute swap + deposit in one transaction
        // Note: MetaMask may show "likely to fail" warning due to gas estimation
        // This is a false positive - LI.FI will swap tokens and send them to the contract
        // in the same transaction, so tokens will be available when the deposit function is called
        setExecutionStatus('Step 2/2: Please confirm the swap + deposit transaction...')
        setExecutionStep('swapping')
        await updateTransactionState('pending', 'swapping')
        
        // Extract all gas-related parameters from LI.FI's quote to ensure accurate gas costs
        // This ensures MetaMask uses LI.FI's optimized gas prices instead of its own estimates
        const txRequest = freshQuote.transactionRequest
        const gasParams: any = {}
        
        // Helper to convert hex string or number to BigInt
        const toBigInt = (value: any): bigint | undefined => {
          if (!value) return undefined
          if (typeof value === 'bigint') return value
          if (typeof value === 'string') {
            return value.startsWith('0x') ? BigInt(value) : BigInt(value)
          }
          return BigInt(value)
        }
        
        // Use LI.FI's gas limit (they've calculated it correctly for the multi-step flow)
        if (txRequest.gasLimit) {
          gasParams.gas = toBigInt(txRequest.gasLimit)
        }
        
        // Use LI.FI's gas price if available (for legacy transactions)
        if (txRequest.gasPrice) {
          gasParams.gasPrice = toBigInt(txRequest.gasPrice)
        }
        
        // Use LI.FI's EIP-1559 gas parameters if available (preferred for Base)
        // These are more accurate than MetaMask's estimates
        if (txRequest.maxFeePerGas) {
          gasParams.maxFeePerGas = toBigInt(txRequest.maxFeePerGas)
        }
        if (txRequest.maxPriorityFeePerGas) {
          gasParams.maxPriorityFeePerGas = toBigInt(txRequest.maxPriorityFeePerGas)
        }
        
        // Calculate estimated gas cost for logging
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
        
        const swapHash = await walletClient.sendTransaction({
          to: txRequest.to as Address,
          data: txRequest.data as `0x${string}`,
          value: BigInt(txRequest.value || '0'),
          chainId: fromChainId,
          ...gasParams, // Spread all gas parameters - this ensures MetaMask uses LI.FI's estimates
        })
        
        console.log('Transaction sent, hash:', swapHash)
        console.log('Transaction details:', {
          to: txRequest.to,
          value: txRequest.value,
          gasLimit: gasParams.gas?.toString(),
          dataLength: txRequest.data?.length,
        })
        
        setTxHashes({ swap: swapHash, deposit: swapHash }) // Same transaction for both
        setExecutionStatus('Swapping and depositing... Waiting for confirmation...')
        await updateTransactionState('pending', 'depositing')
        
        // Wait for transaction receipt and check if it succeeded
        // Use a longer timeout for LI.FI transactions as they can take longer
        const receipt = await publicClient?.waitForTransactionReceipt({ 
          hash: swapHash,
          timeout: 120000, // 2 minutes timeout
        })
        
        if (!receipt) {
          throw new Error('Transaction receipt not found')
        }
        
        // Check if transaction was reverted
        if (receipt.status === 'reverted') {
          // Try to get the revert reason
          let revertReason = 'Transaction was reverted'
          try {
            // Get the transaction to see if there's error data
            const tx = await publicClient?.getTransaction({ hash: swapHash })
            if (tx) {
              // Try to simulate the transaction to get revert reason
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
        
        // Transaction complete - both swap and deposit happened
        await updateTransactionState('completed', 'completed')
        setExecutionStep('complete')
        setExecutionStatus('🎉 Swap and deposit successful!')
        setAmount('')
        setQuote(null)
        setUserNonce(userNonce + BigInt(1))
        refetchBalance()
        
        setTimeout(() => {
          setExecutionStep('idle')
          setExecutionStatus(null)
          setTxHashes({})
          setTransactionId(null)
          setExecuting(false)
        }, 10000)
        return // Exit early - we're done
      } else {
        // Fallback: separate swap and deposit (old flow)
        console.log('Using regular quote: swap then deposit separately')
        
        // Try to estimate gas to see if transaction will succeed (only for regular quotes)
        try {
          setExecutionStatus('Validating transaction...')
          await publicClient?.estimateGas({
            account: address!,
            to: transactionRequest.to as Address,
            data: transactionRequest.data as `0x${string}`,
            value: txValue,
          })
        } catch (gasError: any) {
          console.error('Gas estimation failed:', gasError)
          const errorMsg = gasError?.shortMessage || gasError?.message || 'Transaction validation failed'
          throw new Error(`Transaction will likely fail: ${errorMsg}. Please try refreshing the quote or adjusting the amount.`)
        }
        
        // STEP 1: Sign deposit intent
        setExecutionStatus('Step 1/3: Please sign the deposit intent...')
        setExecutionStep('idle')
        const signature = await signDepositIntent(intent, chainId, depositRouterAddress, walletClient)
        console.log('Deposit intent signed:', { intent, signature })

        // STEP 2: Execute swap
        setExecutionStatus('Step 2/3: Please confirm the swap transaction...')
        setExecutionStep('swapping')
        await updateTransactionState('pending', 'swapping')
        
        const swapHash = await walletClient.sendTransaction({
          to: transactionRequest.to as Address,
          data: transactionRequest.data as `0x${string}`,
          value: txValue,
          chainId: fromChainId,
        })

        setTxHashes({ swap: swapHash })
        setExecutionStatus('Swapping tokens... Waiting for confirmation...')
        await updateTransactionState('pending', 'swapping')
        const swapReceipt = await publicClient?.waitForTransactionReceipt({ hash: swapHash })
        
        // Check if swap transaction was reverted
        if (swapReceipt && swapReceipt.status === 'reverted') {
          throw new Error('Swap transaction was reverted. Please check the transaction on explorer for details.')
        }
        
        // After swap, try to check actual received amount (optional - if RPC fails, use estimated)
        const vaultAssetAddress = selectedVault.asset.address as Address
        let actualReceivedAmount: bigint | null = null
        try {
          const balanceAfterSwap = await publicClient?.readContract({
            address: vaultAssetAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [address!],
          }) as bigint
          
          // Try to get balance before swap to calculate actual received
          // If this fails, we'll use the estimated amount from quote
          const balanceBeforeSwap = await publicClient?.readContract({
            address: vaultAssetAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [address!],
            blockNumber: swapReceipt?.blockNumber ? swapReceipt.blockNumber - 1n : undefined,
          }).catch(() => null) as bigint | null
          
          if (balanceBeforeSwap !== null) {
            actualReceivedAmount = balanceAfterSwap - balanceBeforeSwap
            console.log('Actual received amount after swap:', {
              balanceBefore: balanceBeforeSwap.toString(),
              balanceAfter: balanceAfterSwap.toString(),
              received: actualReceivedAmount.toString(),
              estimated: quote.estimatedAssets.toString(),
            })
          }
        } catch (error) {
          console.warn('Could not check balance after swap (RPC may not support eth_call), using estimated amount:', error)
          // Continue with estimated amount from quote
        }
        
        setExecutionStep('depositing')
        setExecutionStatus('Step 3/3: Swap complete! Now depositing into vault...')
        await updateTransactionState('pending', 'depositing')

        // STEP 3: Approve and deposit
        const isVaultAssetNative = isNativeToken(vaultAssetAddress)

        if (!isVaultAssetNative) {
          try {
            const vaultAssetAllowance = await publicClient?.readContract({
              address: vaultAssetAddress,
              abi: ERC20_ABI,
              functionName: 'allowance',
              args: [address, depositRouterAddress],
            }) as bigint

            if (vaultAssetAllowance < depositAmount) {
              setExecutionStatus('Approving deposit router...')
              const approveHash = await walletClient.writeContract({
                address: vaultAssetAddress,
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [depositRouterAddress, depositAmount],
              })
              await publicClient?.waitForTransactionReceipt({ hash: approveHash })
            }
          } catch (error: any) {
            // If RPC doesn't support eth_call, try to approve anyway (will fail if already approved, but that's ok)
            console.warn('Could not check allowance (RPC may not support eth_call), attempting approval:', error)
            setExecutionStatus('Approving deposit router...')
            try {
              const approveHash = await walletClient.writeContract({
                address: vaultAssetAddress,
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [depositRouterAddress, depositAmount],
              })
              await publicClient?.waitForTransactionReceipt({ hash: approveHash })
            } catch (approveError) {
              // If approval fails, it might already be approved, continue anyway
              console.warn('Approval may have failed or already approved, continuing:', approveError)
            }
          }
        }

        setExecutionStatus('Please confirm the deposit transaction...')
        // Use ERC4626 functions for Morpho vaults
        const isERC4626 = selectedVault.type?.startsWith('morpho')
        const functionName = selectedVault.hasSettlement
          ? 'depositWithIntentRequest'
          : (isERC4626 ? 'depositWithIntentERC4626' : 'depositWithIntent')

        // Validate intent parameters before sending
        if (!intent.user || !intent.vault || !intent.asset || !intent.amount || intent.amount === 0n || intent.nonce === undefined || !intent.deadline) {
          console.error('Invalid intent parameters:', intent)
          throw new Error('Invalid deposit intent parameters. Please try again.')
        }
        
        if (!signature || signature.length < 130) {
          console.error('Invalid signature:', signature)
          throw new Error('Invalid signature. Please try signing again.')
        }
        
        console.log('Executing deposit:', {
          functionName,
          depositRouterAddress,
          intent,
          signatureLength: signature.length,
        })
        
        const depositHash = await walletClient.writeContract({
          address: depositRouterAddress,
          abi: DEPOSIT_ROUTER_ABI,
          functionName,
          args: [[intent.user, intent.vault, intent.asset, intent.amount, intent.nonce, intent.deadline], signature as `0x${string}`],
        })

        setTxHashes(prev => ({ ...prev, deposit: depositHash }))
        setExecutionStatus('Deposit submitted! Waiting for confirmation...')
        await updateTransactionState('pending', 'depositing')
        const depositReceipt = await publicClient?.waitForTransactionReceipt({ hash: depositHash })
        
        // Check if deposit transaction was reverted
        if (depositReceipt && depositReceipt.status === 'reverted') {
          throw new Error('Deposit transaction was reverted. Please check the transaction on explorer for details.')
        }

        await updateTransactionState('completed', 'completed')
        setExecutionStep('complete')
        setExecutionStatus('🎉 Deposit successful!')
        setAmount('')
        setQuote(null)
        setUserNonce(userNonce + BigInt(1))
        refetchBalance()
        
        setTimeout(() => {
          setExecutionStep('idle')
          setExecutionStatus(null)
          setTxHashes({})
          setTransactionId(null)
          setExecuting(false)
        }, 10000)
      }
    } catch (error: any) {
      console.error('Same chain swap deposit error:', error)
      const errorMessage = error?.shortMessage || error?.message || 'Transaction failed'
      setExecutionStep('idle')
      setExecutionStatus(`Error: ${errorMessage}`)
      
      try {
        await updateTransactionState('failed', 'error', errorMessage)
      } catch (err) {
        console.error('Error updating failed transaction state:', err)
      }
      
      setTimeout(() => {
        setExecutionStatus(null)
        setTxHashes({})
        setTransactionId(null)
      }, 10000)
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

      // Use ERC4626 functions for Morpho vaults
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
        args: [[intent.user, intent.vault, intent.asset, intent.amount, intent.nonce, intent.deadline], signature as `0x${string}`],
      })

      setTxHashes({ deposit: hash })
      setExecutionStatus('Deposit submitted! Waiting for confirmation...')
      await publicClient?.waitForTransactionReceipt({ hash })

      await updateTransactionState('completed', 'completed')
      setExecutionStep('complete')
      setExecutionStatus('🎉 Deposit successful!')
      setAmount('')
      setQuote(null)
      setUserNonce(userNonce + BigInt(1))
      refetchBalance()
      setExecuting(false)
      
      setTimeout(() => {
        setExecutionStep('idle')
        setExecutionStatus(null)
        setTxHashes({})
        setTransactionId(null)
      }, 10000)
    } catch (error: any) {
      console.error('Direct deposit error:', error)
      const errorMessage = error?.shortMessage || error?.message || 'Transaction failed'
      setExecutionStep('idle')
      setExecutionStatus(`Error: ${errorMessage}`)
      
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
      
      setTimeout(() => {
        setExecutionStatus(null)
        setTxHashes({})
        setTransactionId(null)
      }, 10000)
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
    // Shares are always in 18 decimals for ERC4626 vaults
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
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <Link href="/" className="text-2xl font-bold text-black">Yieldo</Link>
          <ConnectButton />
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white border-2 border-black rounded-lg p-6">
              <h2 className="text-xl font-bold mb-4">Vault Details</h2>
              <select
                value={selectedVaultId}
                onChange={(e) => setSelectedVaultId(e.target.value)}
                className="w-full border-2 border-black rounded-lg px-4 py-3 mb-4 font-medium focus:outline-none focus:ring-2 focus:ring-black"
              >
                {allVaults.map((vault) => (
                  <option key={vault.id} value={vault.id}>
                    {vault.name} {vault.type === 'lagoon' ? '(Lagoon)' : vault.type === 'morpho-v1' ? '(Morpho V1)' : vault.type === 'morpho-v2' ? '(Morpho V2)' : ''}
                  </option>
                ))}
              </select>

              <div className="mb-4">
                {selectedVault.type === 'lagoon' && (
                  <span className="inline-block px-3 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full">
                    Lagoon Vault
                  </span>
                )}
                {selectedVault.type === 'morpho-v1' && (
                  <span className="inline-block px-3 py-1 bg-purple-100 text-purple-800 text-xs font-semibold rounded-full">
                    Morpho V1
                  </span>
                )}
                {selectedVault.type === 'morpho-v2' && (
                  <span className="inline-block px-3 py-1 bg-indigo-100 text-indigo-800 text-xs font-semibold rounded-full">
                    Morpho V2
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-sm text-gray-500">TVL</p>
                  <p className="text-xl font-bold">{formatTVL(vaultState?.totalAssets)}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-sm text-gray-500">APY</p>
                  <p className="text-xl font-bold text-green-600">
                    {vaultState?.apr ? `${(parseFloat(vaultState.apr) * 100).toFixed(2)}%` : '-'}
                  </p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-sm text-gray-500">Chain</p>
                  <p className="text-xl font-bold capitalize">{selectedVault.chain}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-sm text-gray-500">Asset</p>
                  <p className="text-xl font-bold">{selectedVault.asset.symbol}</p>
                </div>
              </div>

              <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="text-sm text-gray-500">Vault Address</p>
                <a 
                  href={
                    selectedVault.chain === 'ethereum' 
                      ? `https://etherscan.io/address/${selectedVault.address}`
                      : selectedVault.chain === 'base'
                      ? `https://basescan.org/address/${selectedVault.address}`
                      : `https://snowtrace.io/address/${selectedVault.address}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline text-sm font-mono break-all"
                >
                  {selectedVault.address}
                </a>
              </div>
            </div>

            {!isConnected ? (
              <div className="bg-white border-2 border-black rounded-lg p-8 text-center">
                <p className="text-gray-600 mb-4">Connect your wallet to deposit</p>
                <ConnectButton />
              </div>
            ) : (
              <div className="bg-white border-2 border-black rounded-lg p-6">
                <h2 className="text-xl font-bold mb-4">Deposit</h2>

                <div className="mb-4">
                  <PendingTransactions 
                    onResume={async (tx) => {
                      // Find the vault for this transaction
                      const vault = tx.vault_id ? getVaultById(tx.vault_id) : null
                      if (!vault) {
                        alert('Could not find vault for this transaction')
                        return
                      }
                      
                      // Check if user is on the correct chain
                      if (chainId !== vault.chainId) {
                        alert(`Please switch to ${vault.chain === 'avalanche' ? 'Avalanche' : vault.chain} to complete this deposit`)
                        return
                      }
                      
                      // Get the estimated amount from lifi_status
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
                      
                      // Set up state and execute deposit
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
                        className="flex-1 border-2 border-gray-300 rounded-lg px-4 py-3 text-lg focus:border-black focus:outline-none"
                      />
                      <button
                        onClick={() => {
                          if (tokenBalance) setAmount(formatUnits(tokenBalance.value, tokenBalance.decimals))
                        }}
                        className="px-4 py-3 border-2 border-black bg-white hover:bg-black hover:text-white rounded-lg font-medium transition-colors"
                      >
                        Max
                      </button>
                    </div>
                    {hasInsufficientBalance && (
                      <p className="mt-2 text-sm text-red-500">Amount exceeds your available balance</p>
                    )}
                  </div>

                  {needsChainSwitch && (
                    <div className="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-4">
                      <p className="text-yellow-800 mb-2">Please switch to {fromChain?.name} network</p>
                      <button
                        onClick={() => switchChain({ chainId: fromChainId })}
                        className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-black rounded-lg font-medium"
                      >
                        Switch Network
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            {loadingQuote && (
              <div className="bg-white border-2 border-black rounded-lg p-6 text-center">
                <p className="text-gray-500">Fetching quote...</p>
              </div>
            )}

            {quote && !loadingQuote && (
              <div className="bg-white border-2 border-black rounded-lg p-6 sticky top-6">
                <h3 className="text-lg font-bold mb-4">Preview</h3>

                <div className="space-y-4">
                  <div className="flex justify-between items-center pb-4 border-b border-gray-200">
                    <span className="text-gray-600">You Pay</span>
                    <div className="text-right">
                      <p className="font-bold">{amount} {fromToken?.symbol}</p>
                      <p className="text-sm text-gray-500">on {fromChain?.name}</p>
                    </div>
                  </div>

                  <div className="flex justify-center">
                    <div className="w-8 h-8 bg-black rounded-full flex items-center justify-center">
                      <span className="text-white">↓</span>
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                    <span className="text-gray-600">You Receive</span>
                    <div className="text-right">
                      <p className="font-bold text-green-600">
                        {formatShares(quote.estimatedShares, 18)} Shares
                      </p>
                      <p className="text-sm text-gray-500">on {toChain?.name}</p>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Estimated {selectedVault.asset.symbol}</span>
                      <span className="font-medium">{parseFloat(formatUnits(quote.estimatedAssets, selectedVault.asset.decimals)).toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Protocol Fee (0.1%)</span>
                      <span className="font-medium">{parseFloat(formatUnits(quote.feeAmount, selectedVault.asset.decimals)).toFixed(4)}</span>
                    </div>
                    {quote.feeCosts !== undefined && quote.feeCosts > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Provider Fees</span>
                        <span className="font-medium">${quote.feeCosts.toFixed(4)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-500">Min. Received</span>
                      <span className="font-medium">{formatShares(quote.minReceived, 18)} Shares</span>
                    </div>
                    {quote.estimatedTime && (
                      <div className="flex justify-between items-center">
                        <span className="text-gray-500">Est. Time</span>
                        <span className="font-medium text-blue-600">{formatTime(quote.estimatedTime)}</span>
                      </div>
                    )}
                    {quote.gasCosts !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Estimated Gas Cost</span>
                        <span className="font-medium">
                          {quote.gasCosts > 0 ? `$${quote.gasCosts.toFixed(4)}` : 'Included in quote'}
                        </span>
                      </div>
                    )}
                    {quote.hasContractCall && quote.quote?.transactionRequest && (
                      <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                        <p className="text-blue-800">
                          <strong>Note:</strong> MetaMask may show a higher gas estimate due to its own calculation. 
                          The actual gas used will be based on LI.FI's optimized route.
                        </p>
                        {quote.quote.transactionRequest.gasLimit && (
                          <p className="text-blue-700 mt-1">
                            LI.FI Gas Limit: {parseInt(quote.quote.transactionRequest.gasLimit.toString(), 16).toLocaleString()}
                          </p>
                        )}
                      </div>
                    )}
                    {quote.steps && quote.steps > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Steps</span>
                        <span className="font-medium">{quote.steps} {quote.steps === 1 ? 'step' : 'steps'}</span>
                      </div>
                    )}
                    {quote.priceImpact !== undefined && quote.priceImpact > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Price Impact</span>
                        <span className={`font-medium ${quote.priceImpact > 2 ? 'text-red-500' : 'text-yellow-600'}`}>{quote.priceImpact.toFixed(2)}%</span>
                      </div>
                    )}
                    
                    {/* Detailed step breakdown */}
                    {quote.stepDetails && quote.stepDetails.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-300">
                        <p className="text-xs font-semibold text-gray-700 mb-2">Route Breakdown:</p>
                        <div className="space-y-2">
                          {quote.stepDetails.map((step, idx) => (
                            <div key={idx} className="flex items-start justify-between text-xs">
                              <div className="flex-1">
                                <div className="flex items-center gap-1">
                                  {step.logoURI && (
                                    <img src={step.logoURI} alt={step.tool} className="w-3 h-3 rounded" />
                                  )}
                                  <span className="font-medium text-gray-700">{step.tool}</span>
                                  <span className="text-gray-500">({step.type})</span>
                                </div>
                                {step.fromToken && step.toToken && (
                                  <span className="text-gray-500 text-xs">
                                    {step.fromToken} → {step.toToken}
                                  </span>
                                )}
                              </div>
                              <div className="text-right text-gray-600">
                                {step.gasCosts > 0 && <div>Gas: ${step.gasCosts.toFixed(4)}</div>}
                                {step.feeCosts > 0 && <div>Fee: ${step.feeCosts.toFixed(4)}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Auto-deposit indicator - shows when contract call is available for any route */}
                  {quote?.hasContractCall && (
                    <div className="mt-3 p-2 bg-green-50 border border-green-200 rounded-lg">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-green-600">✨</span>
                        <span className="text-green-800 font-medium">Automatic Deposit Enabled via LI.FI Composer</span>
                      </div>
                      <p className="text-xs text-green-700 mt-1">
                        {fromChainId === selectedVault.chainId 
                          ? 'Swap and deposit will happen in one transaction. No manual steps required!'
                          : 'Your deposit will complete automatically after the bridge. No manual steps required!'}
                      </p>
                      <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                        <p className="font-medium mb-1">⚠️ MetaMask Warning Notice:</p>
                        <p>MetaMask may show "likely to fail" due to gas estimation. This is a <strong>false positive</strong>. LI.FI will swap tokens and send them to the contract in the same transaction, so the deposit will execute successfully.</p>
                      </div>
                    </div>
                  )}

                  {executing && (
                    <div className="mt-4 space-y-4">
                      <TransactionLoader 
                        step={executionStep} 
                        status={executionStatus}
                        txHashes={txHashes}
                        sourceChainId={fromChainId}
                      />
                      {transactionId && (
                        <TransactionStatus 
                          transactionId={transactionId}
                          userAddress={address as Address}
                        />
                      )}
                    </div>
                  )}
                  {!executing && !transactionId && executionStatus && (
                    <div className={`rounded-lg p-3 ${
                      executionStatus.includes('Error') 
                        ? 'bg-red-50 border border-red-200' 
                        : 'bg-green-50 border border-green-200'
                    }`}>
                      <p className={`text-sm ${
                        executionStatus.includes('Error') ? 'text-red-800' : 'text-green-800'
                      }`}>{executionStatus}</p>
                    </div>
                  )}

                  <button
                    onClick={handleExecute}
                    disabled={!canExecute}
                    className="w-full py-4 bg-black text-white rounded-lg font-bold text-lg hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                  >
                    {executing ? 'Processing...' : needsChainSwitch ? 'Switch Network First' : 'Deposit'}
                  </button>
                </div>
              </div>
            )}

            {!quote && !loadingQuote && amount && fromToken && !needsChainSwitch && (
              <div className="bg-white border-2 border-black rounded-lg p-6 text-center">
                <p className="text-gray-500">Unable to get quote. Try a different amount or token.</p>
              </div>
            )}

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h4 className="font-medium mb-2">How it works</h4>
              <ol className="text-sm text-gray-600 space-y-2">
                <li>1. Select your source chain and token</li>
                <li>2. Enter the amount you want to deposit</li>
                <li>3. Sign the deposit intent (message signature)</li>
                <li>4. Confirm the bridge transaction</li>
                <li>5. LI.FI swaps, bridges & deposits automatically!</li>
              </ol>
              <p className="text-xs text-gray-500 mt-3">
                ✨ You only sign on your current chain - no need to switch networks!
              </p>
            </div>

            {/* Transaction History */}
            {address && (
              <TransactionHistory />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function VaultsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <VaultsPageContent />
    </Suspense>
  )
}

'use client'

import { useAccount, useChainId, useSwitchChain, useBalance, usePublicClient, useReadContract } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useState, useEffect, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { parseUnits, formatUnits, Address, createPublicClient, http, encodeFunctionData } from 'viem'
import { avalanche, mainnet, base, optimism, arbitrum, bsc } from 'viem/chains'
import { VAULTS_CONFIG, getVaultById, type VaultConfig } from '@/lib/vaults-config'
import { SUPPORTED_CHAINS, getTokensForChain, getDepositQuote, checkTransferStatus, getBridgeFromQuote, getQuoteWithContractCall, getQuote, type TokenInfo, type DepositQuote } from '@/lib/lifi'
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
              args: [[intent.user, intent.vault, intent.asset, intent.amount, intent.nonce, intent.deadline], '0x' as `0x${string}`],
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
              const minReceivedAmount = BigInt(tempQuote.estimate?.toAmountMin || toAmountStr) - ((BigInt(tempQuote.estimate?.toAmountMin || toAmountStr) * BigInt(10)) / BigInt(10000))
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
      
      setUserNonce(intent.nonce + BigInt(1))
      refetchBalance()
      
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

      setExecutionStatus('Step 1/3: Signing deposit intent...')
      
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200)
      const intent: DepositIntent = {
        user: address!,
        vault: capturedVault.address as Address,
        asset: capturedVault.asset.address as Address,
        amount: depositAmount,
        nonce: userNonce,
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
        args: [[intent.user, intent.vault, intent.asset, intent.amount, intent.nonce, intent.deadline], signature as `0x${string}`],
      })
      
      console.log('Encoded callData:', callData)

      setExecutionStatus('Step 2/3: Finding bridge that supports automatic deposit...')
      
      const bridgeFromRegularQuote = getBridgeFromQuote(capturedQuote.quote)
      const preferredBridges = bridgeFromRegularQuote ? [bridgeFromRegularQuote] : undefined
      
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
          0.03
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
            
            if (chainId !== capturedFromChainId) {
              await switchChain?.({ chainId: capturedFromChainId })
              await new Promise(resolve => setTimeout(resolve, 3000))
            }
            
            const approveHash = await walletClient.writeContract({
              address: capturedFromToken.address,
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [transactionRequest.to as Address, parsedFromAmount],
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
        const allowance = await sourcePublicClient.readContract({
          address: capturedFromToken.address,
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

      setUserNonce(userNonce + BigInt(1))

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
      setExecutionStatus(`Error: ${errorMessage}`)
      setExecuting(false)
      
      await updateTransactionState('failed', 'error', errorMessage, undefined, bridgeHash || undefined)
      
      setTimeout(() => {
        setExecutionStatus(null)
        setTxHashes({})
        setTransactionId(null)
      }, 30000)
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      if (quote.hasContractCall) {
        console.log('Using contract call quote: swap + deposit in one transaction')
        
        setExecutionStatus('Step 1/2: Please sign the deposit intent...')
        setExecutionStep('idle')
        const signature = await signDepositIntent(intent, chainId, depositRouterAddress, walletClient)
        console.log('Deposit intent signed:', { intent, signature })
        
        setExecutionStatus('Preparing swap + deposit transaction...')
        const isERC4626 = selectedVault.type?.startsWith('morpho')
        const functionName = selectedVault.hasSettlement
          ? 'depositWithIntentCrossChainRequest'
          : (isERC4626 ? 'depositWithIntentCrossChainERC4626' : 'depositWithIntentCrossChain')

        console.log('=== DEPOSIT INTENT DEBUG ===')
        console.log('Vault type:', selectedVault.type)
        console.log('Is ERC4626:', isERC4626)
        console.log('Function name:', functionName)
        console.log('Intent:', {
          user: intent.user,
          vault: intent.vault,
          asset: intent.asset,
          amount: intent.amount.toString(),
          nonce: intent.nonce.toString(),
          deadline: intent.deadline.toString(),
        })
        console.log('Deposit Router:', depositRouterAddress)
        console.log('Signature:', signature)

        const callData = encodeFunctionData({
          abi: DEPOSIT_ROUTER_ABI,
          functionName,
          args: [[intent.user, intent.vault, intent.asset, intent.amount, intent.nonce, intent.deadline], signature as `0x${string}`],
        })

        console.log('Encoded callData (first 200 chars):', callData.substring(0, 200))
        console.log('CallData length:', callData.length)

        const preferredBridges = quote.usedBridge ? [quote.usedBridge] : undefined
        console.log('📌 Using preferred bridges for fresh quote:', preferredBridges)

        const freshQuote = await getQuoteWithContractCall(
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
        
        if (!freshQuote || !freshQuote.transactionRequest) {
          console.warn('=== CONTRACT CALL QUOTE FAILED - FALLING BACK TO TWO-STEP PROCESS ===')
          console.warn('Fresh quote:', freshQuote)
          console.warn('Will bridge first, then user completes deposit on destination chain')

          setExecutionStatus('⚠️ One-step deposit unavailable. Switching to bridge + deposit flow...')

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

            const allowance = await sourcePublicClient.readContract({
              address: fromToken.address,
              abi: ERC20_ABI,
              functionName: 'allowance',
              args: [address!, regularQuote.transactionRequest.to as Address],
            }) as bigint

            const parsedFromAmount = parseUnits(amount, fromToken.decimals)
            if (allowance < parsedFromAmount) {
              setExecutionStatus('Step 2/4: Approving token spend...')
              setExecutionStep('approving')
              await updateTransactionState('pending', 'approving')

              const approveHash = await walletClient.writeContract({
                address: fromToken.address,
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [regularQuote.transactionRequest.to as Address, parsedFromAmount],
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

          const localFunctionName = isERC4626 ? 'depositWithIntentERC4626' : 'depositWithIntent'

          const depositHash = await walletClient.writeContract({
            address: depositRouterAddress,
            abi: DEPOSIT_ROUTER_ABI,
            functionName: localFunctionName,
            args: [[intent.user, intent.vault, intent.asset, intent.amount, intent.nonce, intent.deadline], signature as `0x${string}`],
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

          setAmount('')
          setQuote(null)
          setExecuting(false)
          refetchBalance()

          setTimeout(() => {
            setExecutionStep('idle')
            setExecutionStatus(null)
            setTxHashes({})
          }, 10000)
          return
        }

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
        return
      } else {
        console.log('Using regular quote: swap then deposit separately')
        
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
        
        setExecutionStatus('Step 1/3: Please sign the deposit intent...')
        setExecutionStep('idle')
        const signature = await signDepositIntent(intent, chainId, depositRouterAddress, walletClient)
        console.log('Deposit intent signed:', { intent, signature })

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
        
        if (swapReceipt && swapReceipt.status === 'reverted') {
          throw new Error('Swap transaction was reverted. Please check the transaction on explorer for details.')
        }
        
        const vaultAssetAddress = selectedVault.asset.address as Address
        let actualReceivedAmount: bigint | null = null
        try {
          const balanceAfterSwap = await publicClient?.readContract({
            address: vaultAssetAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [address!],
          }) as bigint
          
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
        }
        
        setExecutionStep('depositing')
        setExecutionStatus('Step 3/3: Swap complete! Now depositing into vault...')
        await updateTransactionState('pending', 'depositing')

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
              console.warn('Approval may have failed or already approved, continuing:', approveError)
            }
          }
        }

        setExecutionStatus('Please confirm the deposit transaction...')
        const isERC4626 = selectedVault.type?.startsWith('morpho')
        const functionName = selectedVault.hasSettlement
          ? 'depositWithIntentRequest'
          : (isERC4626 ? 'depositWithIntentERC4626' : 'depositWithIntent')

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
      console.error('=== SAME CHAIN SWAP DEPOSIT ERROR ===')
      console.error('Error object:', error)
      console.error('Error message:', error?.message)
      console.error('Error shortMessage:', error?.shortMessage)
      console.error('Error details:', error?.details)
      console.error('Error cause:', error?.cause)
      console.error('Error stack:', error?.stack)
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
              <div className="bg-white border-2 border-black rounded-lg p-4 sticky top-6">
                {/* Compact Header */}
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold">Quote</h3>
                  {quote?.hasContractCall && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✨ Auto-deposit</span>
                  )}
                </div>

                {/* Pay/Receive - Compact */}
                <div className="bg-gray-50 rounded-lg p-3 mb-3">
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

                {/* Key Details - Grid */}
                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  <div className="bg-gray-50 rounded p-2">
                    <span className="text-gray-500 block">Est. {selectedVault.asset.symbol}</span>
                    <span className="font-medium">{parseFloat(formatUnits(quote.estimatedAssets, selectedVault.asset.decimals)).toFixed(2)}</span>
                  </div>
                  <div className="bg-gray-50 rounded p-2">
                    <span className="text-gray-500 block">Fee (0.1%)</span>
                    <span className="font-medium">{parseFloat(formatUnits(quote.feeAmount, selectedVault.asset.decimals)).toFixed(4)}</span>
                  </div>
                  {quote.estimatedTime && (
                    <div className="bg-gray-50 rounded p-2">
                      <span className="text-gray-500 block">Est. Time</span>
                      <span className="font-medium text-blue-600">{formatTime(quote.estimatedTime)}</span>
                    </div>
                  )}
                  {quote.gasCosts !== undefined && quote.gasCosts > 0 && (
                    <div className="bg-gray-50 rounded p-2">
                      <span className="text-gray-500 block">Gas</span>
                      <span className="font-medium">${quote.gasCosts.toFixed(2)}</span>
                    </div>
                  )}
                </div>

                {/* Route Info - Collapsible */}
                {quote.stepDetails && quote.stepDetails.length > 0 && (
                  <details className="text-xs mb-3">
                    <summary className="cursor-pointer text-gray-600 hover:text-gray-800 font-medium">
                      Route: {quote.stepDetails.map(s => s.tool).join(' → ')}
                    </summary>
                    <div className="mt-2 pl-2 border-l-2 border-gray-200 space-y-1">
                      {quote.stepDetails.map((step, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-gray-600">
                          {step.logoURI && <img src={step.logoURI} alt="" className="w-3 h-3 rounded" />}
                          <span>{step.tool}</span>
                          <span className="text-gray-400">({step.type})</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* Price Impact Warning */}
                {quote.priceImpact !== undefined && quote.priceImpact > 1 && (
                  <div className={`text-xs p-2 rounded mb-3 ${quote.priceImpact > 2 ? 'bg-red-50 text-red-700' : 'bg-yellow-50 text-yellow-700'}`}>
                    ⚠️ Price impact: {quote.priceImpact.toFixed(2)}%
                  </div>
                )}

                {/* MetaMask Notice - Compact */}
                {quote?.hasContractCall && (
                  <div className="text-xs p-2 bg-yellow-50 border border-yellow-200 rounded text-yellow-800">
                    <strong>Note:</strong> MetaMask may show "likely to fail" - this is normal. The transaction will succeed.
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
                  className="w-full mt-4 py-4 bg-black text-white rounded-lg font-bold text-lg hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  {executing ? 'Processing...' : needsChainSwitch ? 'Switch Network First' : 'Deposit'}
                </button>
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

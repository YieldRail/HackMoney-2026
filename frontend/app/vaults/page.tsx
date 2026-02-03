'use client'

import { useAccount, useChainId, useSwitchChain, useBalance, usePublicClient, useReadContract } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useState, useEffect, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { parseUnits, formatUnits, Address, createPublicClient, http } from 'viem'
import { avalanche, mainnet, base, optimism, arbitrum, bsc } from 'viem/chains'
import { VAULTS_CONFIG, getVaultById } from '@/lib/vaults-config'
import { SUPPORTED_CHAINS, getTokensForChain, getDepositQuote, checkTransferStatus, type TokenInfo, type DepositQuote } from '@/lib/lifi'
import { getVaultState } from '@/lib/lagoon'
import { signDepositIntent, getIntentHash, type DepositIntent } from '@/lib/eip712'
import { useWalletClient } from 'wagmi'
import DEPOSIT_ROUTER_ABI from '@/lib/deposit-router-abi.json'
import ERC20_ABI from '@/lib/erc20-abi.json'
import { CustomSelect } from '@/components/CustomSelect'
import { TransactionLoader } from '@/components/TransactionLoader'
import { TransactionStatus } from '@/components/TransactionStatus'

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

  const initialVaultId = searchParams.get('vault') || VAULTS_CONFIG[0].id
  const [selectedVaultId, setSelectedVaultId] = useState<string>(initialVaultId)
  const selectedVault = useMemo(() => getVaultById(selectedVaultId) || VAULTS_CONFIG[0], [selectedVaultId])

  const [fromChainId, setFromChainId] = useState<number>(43114)
  const [fromToken, setFromToken] = useState<TokenInfo | null>(null)
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState(0.5)

  const [availableTokens, setAvailableTokens] = useState<TokenInfo[]>([])
  const [loadingTokens, setLoadingTokens] = useState(false)
  const [quote, setQuote] = useState<DepositQuote | null>(null)
  const [loadingQuote, setLoadingQuote] = useState(false)
  const [vaultState, setVaultState] = useState<any>(null)
  const [vaultSharesPerAsset, setVaultSharesPerAsset] = useState<bigint>(BigInt(10 ** 18))
  const [executing, setExecuting] = useState(false)
  const [executionStatus, setExecutionStatus] = useState<string | null>(null)
  const [executionStep, setExecutionStep] = useState<'idle' | 'approving' | 'swapping' | 'bridging' | 'depositing' | 'complete'>('idle')
  const [userNonce, setUserNonce] = useState<bigint>(BigInt(0))
  const [txHashes, setTxHashes] = useState<{
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
    const timeoutId = setTimeout(fetchQuote, 500)
    return () => clearTimeout(timeoutId)
  }, [amount, fromToken, selectedVault, fromChainId, address, chainId, vaultSharesPerAsset, slippage])

  const fetchVaultState = async () => {
    if (!selectedVault) return
    try {
      const state = await getVaultState(selectedVault.address as Address, selectedVault.chain, true)
      setVaultState(state)
      if (state?.totalAssets && state?.totalSupply) {
        const assets = BigInt(state.totalAssets)
        const supply = BigInt(state.totalSupply)
        if (supply > 0n) setVaultSharesPerAsset((supply * BigInt(10 ** 18)) / assets)
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
      const quoteResult = await getDepositQuote(
        fromChainId,
        fromToken.address,
        fromAmount,
        selectedVault.chainId,
        selectedVault.asset.address as Address,
        selectedVault.address as Address,
        depositRouterAddress,
        address,
        selectedVault.hasSettlement,
        vaultSharesPerAsset,
        selectedVault.asset.decimals,
        slippage / 100
      )
      setQuote(quoteResult)
    } catch (error) {
      console.error('Error fetching quote:', error)
      setQuote(null)
    } finally {
      setLoadingQuote(false)
    }
  }

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

    setExecuting(true)
    setExecutionStep('approving')
    setExecutionStatus('Preparing cross-chain transaction...')
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

    const updateTransactionState = async (status: string, currentStep: string, errorMessage?: string, lifiStatusData?: any) => {
      try {
        const depositRouterAddress = selectedVault.depositRouter as Address
        const depositAmount = quote.estimatedAssets + quote.feeAmount
        const fromAmount = parseUnits(amount, fromToken.decimals)

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
            from_amount: fromAmount.toString(),
            to_token: selectedVault.asset.address,
            to_token_symbol: selectedVault.asset.symbol,
            to_amount: depositAmount.toString(),
            swap_tx_hash: txHashes.swap || null,
            bridge_tx_hash: txHashes.bridge || null,
            deposit_tx_hash: txHashes.deposit || null,
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

    try {
      const transactionRequest = quote.quote.transactionRequest
      if (!transactionRequest) throw new Error('No transaction request in quote')

      const fromAmount = parseUnits(amount, fromToken.decimals)
      const isNative = fromToken.isNative || isNativeToken(fromToken.address)

      await updateTransactionState('pending', 'initiated')

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
          await updateTransactionState('pending', 'approving')
          const approveHash = await walletClient.writeContract({
            address: fromToken.address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [transactionRequest.to as Address, fromAmount],
          })
          await publicClient?.waitForTransactionReceipt({ hash: approveHash })
        }
      }

      setExecutionStatus('Please confirm the cross-chain transaction...')
      setExecutionStep('bridging')
      await updateTransactionState('pending', 'bridging')
      
      const bridgeHash = await walletClient.sendTransaction({
        to: transactionRequest.to as Address,
        data: transactionRequest.data as `0x${string}`,
        value: BigInt(transactionRequest.value || '0'),
        chainId: fromChainId,
      })

      setTxHashes({ bridge: bridgeHash })
      setExecutionStatus('Bridging tokens... Waiting for confirmation...')
      await updateTransactionState('pending', 'bridging', undefined, { txHash: bridgeHash, status: 'PENDING' })
      
      await publicClient?.waitForTransactionReceipt({ hash: bridgeHash })
      
      setExecutionStep('depositing')
      setExecutionStatus('Bridge confirmed! Tracking deposit on destination chain...')
      await updateTransactionState('pending', 'depositing', undefined, { txHash: bridgeHash, status: 'DONE' })

      const depositRouterAddress = selectedVault.depositRouter as Address
      const depositAmount = quote.estimatedAssets + quote.feeAmount

      const startPollingLifiStatus = () => {
        const currentQuote = quote.quote
        if (!currentQuote?.steps || currentQuote.steps.length === 0) {
          return
        }

        const firstStep = currentQuote.steps[0]
        const bridge = firstStep.toolDetails?.key || firstStep.tool || 'lifi'
        
        const interval = setInterval(async () => {
          try {
            const status = await checkTransferStatus(
              bridge,
              fromChainId,
              selectedVault.chainId,
              bridgeHash
            )

            if (status) {
              setLifiStatus(status)
              const statusValue = status.status || status.sending?.status || 'PENDING'
              const isDone = statusValue === 'DONE' || statusValue === 'DONE_CHECKING'
              const isFailed = statusValue === 'FAILED' || statusValue === 'FAILED_CHECKING'
              
              await updateTransactionState(
                isDone ? 'completed' : isFailed ? 'failed' : 'pending',
                isDone ? 'depositing' : 'bridging',
                isFailed ? (status.error?.message || status.receiving?.error?.message) : undefined,
                status
              )

              if (isDone) {
                clearInterval(interval)
                setExecutionStep('complete')
                setExecutionStatus('Deposit completed successfully!')
                await updateTransactionState('completed', 'completed')
              } else if (isFailed) {
                clearInterval(interval)
                setExecutionStep('idle')
                setExecutionStatus(`Error: ${status.error?.message || status.receiving?.error?.message || 'Transaction failed'}`)
                await updateTransactionState('failed', 'failed', status.error?.message || status.receiving?.error?.message)
              }
            }
          } catch (err) {
            console.error('Error checking LI.FI status:', err)
          }
        }, 5000)

        setTimeout(() => clearInterval(interval), 300000)
      }

      startPollingLifiStatus()

      await updateTransactionState('pending', 'depositing')
      
      setAmount('')
      setQuote(null)
      refetchBalance()
    } catch (error: any) {
      console.error('Execution error:', error)
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
              bridge_tx_hash: txHashes.bridge || null,
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

  const handleSameChainSwapDeposit = async () => {
    if (!quote || !walletClient || !address || !selectedVault || !fromToken || !quote.quote) return

    setExecuting(true)
    setExecutionStatus('Preparing swap transaction...')

    try {
      const transactionRequest = quote.quote.transactionRequest
      if (!transactionRequest) throw new Error('No transaction request in quote')

      const fromAmount = parseUnits(amount, fromToken.decimals)
      const isNative = fromToken.isNative || isNativeToken(fromToken.address)

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

      setExecutionStatus('Please confirm the swap transaction...')
      setExecutionStep('swapping')
      await updateTransactionState('pending', 'swapping')
      
      const swapHash = await walletClient.sendTransaction({
        to: transactionRequest.to as Address,
        data: transactionRequest.data as `0x${string}`,
        value: BigInt(transactionRequest.value || '0'),
        chainId: fromChainId,
      })

      setTxHashes({ swap: swapHash })
      setExecutionStatus('Swapping tokens... Waiting for confirmation...')
      await updateTransactionState('pending', 'swapping')
      await publicClient?.waitForTransactionReceipt({ hash: swapHash })
      
      setExecutionStep('depositing')
      setExecutionStatus('Swap complete! Now depositing into vault...')
      await updateTransactionState('pending', 'depositing')

      const depositRouterAddress = selectedVault.depositRouter as Address
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const depositAmount = quote.estimatedAssets + quote.feeAmount

      const intent: DepositIntent = {
        user: address,
        vault: selectedVault.address as Address,
        asset: selectedVault.asset.address as Address,
        amount: depositAmount,
        nonce: userNonce,
        deadline,
      }

      const signature = await signDepositIntent(intent, chainId, depositRouterAddress)

      const vaultAssetAddress = selectedVault.asset.address as Address
      const isVaultAssetNative = isNativeToken(vaultAssetAddress)

      if (!isVaultAssetNative) {
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
      }

      setExecutionStatus('Please confirm the deposit transaction...')
      const functionName = selectedVault.hasSettlement ? 'depositWithIntentRequest' : 'depositWithIntent'
      const depositHash = await walletClient.writeContract({
        address: depositRouterAddress,
        abi: DEPOSIT_ROUTER_ABI,
        functionName,
        args: [[intent.user, intent.vault, intent.asset, intent.amount, intent.nonce, intent.deadline], signature as `0x${string}`],
      })

      setTxHashes(prev => ({ ...prev, deposit: depositHash }))
      setExecutionStatus('Deposit submitted! Waiting for confirmation...')
      await updateTransactionState('pending', 'depositing')
      await publicClient?.waitForTransactionReceipt({ hash: depositHash })

      await updateTransactionState('completed', 'completed')
      setExecutionStep('complete')
      setExecutionStatus('Deposit successful!')
      setAmount('')
      setQuote(null)
      setUserNonce(userNonce + BigInt(1))
      refetchBalance()
      
      setTimeout(() => {
        setExecutionStep('idle')
        setExecutionStatus(null)
        setTxHashes({})
        setTransactionId(null)
      }, 5000)
    } catch (error: any) {
      console.error('Same chain swap deposit error:', error)
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
              swap_tx_hash: txHashes.swap || null,
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

      const signature = await signDepositIntent(intent, chainId, depositRouterAddress)

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

      const functionName = selectedVault.hasSettlement ? 'depositWithIntentRequest' : 'depositWithIntent'
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
      setExecutionStatus('Deposit successful!')
      setAmount('')
      setQuote(null)
      setUserNonce(userNonce + BigInt(1))
      refetchBalance()
      
      setTimeout(() => {
        setExecutionStep('idle')
        setExecutionStatus(null)
        setTxHashes({})
        setTransactionId(null)
      }, 5000)
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

  const formatShares = (shares: bigint, decimals: number): string => {
    // Shares are always in 18 decimals for ERC4626 vaults
    const sharesNum = parseFloat(formatUnits(shares, 18))
    if (sharesNum === 0) return '0'
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
                {VAULTS_CONFIG.map((vault) => (
                  <option key={vault.id} value={vault.id}>
                    {vault.name}
                  </option>
                ))}
              </select>

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
                  href={selectedVault.chain === 'ethereum' ? `https://etherscan.io/address/${selectedVault.address}` : `https://snowtrace.io/address/${selectedVault.address}`}
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
                      <span className="text-gray-500">Fee (0.1%)</span>
                      <span className="font-medium">{parseFloat(formatUnits(quote.feeAmount, selectedVault.asset.decimals)).toFixed(4)}</span>
                    </div>
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
                        <span className="text-gray-500">Gas Cost</span>
                        <span className="font-medium">
                          {quote.gasCosts > 0 ? `$${quote.gasCosts.toFixed(2)}` : 'Included in quote'}
                        </span>
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
                  </div>

                  {executing && (
                    <TransactionLoader 
                      step={executionStep} 
                      status={executionStatus}
                      txHashes={txHashes}
                    />
                  )}
                  {transactionId && (
                    <TransactionStatus 
                      transactionId={transactionId}
                      userAddress={address as Address}
                    />
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
                <li>3. Review the quote and confirm</li>
                <li>4. Tokens are swapped/bridged via LI.FI</li>
                <li>5. Deposited into the vault automatically</li>
              </ol>
            </div>
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

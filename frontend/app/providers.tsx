'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { RainbowKitProvider, getDefaultWallets, connectorsForWallets } from '@rainbow-me/rainbowkit'
import { avalanche, mainnet, base, optimism, arbitrum, bsc } from 'wagmi/chains'
import '@rainbow-me/rainbowkit/styles.css'
import { useState } from 'react'

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '0dd252f3816efa3917348bf2b60af0aa'

const avalancheRpcUrl = process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc'
const ethereumRpcUrl = process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL || 'https://lb.drpc.live/ethereum/AkHTcIVgl08-vYIBD0wQbORZOIOkCkER8Lcyjk6iId46'
const baseRpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org'
const optimismRpcUrl = process.env.NEXT_PUBLIC_OPTIMISM_RPC_URL || 'https://mainnet.optimism.io'
const arbitrumRpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc'
const bscRpcUrl = process.env.NEXT_PUBLIC_BSC_RPC_URL || 'https://bsc-dataseed1.binance.org'
const chains = [avalanche, mainnet, base, optimism, arbitrum, bsc] as const

const { wallets } = getDefaultWallets({
  appName: 'Yieldo',
  projectId,
})

const connectors = connectorsForWallets(wallets, {
  appName: 'Yieldo',
  projectId,
})

let wagmiConfigInstance: ReturnType<typeof createConfig> | null = null

function getWagmiConfig() {
  if (!wagmiConfigInstance) {
    wagmiConfigInstance = createConfig({
      chains,
      connectors,
      transports: {
        [avalanche.id]: http(avalancheRpcUrl),
        [mainnet.id]: http(ethereumRpcUrl),
        [base.id]: http(baseRpcUrl),
        [optimism.id]: http(optimismRpcUrl),
        [arbitrum.id]: http(arbitrumRpcUrl),
        [bsc.id]: http(bscRpcUrl),
      },
      ssr: true,
    })
  }
  return wagmiConfigInstance
}

export const wagmiConfig = getWagmiConfig()

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  }))

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}


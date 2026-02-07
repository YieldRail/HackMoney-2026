import { createPublicClient, http, Address } from 'viem'
import { normalize } from 'viem/ens'
import { mainnet } from 'viem/chains'

const ensClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL || 'https://ethereum-rpc.publicnode.com', {
    batch: {
      wait: 10,
      batchSize: 50,
    },
  }),
})

const ensCache = new Map<string, { name: string | null; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000

export async function batchResolveEnsNames(
  addresses: Address[]
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>()
  const addressesToResolve: Address[] = []

  const now = Date.now()
  addresses.forEach((address) => {
    const cached = ensCache.get(address.toLowerCase())
    if (cached && now - cached.timestamp < CACHE_TTL) {
      result.set(address.toLowerCase(), cached.name)
    } else {
      addressesToResolve.push(address)
    }
  })

  if (addressesToResolve.length === 0) {
    return result
  }

  const CHUNK_SIZE = 25
  const chunks: Address[][] = []
  for (let i = 0; i < addressesToResolve.length; i += CHUNK_SIZE) {
    chunks.push(addressesToResolve.slice(i, i + CHUNK_SIZE))
  }

  // Process chunks sequentially to avoid exceeding RPC batch limits
  for (const chunk of chunks) {
    try {
      const names = await Promise.all(
        chunk.map(address =>
          ensClient.getEnsName({ address }).catch(() => null)
        )
      )

      chunk.forEach((address, i) => {
        const name = names[i]
        const addressLower = address.toLowerCase()
        result.set(addressLower, name)
        ensCache.set(addressLower, { name, timestamp: now })
      })
    } catch (error) {
      console.error('Error batch resolving ENS names for chunk:', error)
      chunk.forEach(address => {
        result.set(address.toLowerCase(), null)
      })
    }
  }

  return result
}

export async function resolveEnsName(address: Address): Promise<string | null> {
  const addressLower = address.toLowerCase()
  const cached = ensCache.get(addressLower)
  const now = Date.now()

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.name
  }

  try {
    const name = await ensClient.getEnsName({ address })
    ensCache.set(addressLower, { name, timestamp: now })
    return name
  } catch (error) {
    console.error('Error resolving ENS name:', error)
    ensCache.set(addressLower, { name: null, timestamp: now })
    return null
  }
}

const ensAddressCache = new Map<string, { address: Address | null; timestamp: number }>()

export async function resolveEnsToAddress(name: string): Promise<Address | null> {
  const nameLower = name.toLowerCase()
  const cached = ensAddressCache.get(nameLower)
  const now = Date.now()

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.address
  }

  try {
    const address = await ensClient.getEnsAddress({ name: normalize(nameLower) })
    ensAddressCache.set(nameLower, { address: address as Address | null, timestamp: now })
    return address as Address | null
  } catch (error) {
    ensAddressCache.set(nameLower, { address: null, timestamp: now })
    return null
  }
}

export function clearEnsCache() {
  ensCache.clear()
  ensAddressCache.clear()
}


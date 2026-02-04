import { Address, WalletClient } from 'viem'
import { keccak256, encodePacked } from 'viem'

const DOMAIN_NAME = 'DepositRouter'
const DOMAIN_VERSION = '1'

const DEPOSIT_INTENT_TYPES = {
  DepositIntent: [
    { name: 'user', type: 'address' },
    { name: 'vault', type: 'address' },
    { name: 'asset', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

export interface DepositIntent {
  user: Address
  vault: Address
  asset: Address
  amount: bigint
  nonce: bigint
  deadline: bigint
}

export async function signDepositIntent(
  intent: DepositIntent,
  destinationChainId: number,
  contractAddress: Address,
  walletClient: WalletClient
): Promise<string> {
  if (!contractAddress) {
    throw new Error('Contract address is required')
  }

  if (!walletClient.account) {
    throw new Error('Wallet not connected')
  }

  const domain = {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: destinationChainId,
    verifyingContract: contractAddress,
  }

  const message = {
    user: intent.user,
    vault: intent.vault,
    asset: intent.asset,
    amount: intent.amount,
    nonce: intent.nonce,
    deadline: intent.deadline,
  }

  try {
    const signature = await walletClient.signTypedData({
      account: walletClient.account,
      domain,
      types: DEPOSIT_INTENT_TYPES,
      primaryType: 'DepositIntent',
      message,
    })
    return signature
  } catch (error: any) {
    if (error?.message?.includes('chainId') || error?.message?.includes('chain')) {
      throw new Error(
        `Chain mismatch: Please ensure your wallet is connected to chain ${destinationChainId} to sign the deposit intent. ` +
        `Current error: ${error.message}`
      )
    }
    throw error
  }
}

export async function getIntentHash(intent: DepositIntent, chainId: number): Promise<`0x${string}`> {
  const TYPEHASH = keccak256(
    new TextEncoder().encode(
      'DepositIntent(address user,address vault,address asset,uint256 amount,uint256 nonce,uint256 deadline)'
    )
  )
  
  const structHash = keccak256(
    encodePacked(
      ['bytes32', 'address', 'address', 'address', 'uint256', 'uint256', 'uint256'],
      [
        TYPEHASH,
        intent.user,
        intent.vault,
        intent.asset,
        intent.amount,
        intent.nonce,
        intent.deadline,
      ]
    )
  )
  
  return structHash
}


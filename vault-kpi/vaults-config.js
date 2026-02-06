import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config({ path: join(__dirname, '.env') });

export const VAULTS_CONFIG = [
  {
    id: 'turtle-avalanche-usdc',
    name: 'Turtle Avalanche USDC',
    address: process.env.LAGOON_VAULT_ADDRESS || '0x3048925b3ea5a8c12eecccb8810f5f7544db54af',
    chain: 'avalanche',
    chainId: 43114,
    asset: {
      address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
      symbol: 'USDC',
      decimals: 6,
    },
    rpcUrls: [
      process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
    ],
    safetyMargin: BigInt(process.env.AVALANCHE_SAFETY_MARGIN || '30'),
  },
  {
    id: '9summits-ethereum-usdc',
    name: '9Summits Flagship USDC',
    address: '0x03d1ec0d01b659b89a87eabb56e4af5cb6e14bfc',
    chain: 'ethereum',
    chainId: 1,
    asset: {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      decimals: 6,
    },
    rpcUrls: [
      ...(process.env.ETHEREUM_RPC_URL ? [process.env.ETHEREUM_RPC_URL] : []),
      'https://1rpc.io/eth',
      'https://rpc.ankr.com/eth',
      'https://eth-mainnet.public.blastapi.io',
      ...(process.env.ETHEREUM_RPC_URL ? [] : ['https://eth.llamarpc.com']),
    ],
    safetyMargin: BigInt(process.env.ETHEREUM_SAFETY_MARGIN || '10'),
  },
  {
    id: 'morpho-base-usdc-v2',
    name: 'Spark USDC Vault',
    address: '0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A',
    chain: 'base',
    chainId: 8453,
    asset: {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      symbol: 'USDC',
      decimals: 6,
    },
    rpcUrls: [
      process.env.BASE_RPC_URL || 'https://base.meowrpc.com',
    ],
    type: 'morpho-v2',
    safetyMargin: BigInt(process.env.BASE_SAFETY_MARGIN || '30'),
  },
  {
    id: 'morpho-ethereum-steakhouse-usdc',
    name: 'Steakhouse USDC',
    address: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB',
    chain: 'ethereum',
    chainId: 1,
    asset: {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      decimals: 6,
    },
    rpcUrls: [
      ...(process.env.ETHEREUM_RPC_URL ? [process.env.ETHEREUM_RPC_URL] : []),
      'https://1rpc.io/eth',
    ],
    type: 'morpho-v2',
    safetyMargin: BigInt(process.env.ETHEREUM_SAFETY_MARGIN || '10'),
  },
  {
    id: 'morpho-ethereum-usdc-v2',
    name: 'Gauntlet USDC Frontier',
    address: '0xc582F04d8a82795aa2Ff9c8bb4c1c889fe7b754e',
    chain: 'ethereum',
    chainId: 1,
    asset: {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      decimals: 6,
    },
    rpcUrls: [
      ...(process.env.ETHEREUM_RPC_URL ? [process.env.ETHEREUM_RPC_URL] : []),
      'https://1rpc.io/eth',
    ],
    type: 'morpho-v2',
    safetyMargin: BigInt(process.env.ETHEREUM_SAFETY_MARGIN || '10'),
  },
  {
    id: 'morpho-base-usdc-v2-2',
    name: 'Steakhouse Prime USDC',
    address: '0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2',
    chain: 'base',
    chainId: 8453,
    asset: {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      symbol: 'USDC',
      decimals: 6,
    },
    rpcUrls: [
      process.env.BASE_RPC_URL || 'https://base.meowrpc.com',
    ],
    type: 'morpho-v2',
    safetyMargin: BigInt(process.env.BASE_SAFETY_MARGIN || '30'),
  },
  {
    id: 'morpho-arbitrum-usdc',
    name: 'Hyperithm USDC',
    address: '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027',
    chain: 'arbitrum',
    chainId: 42161,
    asset: {
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      symbol: 'USDC',
      decimals: 6,
    },
    rpcUrls: [
      process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    ],
    type: 'morpho-v2',
    safetyMargin: BigInt(process.env.ARBITRUM_SAFETY_MARGIN || '10'),
  },
];

export function getVaultById(id) {
  return VAULTS_CONFIG.find(v => v.id === id);
}

export function getVaultByAddress(address, chain) {
  return VAULTS_CONFIG.find(v =>
    v.address.toLowerCase() === address.toLowerCase() && v.chain === chain
  );
}

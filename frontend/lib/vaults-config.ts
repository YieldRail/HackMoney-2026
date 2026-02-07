export type VaultType = 'lagoon' | 'morpho-v1' | 'morpho-v2'
export type ChainName = 'avalanche' | 'ethereum' | 'base' | 'optimism' | 'arbitrum' | 'bsc'

export interface VaultConfig {
  id: string;
  name: string;
  address: string;
  chain: ChainName;
  chainId: number;
  asset: {
    address: string;
    symbol: string;
    decimals: number;
  };
  depositRouter?: string;
  hasSettlement: boolean;
  type: VaultType;
  apy?: number;
  tvl?: string;
}

export const VAULTS_CONFIG: VaultConfig[] = [
  {
    id: 'turtle-avalanche-usdc',
    name: 'Turtle Avalanche USDC',
    address: process.env.NEXT_PUBLIC_AVALANCHE_VAULT_ADDRESS || '0x3048925b3ea5a8c12eecccb8810f5f7544db54af',
    chain: 'avalanche',
    chainId: 43114,
    asset: {
      address: process.env.NEXT_PUBLIC_AVALANCHE_USDC_ADDRESS || '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
      symbol: 'USDC',
      decimals: 6,
    },
    depositRouter: process.env.NEXT_PUBLIC_AVALANCHE_DEPOSIT_ROUTER_ADDRESS || '0x0f71f178E5fF53c0Dca2f02BE672750C1870C4DB',
    hasSettlement: false,
    type: 'lagoon',
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
    depositRouter: process.env.NEXT_PUBLIC_ETHEREUM_DEPOSIT_ROUTER_ADDRESS || '0xc4418Da01AD12130273d72aC7BC77aaEcf2Cc6C0',
    hasSettlement: true,
    type: 'lagoon',
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
    depositRouter: process.env.NEXT_PUBLIC_BASE_DEPOSIT_ROUTER_ADDRESS || '0xdE064d1D41e4d30B913b27f147E228fEe8fd31dc',
    hasSettlement: false,
    type: 'morpho-v2',
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
    depositRouter: process.env.NEXT_PUBLIC_ETHEREUM_DEPOSIT_ROUTER_ADDRESS || '0xc4418Da01AD12130273d72aC7BC77aaEcf2Cc6C0',
    hasSettlement: false,
    type: 'morpho-v2',
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
    depositRouter: process.env.NEXT_PUBLIC_ETHEREUM_DEPOSIT_ROUTER_ADDRESS || '0xc4418Da01AD12130273d72aC7BC77aaEcf2Cc6C0',
    hasSettlement: false,
    type: 'morpho-v2',
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
    depositRouter: process.env.NEXT_PUBLIC_BASE_DEPOSIT_ROUTER_ADDRESS || '0xdE064d1D41e4d30B913b27f147E228fEe8fd31dc',
    hasSettlement: false,
    type: 'morpho-v2',
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
    depositRouter: process.env.NEXT_PUBLIC_ARBITRUM_DEPOSIT_ROUTER_ADDRESS || '0xC75e95201bC574299a3C849181469B5B3B20cc97',
    hasSettlement: false,
    type: 'morpho-v2',
  },
];

export function getVaultById(id: string): VaultConfig | undefined {
  return VAULTS_CONFIG.find(v => v.id === id);
}

export function getVaultByAddress(address: string, chain: string): VaultConfig | undefined {
  return VAULTS_CONFIG.find(v => 
    v.address.toLowerCase() === address.toLowerCase() && v.chain === chain
  );
}

export function getVaultsByChain(chain: string): VaultConfig[] {
  return VAULTS_CONFIG.filter(v => v.chain === chain);
}


import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { ContractAddresses } from './types';
import { CAIP2_ARBITRUM_SEPOLIA, chainIdFromNetworkId, normalizeNetworkId } from './x402-utils';

// Load environment variables
config();

const RAW_NETWORK = process.env.NETWORK || 'eip155:42161';
const NORMALIZED_NETWORK = normalizeNetworkId(RAW_NETWORK);
const DEFAULT_RPC_URL =
  NORMALIZED_NETWORK === CAIP2_ARBITRUM_SEPOLIA
    ? 'https://sepolia-rollup.arbitrum.io/rpc'
    : 'https://arb1.arbitrum.io/rpc';

export const ENV = {
  NETWORK: RAW_NETWORK,
  ARBITRUM_SEPOLIA_RPC_URL: process.env.ARBITRUM_SEPOLIA_RPC_URL,
  ARBITRUM_RPC_URL: process.env.ARBITRUM_RPC_URL,
  RPC_URL: process.env.ARBITRUM_RPC_URL || process.env.ARBITRUM_SEPOLIA_RPC_URL || DEFAULT_RPC_URL,
  FACILITATOR_URL: process.env.FACILITATOR_URL || 'http://localhost:3002',
  MERCHANT_API_KEY: process.env.MERCHANT_API_KEY || '',
  PRIVATE_KEY: process.env.PRIVATE_KEY as `0x${string}`,
  QUOTE_SERVICE_PRIVATE_KEY: process.env.QUOTE_SERVICE_PRIVATE_KEY as `0x${string}`,
  QUOTE_SERVICE_SIGNER_ADDRESS: '', // Will be derived from private key
  USDC_ADDRESS: '0xAA448a5C4535d98E1CCB41e3E30ce2aC4a9381e8',
  USDC_DECIMALS: parseInt(process.env.USDC_DECIMALS || '6'),
  MOCK_RATE_NUMERATOR: parseInt(process.env.MOCK_RATE_NUMERATOR || '995000'),
  MOCK_RATE_DENOMINATOR: parseInt(process.env.MOCK_RATE_DENOMINATOR || '1000000'),
  ENABLE_SETTLEMENT: process.env.ENABLE_SETTLEMENT === 'true',
  GAS_PRICE_MULTIPLIER: parseFloat(process.env.GAS_PRICE_MULTIPLIER || '1.2'),
  MAX_GAS_PRICE_GWEI: parseInt(process.env.MAX_GAS_PRICE_GWEI || '100'),
};

export const NETWORK_CHAIN_ID = chainIdFromNetworkId(ENV.NETWORK);

// Load deployed contract addresses
export function loadContractAddresses(): ContractAddresses {
  try {
    const addressesFile =
      NORMALIZED_NETWORK === CAIP2_ARBITRUM_SEPOLIA
        ? 'out/addresses.sepolia.json'
        : 'out/addresses.arbitrum.json';
    const addressesJson = readFileSync(addressesFile, 'utf8');
    return JSON.parse(addressesJson) as ContractAddresses;
  } catch (error) {
    throw new Error(
      'Could not load contract addresses. Make sure to run "pnpm deploy" first.'
    );
  }
}

// Token configurations
export const TOKENS = {
  USDC: {
    symbol: 'USDC',
    decimals: 6,
  },
  WETH: {
    symbol: 'WETH', 
    decimals: 18,
  },
} as const;

// Quote service configuration
export const QUOTE_SERVICE = {
  BASE_URL: 'http://localhost:3001',
  ENDPOINTS: {
    QUOTE: '/quote',
  },
} as const;

// Validate required environment variables
export function validateEnvironment(): void {
  const required = [
    'PRIVATE_KEY',
    'QUOTE_SERVICE_PRIVATE_KEY',
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  if (!ENV.RPC_URL) {
    throw new Error('Missing required RPC URL configuration');
  }

  if (!NETWORK_CHAIN_ID) {
    throw new Error(`Unsupported NETWORK for chain ID resolution: ${ENV.NETWORK}`);
  }

  // Validate private key format
  if (!ENV.PRIVATE_KEY.startsWith('0x') || ENV.PRIVATE_KEY.length !== 66) {
    throw new Error('PRIVATE_KEY must be a 32-byte hex string starting with 0x');
  }

  if (!ENV.QUOTE_SERVICE_PRIVATE_KEY.startsWith('0x') || ENV.QUOTE_SERVICE_PRIVATE_KEY.length !== 66) {
    throw new Error('QUOTE_SERVICE_PRIVATE_KEY must be a 32-byte hex string starting with 0x');
  }
}

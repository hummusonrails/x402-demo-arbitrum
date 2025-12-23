import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { ContractAddresses } from './types';

// Load environment variables
config();

export const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

export const ENV = {
  NETWORK: process.env.NETWORK || 'eip155:421614',
  ARBITRUM_SEPOLIA_RPC_URL: process.env.ARBITRUM_SEPOLIA_RPC_URL!,
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

// Load deployed contract addresses
export function loadContractAddresses(): ContractAddresses {
  try {
    const addressesJson = readFileSync('out/addresses.sepolia.json', 'utf8');
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
    'ARBITRUM_SEPOLIA_RPC_URL',
    'PRIVATE_KEY',
    'QUOTE_SERVICE_PRIVATE_KEY',
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  // Validate private key format
  if (!ENV.PRIVATE_KEY.startsWith('0x') || ENV.PRIVATE_KEY.length !== 66) {
    throw new Error('PRIVATE_KEY must be a 32-byte hex string starting with 0x');
  }

  if (!ENV.QUOTE_SERVICE_PRIVATE_KEY.startsWith('0x') || ENV.QUOTE_SERVICE_PRIVATE_KEY.length !== 66) {
    throw new Error('QUOTE_SERVICE_PRIVATE_KEY must be a 32-byte hex string starting with 0x');
  }
}

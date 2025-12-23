import { config } from 'dotenv';

config();

export const ARBITRUM_ONE_CHAIN_ID = 42161;
export const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

export const CONFIG = {
  // Network Configuration
  NETWORK: process.env.NETWORK || 'eip155:421614', // CAIP-2 network ID
  ARBITRUM_RPC_URL: process.env.ARBITRUM_RPC_URL || process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
  MERCHANT_PRIVATE_KEY: process.env.MERCHANT_PRIVATE_KEY as `0x${string}`,
  
  // x402 Services
  QUOTE_SERVICE_URL: process.env.QUOTE_SERVICE_URL || 'http://localhost:3001',
  FACILITATOR_URL: process.env.FACILITATOR_URL || 'http://localhost:3002',
  MERCHANT_API_KEY: process.env.MERCHANT_API_KEY || '',
  
  // Tokens
  USDC_ADDRESS: process.env.USDC_ADDRESS as `0x${string}`,
  
  // Ollama
  OLLAMA_URL: process.env.OLLAMA_URL || 'http://localhost:11434',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'llama3.1:8b',
  
  // Metering
  PRICE_PER_MESSAGE_MICRO_USDC: parseInt(process.env.PRICE_PER_MESSAGE_MICRO_USDC || '20000'), // 0.02 USDC per message (0.10 USDC per 5 messages)
  DAILY_CAP_MICRO_USDC: parseInt(process.env.DAILY_CAP_MICRO_USDC || '2000000'), // 2 USDC daily cap
  BATCH_THRESHOLD_MESSAGES: parseInt(process.env.BATCH_THRESHOLD_MESSAGES || '5'),
  BATCH_TIMEOUT_SECONDS: parseInt(process.env.BATCH_TIMEOUT_SECONDS || '3600'),
  
  // Server
  PORT: parseInt(process.env.PORT || '3003'),
  NODE_ENV: process.env.NODE_ENV || 'development',
} as const;

export const EXPLORER_BASE_URL = 'https://arbiscan.io';

export function validateConfig(): void {
  const required = [
    'MERCHANT_PRIVATE_KEY',
    'USDC_ADDRESS',
    'MERCHANT_API_KEY',
    'FACILITATOR_ADDRESS',
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  // Validate private key format
  if (!CONFIG.MERCHANT_PRIVATE_KEY.startsWith('0x') || CONFIG.MERCHANT_PRIVATE_KEY.length !== 66) {
    throw new Error('MERCHANT_PRIVATE_KEY must be a 32-byte hex string starting with 0x');
  }

  // Validate address format
  if (!CONFIG.USDC_ADDRESS.startsWith('0x') || CONFIG.USDC_ADDRESS.length !== 42) {
    throw new Error('USDC_ADDRESS must be a valid Ethereum address');
  }
}

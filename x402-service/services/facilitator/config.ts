import { config as loadEnv } from 'dotenv';
import { arbitrum, arbitrumSepolia } from 'viem/chains';
import type { Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  Network,
  LEGACY_NETWORK_ARBITRUM,
  LEGACY_NETWORK_ARBITRUM_SEPOLIA,
  resolveNetwork,
  normalizeNetworkId,
  toLegacyNetworkId,
} from '../../app/x402-utils';

loadEnv();

export const CHAIN_ID_ARBITRUM = 42161;
export const CHAIN_ID_ARBITRUM_SEPOLIA = 421614;

export const USDC_ADDRESS_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
export const USDC_ADDRESS_ARBITRUM_SEPOLIA = process.env.USDC_ADDRESS || '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';

export const USDC_NAME = 'USD Coin';
export const USDC_VERSION = '2';

interface NetworkConfig {
  network: Network;
  legacyNetwork: string;
  chainId: number;
  chain: Chain;
  rpcUrl: string;
  usdcAddress: string;
}

const envNetwork = process.env.NETWORK || LEGACY_NETWORK_ARBITRUM;
const activeNetwork = resolveNetwork(envNetwork);

const networkConfigs: Record<Network, NetworkConfig> = {
  [Network.ARBITRUM]: {
    network: Network.ARBITRUM,
    legacyNetwork: LEGACY_NETWORK_ARBITRUM,
    chainId: CHAIN_ID_ARBITRUM,
    chain: arbitrum,
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    usdcAddress: USDC_ADDRESS_ARBITRUM,
  },
  [Network.ARBITRUM_SEPOLIA]: {
    network: Network.ARBITRUM_SEPOLIA,
    legacyNetwork: LEGACY_NETWORK_ARBITRUM_SEPOLIA,
    chainId: CHAIN_ID_ARBITRUM_SEPOLIA,
    chain: arbitrumSepolia,
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
    usdcAddress: USDC_ADDRESS_ARBITRUM_SEPOLIA,
  },
};

export const config = networkConfigs[activeNetwork];
export const allNetworkConfigs = networkConfigs;

export { normalizeNetworkId, toLegacyNetworkId };

let privateKey = process.env.EVM_PRIVATE_KEY || process.env.FACILITATOR_PRIVATE_KEY || process.env.QUOTE_SERVICE_PRIVATE_KEY || process.env.PRIVATE_KEY || '';

if (!privateKey) {
  throw new Error('Missing FACILITATOR_PRIVATE_KEY or EVM_PRIVATE_KEY environment variable');
}

if (!privateKey.startsWith('0x')) {
  privateKey = `0x${privateKey}`;
}

if (privateKey.length !== 66) {
  throw new Error(`Invalid FACILITATOR_PRIVATE_KEY format: expected 66 characters (0x + 64 hex), got ${privateKey.length}`);
}

const hexPattern = /^0x[0-9a-fA-F]{64}$/;
if (!hexPattern.test(privateKey)) {
  throw new Error('Invalid FACILITATOR_PRIVATE_KEY format: must contain only hexadecimal characters (0-9, a-f, A-F)');
}

export const FACILITATOR_PRIVATE_KEY = privateKey as `0x${string}`;

const facilitatorAccount = privateKeyToAccount(FACILITATOR_PRIVATE_KEY);
export const FACILITATOR_ADDRESS = facilitatorAccount.address as `0x${string}`;

export const PORT = parseInt(process.env.PORT || '3002', 10);
export const BODY_SIZE_LIMIT = '100kb';
export const MAX_SETTLEMENT_AMOUNT = BigInt(process.env.MAX_SETTLEMENT_AMOUNT || '1000000000');
export const SERVICE_FEE_BPS = parseInt(process.env.SERVICE_FEE_BPS || '50', 10);
export const GAS_FEE_USDC = BigInt(process.env.GAS_FEE_USDC || '100000');
export const MERCHANT_API_KEY = process.env.MERCHANT_API_KEY || '';

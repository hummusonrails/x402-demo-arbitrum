import { hashTypedData, recoverAddress, type Address } from 'viem';
import { CONFIG } from './config.js';
import { chainIdFromNetworkId } from './x402-utils.js';
import type { IntentMandate } from './types.js';

/**
 * EIP-712 utilities for AP2 mandate signing and EIP-3009 payment authorization
 */

const mandateChainId = chainIdFromNetworkId(CONFIG.NETWORK);
if (!mandateChainId) {
  throw new Error(`Unsupported NETWORK for mandate signing: ${CONFIG.NETWORK}`);
}

export const INTENT_MANDATE_DOMAIN = {
  name: 'AP2-IntentMandate',
  version: '1',
  chainId: mandateChainId,
} as const;

export const INTENT_MANDATE_TYPES = {
  IntentMandate: [
    { name: 'mandateId', type: 'string' },
    { name: 'userAddress', type: 'address' },
    { name: 'merchantAddress', type: 'address' },
    { name: 'dailyCapMicroUsdc', type: 'uint256' },
    { name: 'pricePerMessageMicroUsdc', type: 'uint256' },
    { name: 'batchThreshold', type: 'uint256' },
    { name: 'serviceType', type: 'string' },
    { name: 'modelName', type: 'string' },
    { name: 'expiresAt', type: 'uint256' },
  ],
} as const;

/**
 * Get the mandate message for EIP-712 signing
 */
export function getMandateMessage(mandate: IntentMandate, merchantAddress: Address) {
  return {
    mandateId: mandate.mandateId,
    userAddress: mandate.userAddress as Address,
    merchantAddress: merchantAddress,
    dailyCapMicroUsdc: BigInt(mandate.dailyCapMicroUsdc),
    pricePerMessageMicroUsdc: BigInt(mandate.pricePerMessageMicroUsdc),
    batchThreshold: BigInt(mandate.batchThreshold),
    serviceType: mandate.serviceType,
    modelName: mandate.modelName,
    expiresAt: BigInt(mandate.expiresAt),
  };
}

/**
 * Verify an Intent Mandate signature
 */
export async function verifyMandateSignature(
  mandate: IntentMandate,
  signature: `0x${string}`,
  verifyingContract: Address
): Promise<boolean> {
  try {
    // Get merchant address from mandate for message verification
    const message = getMandateMessage(mandate, mandate.merchantAddress as Address);
    
    const digest = hashTypedData({
      domain: {
        ...INTENT_MANDATE_DOMAIN,
        verifyingContract,
      },
      types: INTENT_MANDATE_TYPES,
      primaryType: 'IntentMandate',
      message,
    });

    // Recover signer
    const recoveredAddress = await recoverAddress({
      hash: digest,
      signature,
    });

    return recoveredAddress.toLowerCase() === mandate.userAddress.toLowerCase();
  } catch (error) {
    console.error('Failed to verify mandate signature:', error);
    return false;
  }
}

/**
 * EIP-3009 types for TransferWithAuthorization
 */
const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/**
 * Verify an EIP-3009 signature and recover the signer address
 */
export async function verifyEIP3009Signature(
  from: Address,
  to: Address,
  value: string,
  validAfter: number,
  validBefore: number,
  nonce: `0x${string}`,
  signature: { v: number; r: `0x${string}`; s: `0x${string}` },
  tokenAddress: Address,
  tokenName: string,
  tokenVersion: string,
  chainId: number
): Promise<Address | null> {
  try {
    // Validate signature format
    if (signature.v !== 27 && signature.v !== 28) {
      console.error('Invalid signature v value:', signature.v);
      return null;
    }

    const message = {
      from,
      to,
      value: BigInt(value),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce,
    };

    // Use viem's hashTypedData for EIP-3009
    const digest = hashTypedData({
      domain: {
        name: tokenName,
        version: tokenVersion,
        chainId,
        verifyingContract: tokenAddress,
      },
      types: EIP3009_TYPES,
      primaryType: 'TransferWithAuthorization',
      message,
    });

    // Recover signer address
    const fullSignature = `${signature.r}${signature.s.slice(2)}${signature.v.toString(16).padStart(2, '0')}` as `0x${string}`;
    
    const recoveredAddress = await recoverAddress({
      hash: digest,
      signature: fullSignature,
    });

    return recoveredAddress;
  } catch (error) {
    console.error('Failed to verify EIP-3009 signature:', error);
    return null;
  }
}

/**
 * Generate a random nonce for EIP-3009
 */
export function generateNonce(): `0x${string}` {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return `0x${Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as `0x${string}`;
}

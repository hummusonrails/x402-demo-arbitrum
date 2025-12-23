import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, toHex, type Address } from 'viem';
import { CONFIG } from './config.js';
import { generateNonce } from './signature-utils.js';
import { chainIdFromNetworkId } from './x402-utils.js';

/**
 * Delegated Signing Service
 * 
 * After user signs the Intent Mandate, this service can generate
 * EIP-3009 payment authorizations on behalf of the user for batch settlements.
 * 
 * For this demo, we simulate delegated signing by having the merchant
 * sign on behalf of the user after receiving mandate authorization.
 */

export class DelegatedSigner {
  private merchantAccount;

  constructor() {
    this.merchantAccount = privateKeyToAccount(CONFIG.MERCHANT_PRIVATE_KEY);
  }

  /**
   * Generate an EIP-3009 payment authorization for a batch settlement
   * 
   * For this demo:
   * - We use the merchant key to sign (simulating delegation)
   * - The Intent Mandate signature proves user authorization
   * - This demonstrates flow without too much complexity
   */
  async generatePaymentAuthorization(params: {
    from: Address; // User address (payer)
    to: Address; // Merchant address (payee)
    value: string; // Amount in token base units
    batchId: string; // Batch identifier for nonce
    tokenAddress: Address;
    tokenName: string;
    tokenVersion: string;
  }): Promise<{
    from: Address;
    to: Address;
    value: string;
    validAfter: number;
    validBefore: number;
    nonce: `0x${string}`;
    v: number;
    r: `0x${string}`;
    s: `0x${string}`;
  }> {
    const now = Math.floor(Date.now() / 1000);
    
    // Create a deterministic nonce from batchId
    const nonce = keccak256(toHex(params.batchId));

    // Create authorization
    const authorization = {
      from: params.from,
      to: params.to,
      value: params.value,
      validAfter: now - 60, // Valid from 1 minute ago
      validBefore: now + 300, // Valid for 5 minutes
      nonce,
    };

    // Sign with merchant account (simulating delegated signing)
    const signature = await this.merchantAccount.signTypedData({
      domain: {
        name: params.tokenName,
        version: params.tokenVersion,
        chainId: (() => {
          const chainId = chainIdFromNetworkId(CONFIG.NETWORK);
          if (!chainId) {
            throw new Error(`Unsupported network for signing: ${CONFIG.NETWORK}`);
          }
          return chainId;
        })(),
        verifyingContract: params.tokenAddress,
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: authorization.from,
        to: authorization.to,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
    });

    // Parse signature into v, r, s
    const r = signature.slice(0, 66) as `0x${string}`;
    const s = `0x${signature.slice(66, 130)}` as `0x${string}`;
    const v = parseInt(signature.slice(130, 132), 16);

    return {
      ...authorization,
      v,
      r,
      s,
    };
  }

  /**
   * Get the merchant address
   */
  getMerchantAddress(): Address {
    return this.merchantAccount.address;
  }
}

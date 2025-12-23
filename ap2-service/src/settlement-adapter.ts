import { createWalletClient, http, createPublicClient, parseUnits, keccak256, toHex, hexToBigInt, hexToNumber } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum, arbitrumSepolia } from 'viem/chains';
import { CONFIG, ARBITRUM_ONE_CHAIN_ID } from './config.js';
import { X402SettlementResult } from './types.js';
import { DelegatedSigner } from './delegated-signer.js';
import { CAIP2_ARBITRUM_ONE, CAIP2_ARBITRUM_SEPOLIA, chainIdFromNetworkId, normalizeNetworkId, toLegacyNetworkId } from './x402-utils.js';

/**
 * SettlementAdapter integrates with x402 quote-service and facilitator
 */
export class SettlementAdapter {
  private account;
  private walletClient;
  private publicClient;
  private delegatedSigner;

  constructor() {
    // Validate required environment variables
    if (!CONFIG.MERCHANT_PRIVATE_KEY) {
      throw new Error('MISSING_ENV: MERCHANT_PRIVATE_KEY is required. Set it in your .env file.');
    }
    
    if (!CONFIG.USDC_ADDRESS) {
      throw new Error('MISSING_ENV: USDC_ADDRESS is required. Set it in your .env file.');
    }
    
    this.account = privateKeyToAccount(CONFIG.MERCHANT_PRIVATE_KEY);
    const normalizedNetwork = normalizeNetworkId(CONFIG.NETWORK);
    const chain = normalizedNetwork === CAIP2_ARBITRUM_SEPOLIA ? arbitrumSepolia : arbitrum;

    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(CONFIG.ARBITRUM_RPC_URL),
    });

    this.publicClient = createPublicClient({
      chain,
      transport: http(CONFIG.ARBITRUM_RPC_URL),
    });

    this.delegatedSigner = new DelegatedSigner();
  }

  /**
   * Get payment requirements from facilitator
   */
  async getRequirements(params: {
    amountMicroUsdc: number;
    merchantAddress: string;
  }): Promise<any | undefined> {
    try {
      const response = await fetch(`${CONFIG.FACILITATOR_URL}/requirements`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: params.amountMicroUsdc.toString(),
          memo: 'AI inference batch payment',
          extra: {
            merchantAddress: params.merchantAddress,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to get requirements: ${response.status}`);
      }

      const header = response.headers.get('payment-response') || response.headers.get('x-payment-response');
      if (header) {
        try {
          return JSON.parse(header);
        } catch (error) {
          console.error('[Settlement] Failed to parse requirements header from response.headers:', {
            header,
            error: error instanceof Error ? error.message : String(error),
          });
          return undefined;
        }
      }

      return await response.json();
    } catch (error) {
      console.error('[Settlement] Failed to get requirements:', error);
      throw error;
    }
  }

  private getRequirementFields(requirements: any) {
    const version = Number(requirements?.x402Version ?? requirements?.version ?? requirements?.extra?.x402Version ?? (requirements?.accepts ? 2 : 1));
    if (version === 2 && requirements?.accepts?.length) {
      const accept = requirements.accepts[0];
      const extra = accept.extra || {};
      return {
        x402Version: 2,
        network: accept.network,
        token: accept.asset,
        recipient: accept.payTo,
        amount: accept.maxAmountRequired,
        nonce: extra.nonce ?? requirements.nonce,
        deadline: extra.deadline ?? requirements.deadline,
        memo: requirements.memo ?? accept.description,
        extra: { ...requirements.extra, ...extra },
      };
    }

    return {
      x402Version: 1,
      network: requirements.network,
      token: requirements.token,
      recipient: requirements.recipient,
      amount: requirements.amount,
      nonce: requirements.nonce,
      deadline: requirements.deadline,
      memo: requirements.memo ?? requirements.description,
      extra: requirements.extra,
    };
  }

  /**
   * Generate unsigned settlement authorization for user to sign
   * Now uses facilitator's /requirements endpoint for proper fee calculation
   */
  async generateSettlementAuthorization(params: {
    from: string;
    amountMicroUsdc: number;
    batchId: string;
  }) {
    // Get requirements from facilitator (includes proper fee calculations)
    const requirements = await this.getRequirements({
      amountMicroUsdc: params.amountMicroUsdc,
      merchantAddress: this.account.address,
    });

    if (!requirements) {
      throw new Error('Failed to parse payment requirements from facilitator response');
    }

    const requirementFields = this.getRequirementFields(requirements);
    const networkId = normalizeNetworkId(requirementFields.network || CONFIG.NETWORK);
    const networkChainId = chainIdFromNetworkId(networkId) || ARBITRUM_ONE_CHAIN_ID;
    const tokenName = requirementFields.extra?.name ?? 'USD Coin';
    const tokenVersion = requirementFields.extra?.version ?? '2';

    // Use facilitator's calculated total amount which includes merchant amount + fees
    const totalAmount = requirementFields.amount;
    
    return {
      batchId: params.batchId,
      from: params.from,
      to: requirementFields.recipient, // Use facilitator's recipient address
      value: totalAmount,
      validAfter: 0,
      validBefore: requirementFields.deadline,
      nonce: requirementFields.nonce, // Use facilitator's nonce
      domain: {
        name: tokenName,
        version: tokenVersion,
        chainId: networkChainId,
        verifyingContract: CONFIG.USDC_ADDRESS,
      },
      requirements, // Include full requirements for reference
      network: networkId,
    };
  }

  /**
   * Execute settlement with user-provided authorization (avoids regenerating nonce)
   */
  async settlePaymentWithAuth(params: {
    authorization: {
      batchId: string;
      from: string;
      to: string;
      value: string;
      validAfter: number;
      validBefore: number;
      nonce: string;
      requirements?: any;
    };
    signature: `0x${string}`;
  }): Promise<X402SettlementResult> {
    try {
      const { authorization: authData, signature } = params;
      const requirements = authData.requirements;
      if (!requirements) {
        throw new Error('Missing payment requirements on authorization payload');
      }

      const requirementFields = this.getRequirementFields(requirements);
      
      console.log(`[Settlement] Starting settlement for batch ${authData.batchId}`);
      console.log(`[Settlement] Using authorization that user signed`);
      console.log(`[Settlement] From: ${authData.from}`);
      console.log(`[Settlement] To: ${authData.to}`);
      console.log(`[Settlement] Value: ${authData.value}`);

      // Build SDK-style request format that facilitator expects
      if (signature.length !== 132) {
        throw new Error(`Invalid signature length: expected 132 hex chars, got ${signature.length}`);
      }

      const paymentPayload = {
        x402Version: requirementFields.x402Version || 2,
        scheme: 'exact',
        network: normalizeNetworkId(requirementFields.network || CONFIG.NETWORK),
        payload: {
          from: authData.from,
          to: authData.to,
          value: authData.value,
          validAfter: authData.validAfter,
          validBefore: authData.validBefore,
          nonce: authData.nonce,
          v: hexToNumber(`0x${signature.slice(130, 132)}` as `0x${string}`),
          r: signature.slice(0, 66) as `0x${string}`,
          s: `0x${signature.slice(66, 130)}` as `0x${string}`,
        },
      };

      const settlementRequest = {
        paymentPayload,
        paymentRequirements: requirements,
      };

      console.log(`[Settlement] Calling facilitator at ${CONFIG.FACILITATOR_URL}/settle`);
      console.log(`[Settlement] SDK request format:`, JSON.stringify(settlementRequest, null, 2));

      const response = await fetch(`${CONFIG.FACILITATOR_URL}/settle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': CONFIG.MERCHANT_API_KEY,
        },
        body: JSON.stringify(settlementRequest),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Facilitator returned ${response.status}: ${errorText}`);
      }

      const result = await response.json() as {
        success?: boolean;
        transactionHash?: string;
        outgoingTransactionHash?: string;
        blockNumber?: number;
        error?: string;
        feeBreakdown?: {
          merchantAmount: string;
          serviceFee: string;
          gasFee: string;
          totalAmount: string;
        };
      };

      console.log(`[Settlement] Facilitator response:`, result);

      if (result.success && (result.transactionHash || result.outgoingTransactionHash)) {
        const txHash = result.transactionHash || result.outgoingTransactionHash!;
        console.log(`[Settlement] Waiting for transaction confirmation: ${txHash}`);
        
        const receipt = await this.publicClient.waitForTransactionReceipt({
          hash: txHash as `0x${string}`,
          confirmations: 1,
        });

        console.log(`[Settlement] Transaction confirmed in block ${receipt.blockNumber}`);
        
        if (result.feeBreakdown) {
          console.log(`[Settlement] Fee breakdown:`, result.feeBreakdown);
        }

        return {
          success: true,
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
        };
      } else {
        throw new Error(result.error || 'Settlement failed without error message');
      }
    } catch (error) {
      console.error(`[Settlement] Error:`, error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown settlement error',
      };
    }
  }

  /**
   * Execute settlement via x402 facilitator with user signature (legacy method)
   */
  async settlePayment(params: {
    from: string; // User address
    amountMicroUsdc: number;
    batchId: string;
    signature: `0x${string}`; // User's signature
  }): Promise<X402SettlementResult> {
    try {
      console.log(`[Settlement] Starting settlement for batch ${params.batchId}`);
      console.log(`[Settlement] Merchant Amount: ${params.amountMicroUsdc} micro-USDC (${params.amountMicroUsdc / 1_000_000} USDC)`);
      console.log(`[Settlement] From: ${params.from}`);
      console.log(`[Settlement] Merchant: ${this.account.address}`);

      if (!params.signature) {
        throw new Error('User signature is required for settlement');
      }

      // Generate authorization data
      const authData = await this.generateSettlementAuthorization({
        from: params.from,
        amountMicroUsdc: params.amountMicroUsdc,
        batchId: params.batchId,
      });

      console.log(`[Settlement] Facilitator: ${authData.to}`);

      // Parse signature manually (standard 65-byte signature format)
      const signature = params.signature;
      if (signature.length !== 132) {
        throw new Error(`Invalid signature length: expected 132 hex chars, got ${signature.length}`);
      }
      const r = signature.slice(0, 66) as `0x${string}`; // 0x + 64 chars
      const s = `0x${signature.slice(66, 130)}` as `0x${string}`; // 64 chars
      const v = hexToNumber(`0x${signature.slice(130, 132)}` as `0x${string}`); // 2 chars

      const authorization = {
        from: authData.from as `0x${string}`,
        to: authData.to as `0x${string}`,
        value: authData.value,
        validAfter: authData.validAfter,
        validBefore: authData.validBefore,
        nonce: authData.nonce as `0x${string}`,
        v,
        r,
        s,
      };

      console.log(`[Settlement] Using user-signed authorization with nonce: ${authorization.nonce}`);
      console.log(`[Settlement] Authorization details:`, JSON.stringify({
        from: authorization.from,
        to: authorization.to,
        value: authorization.value,
        validAfter: authorization.validAfter,
        validBefore: authorization.validBefore,
        v: authorization.v,
      }, null, 2));

      const paymentPayload = {
        scheme: 'exact' as const,
        network: normalizeNetworkId(CONFIG.NETWORK || CAIP2_ARBITRUM_ONE),
        payload: authorization,
      };

      const paymentRequirements = {
        scheme: 'exact',
        network: toLegacyNetworkId(normalizeNetworkId(CONFIG.NETWORK)),
        token: CONFIG.USDC_ADDRESS,
        amount: authData.value, // Total includes merchant amount + facilitator fees
        recipient: authData.to, // Facilitator's wallet address from requirements endpoint
        merchantAddress: this.account.address, // Merchant address to receive funds (after facilitator deducts fees)
        description: `AI inference batch payment: ${params.batchId}`,
        maxTimeoutSeconds: 300,
      };

      const settlementRequest = {
        paymentPayload,
        paymentRequirements,
      };

      console.log(`[Settlement] Calling facilitator at ${CONFIG.FACILITATOR_URL}/settle`);
      console.log(`[Settlement] Using EIP-3009 transferWithAuthorization`);
      console.log(`[Settlement] Payment authorized via delegated signing`);

      // Call external x402 facilitator to execute settlement
      const response = await fetch(`${CONFIG.FACILITATOR_URL}/settle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': CONFIG.MERCHANT_API_KEY, // External facilitator requires API key
        },
        body: JSON.stringify(settlementRequest),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Facilitator returned ${response.status}: ${errorText}`);
      }

      const result = await response.json() as {
        success?: boolean;
        transactionHash?: string;
        error?: string;
      };

      console.log(`[Settlement] Facilitator response:`, result);

      if (result.success && result.transactionHash) {
        // Wait for transaction confirmation
        console.log(`[Settlement] Waiting for transaction confirmation: ${result.transactionHash}`);
        
        const receipt = await this.publicClient.waitForTransactionReceipt({
          hash: result.transactionHash as `0x${string}`,
          confirmations: 1,
        });

        console.log(`[Settlement] Transaction confirmed in block ${receipt.blockNumber}`);
        console.log(`[Settlement] EIP-3009 gasless payment successful`);

        return {
          success: true,
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
        };
      } else {
        throw new Error(result.error || 'Settlement failed without error message');
      }
    } catch (error) {
      console.error(`[Settlement] Error:`, error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown settlement error',
      };
    }
  }

  /**
   * Get the merchant address
   */
  getMerchantAddress(): string {
    return this.account.address;
  }

  /**
   * Check if facilitator is available
   */
  async checkFacilitatorHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${CONFIG.FACILITATOR_URL}/supported`);
      if (!response.ok) return false;
      
      const data = await response.json() as {
        kinds?: Array<{ network: string; scheme: string }>;
        versions?: Record<string, { kinds: Array<{ network: string; scheme: string }> }>;
      };

      const v2Kinds = data.versions?.["2"]?.kinds || [];
      if (v2Kinds.some((k) => normalizeNetworkId(k.network) === CAIP2_ARBITRUM_ONE && k.scheme === 'exact')) {
        return true;
      }

      return data.kinds?.some((k) =>
        normalizeNetworkId(k.network) === CAIP2_ARBITRUM_ONE && k.scheme === 'exact'
      ) || false;
    } catch (error) {
      console.error('[Settlement] Facilitator health check failed:', error);
      return false;
    }
  }

  /**
   * Check if quote service is available
   */
  async checkQuoteServiceHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${CONFIG.QUOTE_SERVICE_URL}/health`);
      return response.ok;
    } catch (error) {
      console.error('[Settlement] Quote service health check failed:', error);
      return false;
    }
  }
}

import { randomBytes } from 'crypto';
import { IntentMandate, IntentMandateSchema } from './types.js';
import { CONFIG } from './config.js';
import { chainIdFromNetworkId, normalizeNetworkId } from './x402-utils.js';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyMandateSignature, getMandateMessage, INTENT_MANDATE_DOMAIN, INTENT_MANDATE_TYPES } from './signature-utils.js';
import type { Address } from 'viem';

/**
 * MandateManager handles creation and storage of Intent Mandates
 * Based on AP2 specification for "human not present" AI inference scenarios
 */
export class MandateManager {
  private mandates: Map<string, IntentMandate> = new Map();
  private userMandates: Map<string, string[]> = new Map(); // userAddress -> mandateIds
  private merchantAddress: string;

  constructor() {
    // Derive merchant address from private key
    const account = privateKeyToAccount(CONFIG.MERCHANT_PRIVATE_KEY);
    this.merchantAddress = account.address;
  }

  /**
   * Create an unsigned Intent Mandate for a user
   * User must sign this mandate before it becomes valid
   */
  createUnsignedMandate(params: {
    userAddress: string;
    dailyCapMicroUsdc?: number;
    sessionId: string;
    userAgent?: string;
    ipAddress?: string;
  }): Omit<IntentMandate, 'userSignature'> {
    const mandateId = this.generateMandateId();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 86400; // 24 hours TTL

    const unsignedMandate = {
      mandateId,
      createdAt: now,
      expiresAt,
      
      userAddress: params.userAddress.toLowerCase(),
      merchantAddress: this.merchantAddress.toLowerCase(),
      
      paymentMethods: [{
        token: CONFIG.USDC_ADDRESS,
        network: normalizeNetworkId(CONFIG.NETWORK),
        chainId: chainIdFromNetworkId(CONFIG.NETWORK) || 42161,
      }],
      
      dailyCapMicroUsdc: params.dailyCapMicroUsdc || CONFIG.DAILY_CAP_MICRO_USDC,
      pricePerMessageMicroUsdc: CONFIG.PRICE_PER_MESSAGE_MICRO_USDC,
      batchThreshold: CONFIG.BATCH_THRESHOLD_MESSAGES,
      
      serviceType: 'ai-inference' as const,
      modelName: CONFIG.OLLAMA_MODEL,
      
      riskPayload: {
        sessionId: params.sessionId,
        userAgent: params.userAgent,
        ipAddress: params.ipAddress,
      },
    };

    return unsignedMandate;
  }

  /**
   * Submit a signed mandate
   * Verifies the signature before storing
   */
  async submitSignedMandate(
    unsignedMandate: Omit<IntentMandate, 'userSignature'>,
    signature: `0x${string}`
  ): Promise<IntentMandate> {
    const mandate: IntentMandate = {
      ...unsignedMandate,
      userSignature: signature,
    };

    // Validate mandate structure
    IntentMandateSchema.parse(mandate);

    // Verify signature
    const isValid = await verifyMandateSignature(
      mandate,
      signature,
      CONFIG.USDC_ADDRESS
    );

    if (!isValid) {
      throw new Error('Invalid mandate signature');
    }

    // Store mandate
    this.mandates.set(mandate.mandateId, mandate);
    
    // Index by user address
    const userMandateIds = this.userMandates.get(mandate.userAddress.toLowerCase()) || [];
    userMandateIds.push(mandate.mandateId);
    this.userMandates.set(mandate.userAddress.toLowerCase(), userMandateIds);

    return mandate;
  }

  /**
   * Get the EIP-712 domain and types for mandate signing
   */
  getMandateSigningData(unsignedMandate: Omit<IntentMandate, 'userSignature'>) {
    return {
      domain: {
        ...INTENT_MANDATE_DOMAIN,
        verifyingContract: CONFIG.USDC_ADDRESS,
      },
      types: INTENT_MANDATE_TYPES,
      primaryType: 'IntentMandate' as const,
      message: getMandateMessage(unsignedMandate as IntentMandate, this.merchantAddress as Address),
    };
  }

  /**
   * Get a mandate by ID
   */
  getMandate(mandateId: string): IntentMandate | undefined {
    return this.mandates.get(mandateId);
  }

  /**
   * Get all mandates for a user
   */
  getUserMandates(userAddress: string): IntentMandate[] {
    const mandateIds = this.userMandates.get(userAddress.toLowerCase()) || [];
    return mandateIds
      .map(id => this.mandates.get(id))
      .filter((m): m is IntentMandate => m !== undefined);
  }

  /**
   * Check if a mandate is valid (not expired)
   */
  isMandateValid(mandateId: string): boolean {
    const mandate = this.mandates.get(mandateId);
    if (!mandate) return false;

    const now = Math.floor(Date.now() / 1000);
    return now < mandate.expiresAt;
  }

  /**
   * Verify that a user owns a mandate
   */
  verifyMandateOwnership(mandateId: string, userAddress: string): boolean {
    const mandate = this.mandates.get(mandateId);
    if (!mandate) return false;
    
    return mandate.userAddress.toLowerCase() === userAddress.toLowerCase();
  }

  /**
   * Get the merchant address
   */
  getMerchantAddress(): string {
    return this.merchantAddress;
  }

  /**
   * Generate a unique mandate ID
   */
  private generateMandateId(): string {
    return `mandate_${randomBytes(16).toString('hex')}`;
  }

  /**
   * Get all mandates (for admin/debugging)
   */
  getAllMandates(): IntentMandate[] {
    return Array.from(this.mandates.values());
  }

  /**
   * Clean up expired mandates
   */
  cleanupExpiredMandates(): number {
    const now = Math.floor(Date.now() / 1000);
    let cleaned = 0;

    for (const [mandateId, mandate] of this.mandates.entries()) {
      if (now >= mandate.expiresAt) {
        this.mandates.delete(mandateId);
        
        // Remove from user index
        const userMandateIds = this.userMandates.get(mandate.userAddress) || [];
        const filtered = userMandateIds.filter(id => id !== mandateId);
        if (filtered.length > 0) {
          this.userMandates.set(mandate.userAddress, filtered);
        } else {
          this.userMandates.delete(mandate.userAddress);
        }
        
        cleaned++;
      }
    }

    return cleaned;
  }
}

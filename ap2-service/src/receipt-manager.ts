import { randomBytes } from 'crypto';
import { PaymentMandate, PaymentMandateSchema, BatchInvoice } from './types.js';
import { CONFIG, ARBITRUM_ONE_CHAIN_ID } from './config.js';

/**
 * ReceiptManager creates and stores Payment Mandates (receipts)
 * These provide visibility to the payments ecosystem per AP2 specification
 */
export class ReceiptManager {
  private receipts: Map<string, PaymentMandate> = new Map();
  private batchReceipts: Map<string, string> = new Map(); // batchId -> receiptId

  /**
   * Create a Payment Mandate receipt for a settled batch
   */
  createReceipt(params: {
    batch: BatchInvoice;
    transactionHash: string;
    blockNumber: number;
    gasUsed?: string;
    modelName: string;
  }): PaymentMandate {
    const receiptId = this.generateReceiptId();
    const timestamp = Math.floor(Date.now() / 1000);

    const receipt: PaymentMandate = {
      receiptId,
      batchId: params.batch.batchId,
      mandateId: params.batch.mandateId,
      
      transactionHash: params.transactionHash,
      blockNumber: params.blockNumber,
      timestamp,
      
      from: params.batch.userAddress,
      to: params.batch.merchantAddress,
      amountMicroUsdc: params.batch.totalMicroUsdc,
      token: CONFIG.USDC_ADDRESS,
      network: 'arbitrum',
      chainId: ARBITRUM_ONE_CHAIN_ID,
      
      eventIds: params.batch.eventIds,
      eventCount: params.batch.eventCount,
      
      agentPresence: {
        modality: 'human-not-present',
        serviceType: 'ai-inference',
        modelName: params.modelName,
      },
      
      gasUsed: params.gasUsed,
      settlementMethod: 'x402',
    };

    // Validate receipt structure
    PaymentMandateSchema.parse(receipt);

    // Store receipt
    this.receipts.set(receiptId, receipt);
    this.batchReceipts.set(params.batch.batchId, receiptId);

    return receipt;
  }

  /**
   * Get a receipt by ID
   */
  getReceipt(receiptId: string): PaymentMandate | undefined {
    return this.receipts.get(receiptId);
  }

  /**
   * Get receipt for a batch
   */
  getReceiptForBatch(batchId: string): PaymentMandate | undefined {
    const receiptId = this.batchReceipts.get(batchId);
    if (!receiptId) return undefined;
    return this.receipts.get(receiptId);
  }

  /**
   * Get all receipts for a user
   */
  getUserReceipts(userAddress: string): PaymentMandate[] {
    return Array.from(this.receipts.values())
      .filter(r => r.from.toLowerCase() === userAddress.toLowerCase());
  }

  /**
   * Get all receipts for a mandate
   */
  getMandateReceipts(mandateId: string): PaymentMandate[] {
    return Array.from(this.receipts.values())
      .filter(r => r.mandateId === mandateId);
  }

  /**
   * Generate a unique receipt ID
   */
  private generateReceiptId(): string {
    return `receipt_${randomBytes(16).toString('hex')}`;
  }

  /**
   * Get all receipts (for admin/debugging)
   */
  getAllReceipts(): PaymentMandate[] {
    return Array.from(this.receipts.values());
  }

  /**
   * Get total amount settled for a user
   */
  getUserTotalSettled(userAddress: string): number {
    return this.getUserReceipts(userAddress)
      .reduce((sum, r) => sum + r.amountMicroUsdc, 0);
  }
}

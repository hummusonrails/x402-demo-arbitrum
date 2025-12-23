import { z } from 'zod';

// AP2 Intent Mandate Types

/**
 * Intent Mandate - User authorization for AI inference with payment
 * Based on AP2 specification for "human not present" scenarios
 */
export const IntentMandateSchema = z.object({
  // Mandate identification
  mandateId: z.string(),
  createdAt: z.number(), // Unix timestamp
  expiresAt: z.number(), // TTL for mandate validity
  
  // Payer information
  userAddress: z.string(), // Ethereum address (wallet)
  userSignature: z.string(), // User's cryptographic signature (EIP-712)
  
  // Payee information
  merchantAddress: z.string(), // Merchant receiving payments
  
  // Payment authorization
  paymentMethods: z.array(z.object({
    token: z.string(), // USDC contract address
    network: z.string().min(1),
    chainId: z.number(),
  })),
  
  // Usage limits and constraints
  dailyCapMicroUsdc: z.number(), // Maximum daily spending in micro-USDC
  pricePerMessageMicroUsdc: z.number(), // Price per AI inference call
  batchThreshold: z.number(), // Number of messages before settlement
  
  // Service intent
  serviceType: z.literal('ai-inference'),
  modelName: z.string(), // Ollama model being used
  
  // Risk and metadata
  riskPayload: z.object({
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
    sessionId: z.string(),
  }).optional(),
});

export type IntentMandate = z.infer<typeof IntentMandateSchema>;

// Usage Metering Types

/**
 * Individual usage event for a single AI inference call
 */
export const UsageEventSchema = z.object({
  eventId: z.string(),
  mandateId: z.string(),
  userAddress: z.string(),
  timestamp: z.number(),
  
  // AI inference details
  prompt: z.string(),
  response: z.string(),
  modelName: z.string(),
  tokensUsed: z.number().optional(),
  
  // Pricing
  priceMicroUsdc: z.number(),
  
  // Batch tracking
  batchId: z.string().nullable(), // null until assigned to a batch
  settled: z.boolean(),
});

export type UsageEvent = z.infer<typeof UsageEventSchema>;

/**
 * Batch invoice containing multiple usage events
 */
export const BatchInvoiceSchema = z.object({
  batchId: z.string(),
  mandateId: z.string(),
  userAddress: z.string(),
  merchantAddress: z.string(),
  
  // Events in this batch
  eventIds: z.array(z.string()),
  eventCount: z.number(),
  
  // Totals
  totalMicroUsdc: z.number(),
  
  // Timestamps
  createdAt: z.number(),
  settledAt: z.number().nullable(),
  
  // Settlement status
  status: z.enum(['pending', 'settling', 'settled', 'failed']),
  transactionHash: z.string().nullable(),
  blockNumber: z.number().nullable(),
  errorMessage: z.string().nullable(),
});

export type BatchInvoice = z.infer<typeof BatchInvoiceSchema>;

// Payment Mandate (Receipt) Types

/**
 * Payment Mandate - Receipt of completed settlement
 * Provides visibility to payments ecosystem per AP2 spec
 */
export const PaymentMandateSchema = z.object({
  receiptId: z.string(),
  batchId: z.string(),
  mandateId: z.string(),
  
  // Transaction details
  transactionHash: z.string(),
  blockNumber: z.number(),
  timestamp: z.number(),
  
  // Payment details
  from: z.string(), // User address
  to: z.string(), // Merchant address
  amountMicroUsdc: z.number(),
  token: z.string(), // USDC contract address
  network: z.string().min(1),
  chainId: z.number(),
  
  // Usage events covered
  eventIds: z.array(z.string()),
  eventCount: z.number(),
  
  // AI agent presence signals (required per AP2 spec)
  agentPresence: z.object({
    modality: z.literal('human-not-present'),
    serviceType: z.literal('ai-inference'),
    modelName: z.string(),
  }),
  
  // Settlement metadata
  gasUsed: z.string().optional(),
  settlementMethod: z.literal('x402'),
});

export type PaymentMandate = z.infer<typeof PaymentMandateSchema>;

// Settlement Authorization Types (EIP-712)

/**
 * Settlement authorization data for EIP-3009 transferWithAuthorization
 */
export const SettlementAuthorizationSchema = z.object({
  batchId: z.string(),
  from: z.string(),
  to: z.string(),
  value: z.string(),
  validAfter: z.number(),
  validBefore: z.number(),
  nonce: z.string(),
  network: z.string().optional(),
  requirements: z.any().optional(),
  // EIP-712 domain and types for signing
  domain: z.object({
    name: z.string(),
    version: z.string(),
    chainId: z.number(),
    verifyingContract: z.string(),
  }),
});

export type SettlementAuthorization = z.infer<typeof SettlementAuthorizationSchema>;

// Ollama API Types

export const OllamaGenerateRequestSchema = z.object({
  model: z.string(),
  prompt: z.string(),
  stream: z.boolean().default(false),
  options: z.object({
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    max_tokens: z.number().optional(),
    num_predict: z.number().optional(),
    num_ctx: z.number().optional(),
    num_thread: z.number().optional(),
    num_gpu: z.number().optional(),
    repeat_penalty: z.number().optional(),
  }).optional(),
  keep_alive: z.string().optional(),
});

export type OllamaGenerateRequest = z.infer<typeof OllamaGenerateRequestSchema>;

export const OllamaGenerateResponseSchema = z.object({
  model: z.string(),
  created_at: z.string(),
  response: z.string(),
  done: z.boolean(),
  context: z.array(z.number()).optional(),
  total_duration: z.number().optional(),
  load_duration: z.number().optional(),
  prompt_eval_count: z.number().optional(),
  prompt_eval_duration: z.number().optional(),
  eval_count: z.number().optional(),
  eval_duration: z.number().optional(),
});

export type OllamaGenerateResponse = z.infer<typeof OllamaGenerateResponseSchema>;

// API Request/Response Types

export const CreateMandateRequestSchema = z.object({
  userAddress: z.string(),
  dailyCapMicroUsdc: z.number().optional(),
  sessionId: z.string(),
  userAgent: z.string().optional(),
});

export type CreateMandateRequest = z.infer<typeof CreateMandateRequestSchema>;

export const InferenceRequestSchema = z.object({
  mandateId: z.string(),
  userAddress: z.string(),
  prompt: z.string(),
  temperature: z.number().min(0).max(2).optional(),
});

export type InferenceRequest = z.infer<typeof InferenceRequestSchema>;

export const InferenceResponseSchema = z.object({
  eventId: z.string(),
  response: z.string(),
  priceMicroUsdc: z.number(),
  
  // Usage tracking
  dailyUsageMicroUsdc: z.number(),
  dailyCapMicroUsdc: z.number(),
  messagesUntilSettlement: z.number(),
  
  // Settlement info (if triggered)
  settlementTriggered: z.boolean(),
  batchId: z.string().optional(),
  transactionHash: z.string().optional(),
  explorerUrl: z.string().optional(),
  
  // Settlement authorization (if signature needed)
  needsSignature: z.boolean().optional(),
  settlementAuthorization: SettlementAuthorizationSchema.optional(),
});

export type InferenceResponse = z.infer<typeof InferenceResponseSchema>;

// x402 Integration Types

export interface X402PaymentPayload {
  scheme: 'exact';
  network: string;
  payload: {
    from: string;
    to: string;
    value: string;
    validAfter: number;
    validBefore: number;
    nonce: string;
    v: number;
    r: string;
    s: string;
  };
}

export interface X402SettlementResult {
  success: boolean;
  transactionHash?: string;
  blockNumber?: bigint;
  gasUsed?: bigint;
  error?: string;
}

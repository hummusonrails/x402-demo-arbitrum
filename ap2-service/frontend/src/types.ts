export interface PaymentMethod {
  token: string;
  network: string;
  chainId: number;
}

export interface RiskPayload {
  ipAddress?: string;
  userAgent?: string;
  sessionId: string;
}

export interface IntentMandate {
  mandateId: string;
  createdAt: number;
  expiresAt: number;
  userAddress: string;
  userSignature: string;
  merchantAddress: string;
  paymentMethods: PaymentMethod[];
  dailyCapMicroUsdc: number;
  pricePerMessageMicroUsdc: number;
  batchThreshold: number;
  serviceType: 'ai-inference';
  modelName: string;
  riskPayload?: RiskPayload;
}

export interface SettlementAuthorization {
  batchId: string;
  from: string;
  to: string;
  value: string;
  validAfter: number;
  validBefore: number;
  nonce: string;
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
}

export interface InferenceResponse {
  eventId: string;
  response: string;
  priceMicroUsdc: number;
  dailyUsageMicroUsdc: number;
  dailyCapMicroUsdc: number;
  messagesUntilSettlement: number;
  settlementTriggered: boolean;
  batchId?: string;
  transactionHash?: string;
  explorerUrl?: string;
  needsSignature?: boolean;
  settlementAuthorization?: SettlementAuthorization;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  eventId?: string;
  priceMicroUsdc?: number;
  settlementInfo?: {
    batchId: string;
    transactionHash: string;
    explorerUrl: string;
  };
}

export interface UsageStats {
  dailyUsage: number;
  dailyCap: number;
  messagesUntilSettlement: number;
  totalMessages: number;
}

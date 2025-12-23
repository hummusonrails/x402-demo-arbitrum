import { z } from 'zod';

export interface SupportedPaymentKind {
  x402Version: number;
  scheme: 'exact';
  network: string;
  payTo?: string;
}

export interface SupportedResponse {
  kinds: SupportedPaymentKind[];
  versions?: Record<string, { kinds: SupportedPaymentKind[] }>;
  signingAddresses?: {
    settlement: string;
    refund?: string;
  };
  extensions?: string[];
}

export interface RequirementsRequest {
  amount?: string;
  memo?: string;
  currency?: string;
  x402Version?: number;
  version?: number;
  extra?: {
    merchantAddress?: string;
    resource?: string;
    description?: string;
    mimeType?: string;
    outputSchema?: object;
    [key: string]: any;
  };
}

export interface PaymentRequirementsAccepts {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  asset: string;
  payTo: string;
  resource: string;
  description: string;
  mimeType: string;
  outputSchema?: object;
  maxTimeoutSeconds: number;
  extra?: {
    [key: string]: any;
  };
}

export interface PaymentRequirementsResponse {
  x402Version: number;
  error: string;
  accepts: PaymentRequirementsAccepts[];
}

export interface SDKVerifyRequest {
  x402Version?: number;
  network: string;
  token: string;
  recipient: string;
  amount: string;
  nonce: string;
  deadline: number;
  memo?: string;
  extra?: {
    merchantAddress: string;
    feeMode?: string;
    [key: string]: any;
  };
  permit: {
    owner: string;
    spender: string;
    value: string;
    deadline: number;
    sig: string;
  };
}

export const SDKVerifyRequestSchema = z.object({
  x402Version: z.number().optional(),
  network: z.string().min(1),
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string(),
  nonce: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  deadline: z.number(),
  memo: z.string().optional(),
  extra: z.object({
    merchantAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    feeMode: z.string().optional(),
  }).passthrough().optional(),
  permit: z.object({
    owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    spender: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    value: z.string(),
    deadline: z.number(),
    sig: z.string(),
  }),
});

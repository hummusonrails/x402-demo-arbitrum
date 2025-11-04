import type { IntentMandate, InferenceResponse } from './types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3003';

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async checkHealth(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error('Health check failed');
    }
    return response.json();
  }

  async createMandate(params: {
    userAddress: string;
    dailyCapMicroUsdc?: number;
    sessionId: string;
  }): Promise<{ unsignedMandate: Omit<IntentMandate, 'userSignature'>; signingData: any; message: string }> {
    const response = await fetch(`${this.baseUrl}/mandate/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create mandate');
    }

    return response.json();
  }

  async submitSignedMandate(params: {
    unsignedMandate: Omit<IntentMandate, 'userSignature'>;
    signature: `0x${string}`;
  }): Promise<{ mandate: IntentMandate; message: string }> {
    const response = await fetch(`${this.baseUrl}/mandate/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to submit signed mandate');
    }

    return response.json();
  }

  async getMandate(mandateId: string): Promise<{ mandate: IntentMandate }> {
    const response = await fetch(`${this.baseUrl}/mandate/${mandateId}`);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get mandate');
    }

    return response.json();
  }

  async getUserMandates(userAddress: string): Promise<{ mandates: IntentMandate[]; count: number }> {
    const response = await fetch(`${this.baseUrl}/mandate/user/${userAddress}`);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get user mandates');
    }

    return response.json();
  }

  async sendInference(params: {
    mandateId: string;
    userAddress: string;
    prompt: string;
    temperature?: number;
  }): Promise<InferenceResponse> {
    const response = await fetch(`${this.baseUrl}/inference`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Inference failed');
    }

    return response.json();
  }

  async getUserUsage(userAddress: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/usage/user/${userAddress}`);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get usage');
    }

    return response.json();
  }

  async completeSettlement(params: {
    batchId: string;
    signature: string;
    userAddress: string;
    authorization: any; // The exact authorization data that was signed
  }): Promise<{ success: boolean; transactionHash: string; explorerUrl: string; receiptId: string; error?: string }> {
    const response = await fetch(`${this.baseUrl}/settlement/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Settlement completion failed');
    }

    return response.json();
  }
}

export const apiClient = new ApiClient();

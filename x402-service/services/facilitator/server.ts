import express, { Request, Response } from "express";
import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  config,
  FACILITATOR_PRIVATE_KEY,
  FACILITATOR_ADDRESS,
  PORT,
  BODY_SIZE_LIMIT,
  allNetworkConfigs,
  normalizeNetworkId,
  MERCHANT_API_KEY,
} from "./config";
import { generateRequirements } from "./requirements";
import { SDKVerifyRequestSchema, SupportedPaymentKind, SupportedResponse, SDKVerifyRequest } from "./types";

const app = express();
app.use(express.json({ limit: BODY_SIZE_LIMIT }));

// Set up viem client for on-chain transactions
const account = privateKeyToAccount(FACILITATOR_PRIVATE_KEY);
const client = createWalletClient({
  account,
  chain: config.chain,
  transport: http(config.rpcUrl),
}).extend(publicActions);

// Define our own types for the facilitator service
interface PaymentPayload {
  x402Version?: number;
  scheme: string;
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

interface PaymentRequirementsV1 {
  scheme: string;
  network: string;
  token: string;
  amount: string;
  recipient: string;
  description: string;
  maxTimeoutSeconds: number;
  merchantAddress?: string;
}

type VerifyRequest = {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirementsV1;
};

function parseSdkRequestPayload(req: Request): SDKVerifyRequest | null {
  if (req.body && Object.keys(req.body).length > 0) {
    return req.body as SDKVerifyRequest;
  }
  const headerValue = req.header('PAYMENT-SIGNATURE') || req.header('X-PAYMENT');
  if (!headerValue) {
    return null;
  }
  try {
    return JSON.parse(headerValue) as SDKVerifyRequest;
  } catch {
    return null;
  }
}

function sdkRequestToInternal(sdkReq: SDKVerifyRequest): VerifyRequest | null {
  const sig = sdkReq.permit.sig;
  if (sig.length !== 132) {
    return null;
  }
  const r = '0x' + sig.slice(2, 66);
  const s = '0x' + sig.slice(66, 130);
  const v = parseInt(sig.slice(130, 132), 16);

  const paymentPayload: PaymentPayload = {
    x402Version: sdkReq.x402Version || 1,
    scheme: 'exact',
    network: sdkReq.network,
    payload: {
      from: sdkReq.permit.owner,
      to: sdkReq.permit.spender,
      value: sdkReq.permit.value,
      validAfter: 0,
      validBefore: sdkReq.permit.deadline,
      nonce: sdkReq.nonce,
      v,
      r,
      s,
    },
  };

  const paymentRequirements: PaymentRequirementsV1 = {
    scheme: 'exact',
    network: sdkReq.network,
    token: sdkReq.token,
    amount: sdkReq.amount,
    recipient: sdkReq.recipient,
    description: sdkReq.memo || '',
    maxTimeoutSeconds: 3600,
    merchantAddress: sdkReq.extra?.merchantAddress,
  };

  return { paymentPayload, paymentRequirements };
}

app.get("/verify", (req: Request, res: Response) => {
  res.json({
    endpoint: "/verify",
    description: "POST to verify x402 payments",
    body: {
      paymentPayload: "SDKVerifyRequest",
    },
  });
});

app.post("/verify", async (req: Request, res: Response) => {
  try {
    const parsedRequest = parseSdkRequestPayload(req);
    if (!parsedRequest) {
      return res.status(400).json({ error: "Missing payment payload body or PAYMENT-SIGNATURE header." });
    }

    const validation = SDKVerifyRequestSchema.safeParse(parsedRequest);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid payment verification request format", meta: validation.error.errors });
    }

    if (validation.data.recipient.toLowerCase() !== FACILITATOR_ADDRESS.toLowerCase()) {
      return res.status(400).json({ error: "Recipient must be the facilitator address" });
    }

    const internal = sdkRequestToInternal(validation.data);
    if (!internal) {
      return res.status(400).json({ error: "Invalid signature format" });
    }

    const paymentRequirements = internal.paymentRequirements;
    const paymentPayload = internal.paymentPayload;

    const normalizedRequirementNetwork = normalizeNetworkId(paymentRequirements.network);
    const normalizedPayloadNetwork = normalizeNetworkId(paymentPayload.network);

    if (normalizedRequirementNetwork !== config.network) {
      throw new Error(`Invalid network - only ${config.network} is supported`);
    }

    if (normalizedPayloadNetwork !== normalizedRequirementNetwork) {
      throw new Error("Network mismatch between payment requirements and payload");
    }

    // For verify endpoint, just validate the structure
    // In production, this would verify signatures
    console.log('[Facilitator] Verifying payment...');
    console.log('[Facilitator] Payment requirements:', paymentRequirements);
    console.log('[Facilitator] Payment payload:', paymentPayload);
    
    const verificationResult = {
      valid: true,
      reason: null,
      meta: {
        facilitatorRecipient: FACILITATOR_ADDRESS,
      },
    };
    
    res.json(verificationResult);
  } catch (error) {
    console.error("error", error);
    res.status(400).json({ error: "Invalid request" });
  }
});

app.get("/settle", (req: Request, res: Response) => {
  res.json({
    endpoint: "/settle",
    description: "POST to settle x402 payments",
    body: {
      paymentPayload: "SDKVerifyRequest",
    },
  });
});

app.get("/supported", async (req: Request, res: Response) => {
  const v1Kinds: SupportedPaymentKind[] = [];
  const v2Kinds: SupportedPaymentKind[] = [];

  Object.values(allNetworkConfigs).forEach((networkConfig) => {
    v1Kinds.push({
      x402Version: 1,
      scheme: "exact",
      network: networkConfig.legacyNetwork,
    });
    v2Kinds.push({
      x402Version: 2,
      scheme: "exact",
      network: networkConfig.network,
      payTo: FACILITATOR_ADDRESS,
    });
  });

  const response: SupportedResponse = {
    kinds: [...v1Kinds, ...v2Kinds],
    versions: {
      "1": { kinds: v1Kinds },
      "2": { kinds: v2Kinds },
    },
    signingAddresses: {
      settlement: FACILITATOR_ADDRESS,
    },
    extensions: [],
  };

  res.json(response);
});

app.get("/requirements", (req: Request, res: Response) => {
  const version = req.query.version ? Number(req.query.version) : undefined;
  const requirements = generateRequirements({ x402Version: Number.isFinite(version) ? version : undefined });
  const serialized = JSON.stringify(requirements);
  res.setHeader("PAYMENT-RESPONSE", serialized);
  res.setHeader("X-PAYMENT-RESPONSE", serialized);
  res.status(402).json(requirements);
});

app.post("/requirements", (req: Request, res: Response) => {
  try {
    const requirements = generateRequirements(req.body);
    const serialized = JSON.stringify(requirements);
    res.setHeader("PAYMENT-RESPONSE", serialized);
    res.setHeader("X-PAYMENT-RESPONSE", serialized);
    res.status(402).json(requirements);
  } catch (error) {
    res.status(400).json({ error: `Invalid request: ${error}` });
  }
});

app.post("/settle", async (req: Request, res: Response) => {
  try {
    const apiKey = req.header('X-API-Key');
    if (!MERCHANT_API_KEY || apiKey !== MERCHANT_API_KEY) {
      return res.status(401).json({ error: "Missing or invalid X-API-Key" });
    }

    console.log('[Facilitator] Received settle request');
    console.log('[Facilitator] Body:', JSON.stringify(req.body, null, 2));

    const parsedRequest = parseSdkRequestPayload(req);
    if (!parsedRequest) {
      return res.status(400).json({ error: "Missing payment payload body or PAYMENT-SIGNATURE header." });
    }

    const validation = SDKVerifyRequestSchema.safeParse(parsedRequest);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid settlement request format", meta: validation.error.errors });
    }

    const internal = sdkRequestToInternal(validation.data);
    if (!internal) {
      return res.status(400).json({ error: "Invalid signature format" });
    }

    const paymentRequirements = internal.paymentRequirements;
    const paymentPayload = internal.paymentPayload;

    console.log('[Facilitator] Payment requirements:', paymentRequirements);
    console.log('[Facilitator] Payment payload:', paymentPayload);

    const normalizedRequirementNetwork = normalizeNetworkId(paymentRequirements.network);
    const normalizedPayloadNetwork = normalizeNetworkId(paymentPayload.network);

    if (normalizedPayloadNetwork !== normalizedRequirementNetwork) {
      throw new Error("Network mismatch between payment requirements and payload");
    }

    if (normalizedRequirementNetwork !== config.network) {
      throw new Error(`Invalid network - only ${config.network} is supported`);
    }

    // Security validations: validate all critical parameters against configured values
    // Normalize addresses for comparison (lowercase)
    const requestedToken = paymentRequirements.token.toLowerCase();
    const configuredToken = config.usdcAddress.toLowerCase();
    const requestedRecipient = paymentPayload.payload.to.toLowerCase();
    const configuredRecipient = FACILITATOR_ADDRESS.toLowerCase();
    
    // Validate token: must match configured USDC address
    if (requestedToken !== configuredToken) {
      console.error(`[Facilitator] Token mismatch - requested: ${requestedToken}, configured: ${configuredToken}`);
      throw new Error(`Invalid token address. Only ${config.usdcAddress} is supported.`);
    }
    
    // Validate recipient: must match configured merchant address
    if (requestedRecipient !== configuredRecipient) {
      console.error(`[Facilitator] Recipient mismatch - requested: ${requestedRecipient}, configured: ${configuredRecipient}`);
      throw new Error(`Invalid recipient address. Payments must go to ${FACILITATOR_ADDRESS}`);
    }
    
    // Validate amounts match between requirements and payload
    if (paymentRequirements.amount !== paymentPayload.payload.value) {
      console.error(`[Facilitator] Amount mismatch - requirements: ${paymentRequirements.amount}, payload: ${paymentPayload.payload.value}`);
      throw new Error('Amount mismatch between payment requirements and payload');
    }
    
    // Validate amount is a positive integer
    const amount = BigInt(paymentRequirements.amount);
    if (amount <= 0n) {
      console.error(`[Facilitator] Invalid amount: ${amount}`);
      throw new Error('Amount must be a positive integer');
    }
    
    // Optional: add maximum amount limit (e.g., 1000 USDC = 1000000000 micro-USDC)
    const MAX_AMOUNT = BigInt(1_000_000_000); // 1000 USDC in 6 decimals
    if (amount > MAX_AMOUNT) {
      console.error(`[Facilitator] Amount exceeds limit: ${amount} > ${MAX_AMOUNT}`);
      throw new Error(`Amount exceeds maximum limit of ${MAX_AMOUNT}`);
    }

    // Execute on-chain settlement using validated/configured values
    // For demo: merchant pulls funds using transferFrom (requires user approval)
    // In production with EIP-7702: would use transferWithAuthorization with delegated signing
    console.log('[Facilitator] Security validations passed');
    console.log('[Facilitator] Executing settlement via transferFrom...');
    console.log('[Facilitator] From:', paymentPayload.payload.from);
    console.log('[Facilitator] To:', FACILITATOR_ADDRESS, '(validated)');
    console.log('[Facilitator] Amount:', amount.toString(), '(validated)');
    console.log('[Facilitator] Token:', config.usdcAddress, '(validated)');
    
    // ERC-20 transferFrom ABI
    const transferFromAbi = [{
      name: 'transferFrom',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
      ],
      outputs: [{ name: '', type: 'bool' }],
    }] as const;
    
    // Execute the transfer using ONLY validated/configured values
    const hash = await client.writeContract({
      address: config.usdcAddress as `0x${string}`, // Use configured USDC, not request value
      abi: transferFromAbi,
      functionName: 'transferFrom',
      args: [
        paymentPayload.payload.from as `0x${string}`,
        FACILITATOR_ADDRESS as `0x${string}`, // Use configured merchant, not request value
        amount, // Use validated amount
      ],
    });
    
    console.log('[Facilitator] Transaction submitted:', hash);
    
    // Wait for confirmation
    const receipt = await client.waitForTransactionReceipt({ hash });
    
    console.log('[Facilitator] Transaction confirmed in block:', receipt.blockNumber);
    
    const settlementResult = {
      success: true,
      transactionHash: receipt.transactionHash,
      blockNumber: Number(receipt.blockNumber),
      status: 'confirmed' as const,
    };
    
    console.log('[Facilitator] Settlement result:', settlementResult);
    res.json(settlementResult);
  } catch (error) {
    console.error("error", error);
    res.status(400).json({ error: `Invalid request: ${error}` });
  }
});

app.listen(PORT, () => {
  console.log(`X402-Compliant Facilitator listening at http://localhost:${PORT}`);
  console.log(`Network: ${config.network}`);
  console.log('');
  console.log('Endpoints:');
  console.log('  GET  /verify     - Verify endpoint info');
  console.log('  POST /verify     - Verify payment payload');
  console.log('  GET  /settle     - Settle endpoint info');
  console.log('  POST /settle     - Execute payment settlement');
  console.log('  GET  /supported  - Supported payment kinds');
  console.log('  GET  /requirements - Payment requirements');
  console.log('  POST /requirements - Payment requirements');
});

import { config } from "dotenv";
import express, { Request, Response } from "express";
import { randomBytes } from "crypto";
import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import { CAIP2_ARBITRUM_SEPOLIA, normalizeNetworkId, toLegacyNetworkId } from "../../app/x402-utils";

// Define Arb Sepolia payment kind
interface SupportedPaymentKind {
  x402Version: number;
  scheme: "exact";
  network: string;
  payTo?: string;
}

config();

// Validate and normalize private key
let EVM_PRIVATE_KEY = process.env.QUOTE_SERVICE_PRIVATE_KEY || "";

if (!EVM_PRIVATE_KEY) {
  console.error("Missing QUOTE_SERVICE_PRIVATE_KEY environment variable");
  process.exit(1);
}

// Normalize: add 0x prefix if missing
if (!EVM_PRIVATE_KEY.startsWith("0x")) {
  EVM_PRIVATE_KEY = `0x${EVM_PRIVATE_KEY}`;
}

// Validate format: must be 0x followed by 64 hex characters
if (EVM_PRIVATE_KEY.length !== 66) {
  console.error(`Invalid QUOTE_SERVICE_PRIVATE_KEY format: expected 66 characters (0x + 64 hex), got ${EVM_PRIVATE_KEY.length}`);
  console.error("Example: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
  process.exit(1);
}

// Validate hex characters (0-9, a-f, A-F)
const hexPattern = /^0x[0-9a-fA-F]{64}$/;
if (!hexPattern.test(EVM_PRIVATE_KEY)) {
  console.error("Invalid QUOTE_SERVICE_PRIVATE_KEY format: must contain only hexadecimal characters (0-9, a-f, A-F)");
  console.error("Example: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
  process.exit(1);
}

const USDC_ADDRESS = process.env.USDC_ADDRESS || "";

if (!USDC_ADDRESS) {
  console.error("Missing USDC_ADDRESS environment variable");
  process.exit(1);
}

const app = express();
app.use(express.json());

// Set up viem client for on-chain transactions
const account = privateKeyToAccount(EVM_PRIVATE_KEY as `0x${string}`);
const client = createWalletClient({
  account,
  chain: arbitrumSepolia,
  transport: http(),
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
}

interface PaymentRequirementsV2 {
  x402Version?: number;
  accepts: Array<{
    scheme: string;
    network: string;
    asset: string;
    payTo: string;
    maxAmountRequired: string;
    resource?: string;
    description?: string;
    mimeType?: string;
    maxTimeoutSeconds?: number;
    extra?: Record<string, unknown>;
  }>;
}

type PaymentRequirements = PaymentRequirementsV1 | PaymentRequirementsV2;

type VerifyRequest = {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
};

type SettleRequest = {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
};

const PAYMENT_AMOUNT = '1000';
const PAYMENT_TIMEOUT_SECONDS = 3600;

function generateNonce(): string {
  return `0x${randomBytes(32).toString('hex')}`;
}

function getVersionedRequirements(version: number) {
  const accept = {
    scheme: "exact",
    network: CAIP2_ARBITRUM_SEPOLIA,
    asset: USDC_ADDRESS,
    payTo: account.address,
    maxAmountRequired: PAYMENT_AMOUNT,
    resource: "/quote",
    description: "Payment required",
    mimeType: "application/json",
    maxTimeoutSeconds: PAYMENT_TIMEOUT_SECONDS,
    extra: {
      nonce: generateNonce(),
      deadline: Math.floor(Date.now() / 1000) + PAYMENT_TIMEOUT_SECONDS,
    },
  };

  if (version === 1) {
    return {
      x402Version: 1,
      error: "Payment required",
      scheme: "exact",
      network: toLegacyNetworkId(CAIP2_ARBITRUM_SEPOLIA),
      token: USDC_ADDRESS,
      amount: PAYMENT_AMOUNT,
      recipient: account.address,
      description: accept.description,
      maxTimeoutSeconds: PAYMENT_TIMEOUT_SECONDS,
    };
  }

  return {
    x402Version: 2,
    error: "Payment required",
    accepts: [accept],
  };
}

function getRequestedVersion(req: Request): number {
  const fromQuery = req.query?.version ?? req.query?.x402Version;
  const fromBody = (req.body as { version?: number; x402Version?: number; extra?: { x402Version?: number } } | undefined);
  const version = Number(fromBody?.x402Version ?? fromBody?.version ?? fromBody?.extra?.x402Version ?? fromQuery);
  return version === 1 ? 1 : 2;
}

function parsePaymentBundle(req: Request): VerifyRequest | null {
  const body = req.body as VerifyRequest | undefined;
  if (body?.paymentPayload && body?.paymentRequirements) {
    return body;
  }

  const paymentSignatureHeader = req.get('PAYMENT-SIGNATURE') || req.get('payment-signature');
  if (paymentSignatureHeader) {
    try {
      const parsed = JSON.parse(paymentSignatureHeader) as VerifyRequest;
      if (parsed?.paymentPayload && parsed?.paymentRequirements) {
        return parsed;
      }
    } catch {
      return null;
    }
  }

  const legacyHeader = req.get('X-PAYMENT') || req.get('x-payment');
  if (legacyHeader) {
    try {
      const decoded = Buffer.from(legacyHeader, 'base64').toString('utf-8');
      const payload = JSON.parse(decoded) as PaymentPayload;
      if (payload && body?.paymentRequirements) {
        return {
          paymentPayload: payload,
          paymentRequirements: body.paymentRequirements,
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

function getRequirementFields(paymentRequirements: PaymentRequirements) {
  const version = (paymentRequirements as { x402Version?: number }).x402Version || ('accepts' in paymentRequirements ? 2 : 1);
  if (version === 2 && 'accepts' in paymentRequirements) {
    const accept = paymentRequirements.accepts[0];
    return {
      version: 2,
      network: accept?.network,
      token: accept?.asset,
      amount: accept?.maxAmountRequired,
      recipient: accept?.payTo,
    };
  }

  const legacy = paymentRequirements as PaymentRequirementsV1;
  return {
    version: 1,
    network: legacy.network,
    token: legacy.token,
    amount: legacy.amount,
    recipient: legacy.recipient,
  };
}

app.get("/verify", (req: Request, res: Response) => {
  res.json({
    endpoint: "/verify",
    description: "POST to verify x402 payments",
    body: {
      paymentPayload: "PaymentPayload",
      paymentRequirements: "PaymentRequirements",
    },
  });
});

app.post("/verify", async (req: Request, res: Response) => {
  try {
    const parsed = parsePaymentBundle(req);
    if (!parsed) {
      return res.status(400).json({ error: "Missing payment payload and requirements. Provide JSON body or PAYMENT-SIGNATURE header." });
    }

    const paymentRequirements = parsed.paymentRequirements;
    const paymentPayload = parsed.paymentPayload;
    const requirementFields = getRequirementFields(paymentRequirements);

    const normalizedRequirementNetwork = normalizeNetworkId(requirementFields.network);
    const normalizedPayloadNetwork = normalizeNetworkId(paymentPayload.network);

    // Check if this is Arbitrum Sepolia (421614)
    if (normalizedRequirementNetwork !== CAIP2_ARBITRUM_SEPOLIA) {
      throw new Error("Invalid network - only arbitrum-sepolia is supported");
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
      message: 'Payment payload is valid',
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
      paymentPayload: "PaymentPayload",
      paymentRequirements: "PaymentRequirements",
    },
  });
});

app.get("/supported", async (req: Request, res: Response) => {
  const kinds: SupportedPaymentKind[] = [];
  const v1Kinds: SupportedPaymentKind[] = [];
  const v2Kinds: SupportedPaymentKind[] = [];

  // Support Arbitrum Sepolia
  if (EVM_PRIVATE_KEY) {
    const v1Kind: SupportedPaymentKind = {
      x402Version: 1,
      scheme: "exact",
      network: toLegacyNetworkId(CAIP2_ARBITRUM_SEPOLIA),
    };
    const v2Kind: SupportedPaymentKind = {
      x402Version: 2,
      scheme: "exact",
      network: CAIP2_ARBITRUM_SEPOLIA,
      payTo: account.address,
    };
    v1Kinds.push(v1Kind);
    v2Kinds.push(v2Kind);
    kinds.push(v1Kind, v2Kind);
  }

  res.json({
    kinds,
    versions: {
      "1": { kinds: v1Kinds },
      "2": { kinds: v2Kinds },
    },
    signingAddresses: {
      settlement: account.address,
    },
    extensions: [],
  });
});

app.all("/requirements", (req: Request, res: Response) => {
  try {
    const version = getRequestedVersion(req);
    const requirements = getVersionedRequirements(version);
    const requirementsJson = JSON.stringify(requirements);
    res.setHeader("PAYMENT-RESPONSE", requirementsJson);
    res.setHeader("X-PAYMENT-RESPONSE", requirementsJson);
    res.json(requirements);
  } catch (error) {
    res.status(400).json({ error: `Invalid request: ${error}` });
  }
});

app.post("/settle", async (req: Request, res: Response) => {
  try {
    console.log('[Facilitator] Received settle request');
    console.log('[Facilitator] Body:', JSON.stringify(req.body, null, 2));

    const parsed = parsePaymentBundle(req);
    if (!parsed) {
      return res.status(400).json({ error: "Missing payment payload and requirements. Provide JSON body or PAYMENT-SIGNATURE header." });
    }

    const paymentRequirements = parsed.paymentRequirements;
    const paymentPayload = parsed.paymentPayload;
    const requirementFields = getRequirementFields(paymentRequirements);

    console.log('[Facilitator] Payment requirements:', paymentRequirements);
    console.log('[Facilitator] Payment payload:', paymentPayload);

    const normalizedRequirementNetwork = normalizeNetworkId(requirementFields.network);
    const normalizedPayloadNetwork = normalizeNetworkId(paymentPayload.network);

    // Check if this is Arbitrum Sepolia
    if (normalizedRequirementNetwork !== CAIP2_ARBITRUM_SEPOLIA) {
      throw new Error("Invalid network - only arbitrum-sepolia is supported");
    }

    if (normalizedPayloadNetwork !== normalizedRequirementNetwork) {
      throw new Error("Network mismatch between payment requirements and payload");
    }

    // Security validations: validate all critical parameters against configured values
    const merchantAddress = account.address;
    
    // Normalize addresses for comparison (lowercase)
    const requestedToken = requirementFields.token.toLowerCase();
    const configuredToken = USDC_ADDRESS.toLowerCase();
    const requestedRecipient = paymentPayload.payload.to.toLowerCase();
    const configuredRecipient = merchantAddress.toLowerCase();
    
    // Validate token: must match configured USDC address
    if (requestedToken !== configuredToken) {
      console.error(`[Facilitator] Token mismatch - requested: ${requestedToken}, configured: ${configuredToken}`);
      throw new Error(`Invalid token address. Only ${USDC_ADDRESS} is supported.`);
    }
    
    // Validate recipient: must match configured merchant address
    if (requestedRecipient !== configuredRecipient) {
      console.error(`[Facilitator] Recipient mismatch - requested: ${requestedRecipient}, configured: ${configuredRecipient}`);
      throw new Error(`Invalid recipient address. Payments must go to ${merchantAddress}`);
    }
    
    // Validate amounts match between requirements and payload
    if (requirementFields.amount !== paymentPayload.payload.value) {
      console.error(`[Facilitator] Amount mismatch - requirements: ${requirementFields.amount}, payload: ${paymentPayload.payload.value}`);
      throw new Error('Amount mismatch between payment requirements and payload');
    }
    
    // Validate amount is a positive integer
    const amount = BigInt(requirementFields.amount);
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
    console.log('[Facilitator] To:', merchantAddress, '(validated)');
    console.log('[Facilitator] Amount:', amount.toString(), '(validated)');
    console.log('[Facilitator] Token:', USDC_ADDRESS, '(validated)');
    
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
      address: USDC_ADDRESS as `0x${string}`, // Use configured USDC, not request value
      abi: transferFromAbi,
      functionName: 'transferFrom',
      args: [
        paymentPayload.payload.from as `0x${string}`,
        merchantAddress as `0x${string}`, // Use configured merchant, not request value
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

app.listen(process.env.PORT || 3002, () => {
  console.log(`X402-Compliant Facilitator listening at http://localhost:${process.env.PORT || 3002}`);
  console.log(`Network: Arbitrum Sepolia`);
  console.log('');
  console.log('Endpoints:');
  console.log('  GET  /verify     - Verify endpoint info');
  console.log('  POST /verify     - Verify payment payload');
  console.log('  GET  /settle     - Settle endpoint info');
  console.log('  POST /settle     - Execute payment settlement');
  console.log('  GET  /supported  - Supported payment kinds');
});

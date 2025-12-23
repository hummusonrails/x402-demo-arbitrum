import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PaymentSwapQuoteIntentSchema, PaymentSwapQuoteAttestation, QuoteStruct } from '../../app/types';
import { QuoteSigner } from './signer';
import { loadContractAddresses, ENV } from '../../app/config';

const fastify = Fastify({ logger: true });

fastify.register(cors as any, {
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Payment', 'Payment-Signature'],
  exposedHeaders: ['Payment-Response', 'X-Payment-Response'],
});

// Initialize signer and load addresses
const signer = new QuoteSigner();
const addresses = loadContractAddresses();

const PAYMENT_AMOUNT = '1000';
const FACILITATOR_URL = ENV.FACILITATOR_URL || 'http://localhost:3002';

type SDKVerifyRequest = {
  x402Version?: number;
  network: string;
  token: string;
  recipient: string;
  amount: string;
  nonce: string;
  deadline: number;
  memo?: string;
  extra?: Record<string, unknown>;
  permit: {
    owner: string;
    spender: string;
    value: string;
    deadline: number;
    sig: string;
  };
};

function parseSdkRequestPayload(request: any): SDKVerifyRequest | null {
  if (request.body && Object.keys(request.body).length > 0) {
    const body = request.body as Partial<SDKVerifyRequest>;
    if (body.permit && body.token && body.network && body.recipient && body.amount) {
      return body as SDKVerifyRequest;
    }
  }

  const headerValue = request.headers['payment-signature'] as string | undefined || request.headers['x-payment'] as string | undefined;
  if (!headerValue) {
    return null;
  }

  try {
    return JSON.parse(headerValue) as SDKVerifyRequest;
  } catch {
    try {
      const decoded = Buffer.from(headerValue, 'base64').toString('utf-8');
      return JSON.parse(decoded) as SDKVerifyRequest;
    } catch {
      return null;
    }
  }
}

async function fetchRequirements() {
  const response = await fetch(`${FACILITATOR_URL}/requirements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: PAYMENT_AMOUNT,
      memo: 'Payment for swap quote generation',
      extra: {
        merchantAddress: signer.getAddress(),
        resource: '/quote',
        description: 'Payment for swap quote generation',
        mimeType: 'application/json',
      },
    }),
  });

  const header = response.headers.get('payment-response') || response.headers.get('x-payment-response');
  const requirements = header ? JSON.parse(header) : await response.json();
  const serialized = header || JSON.stringify(requirements);
  return { requirements, serialized };
}

function sendPaymentRequired(reply: any, requirements: any, serialized: string, errorMessage?: string) {
  reply.header('PAYMENT-RESPONSE', serialized);
  reply.header('X-PAYMENT-RESPONSE', serialized);
  reply.status(402);

  return reply.send({
    error: errorMessage || requirements.error || 'Payment required',
    facilitator: { url: FACILITATOR_URL },
  });
}

fastify.get('/health', async (request, reply) => {
  return { status: 'ok', signer: signer.getAddress() };
});

// x402 quote endpoint
fastify.post('/quote', async (request, reply) => {
  try {
    const sdkRequest = parseSdkRequestPayload(request);
    if (!sdkRequest) {
      const { requirements, serialized } = await fetchRequirements();
      return sendPaymentRequired(reply, requirements, serialized);
    }

    fastify.log.info('Processing paid quote request with payment proof...');

    const endpoint = ENV.ENABLE_SETTLEMENT ? 'settle' : 'verify';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (endpoint === 'settle') {
      if (!ENV.MERCHANT_API_KEY) {
        throw new Error('Missing MERCHANT_API_KEY for facilitator settlement');
      }
      headers['X-API-Key'] = ENV.MERCHANT_API_KEY || '';
    }

    const facilitatorResponse = await fetch(`${FACILITATOR_URL}/${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(sdkRequest),
    });

    if (!facilitatorResponse.ok) {
      const { requirements, serialized } = await fetchRequirements();
      const errorText = await facilitatorResponse.text();
      return sendPaymentRequired(reply, requirements, serialized, `Facilitator ${endpoint} failed: ${errorText}`);
    }

    const settlementResult = await facilitatorResponse.json();
    if (endpoint === 'verify' && settlementResult.valid === false) {
      const { requirements, serialized } = await fetchRequirements();
      return sendPaymentRequired(reply, requirements, serialized, settlementResult.reason || 'Payment verification failed');
    }
    if (endpoint === 'settle' && settlementResult.success === false) {
      const { requirements, serialized } = await fetchRequirements();
      return sendPaymentRequired(reply, requirements, serialized, settlementResult.error || 'Payment settlement failed');
    }

    // Validate request body
    const intent = PaymentSwapQuoteIntentSchema.parse(request.body);
    
    // Calculate expected output based on mock rate
    const sellAmount = BigInt(intent.sellAmount);
    const expectedOut = (sellAmount * BigInt(ENV.MOCK_RATE_NUMERATOR)) / BigInt(ENV.MOCK_RATE_DENOMINATOR);
    
    // Apply slippage to get minimum buy amount
    const slippageFactor = BigInt(10000 - intent.maxSlippageBps);
    const minBuy = (expectedOut * slippageFactor) / BigInt(10000);
    
    // Create quote struct for EIP-712 signing
    const quote: QuoteStruct = {
      from: intent.from as `0x${string}`,
      sell: intent.sell as `0x${string}`,
      buy: intent.buy as `0x${string}`,
      sellAmount,
      minBuy,
      deadline: BigInt(intent.deadline),
      chainId: BigInt(intent.chainId),
      nonce: intent.nonce as `0x${string}`,
    };
    
    // Sign the quote
    const { signature: quoteSignature, signer: signerAddress } = await signer.signQuote(quote, addresses.executor);
    
    // Compute intent hash
    const intentHash = signer.computeIntentHash(intent);
    
    // Build attestation response
    const attestation: PaymentSwapQuoteAttestation = {
      type: 'payment.swap.quote.attestation',
      route: {
        venues: ['mock:adapter'],
        expected_out: expectedOut.toString(),
        ttl: 300,
      },
      constraints: {
        max_fee_bps: 15,
      },
      signature: quoteSignature,
      signer: signerAddress,
      intent_hash: intentHash,
      quote: {
        from: quote.from,
        sell: quote.sell,
        buy: quote.buy,
        sellAmount: quote.sellAmount.toString(),
        minBuy: quote.minBuy.toString(),
        deadline: Number(quote.deadline),
        chainId: Number(quote.chainId),
        nonce: quote.nonce,
      },
    };
    
    fastify.log.info({
      intent_hash: intentHash,
      sell_amount: sellAmount.toString(),
      expected_out: expectedOut.toString(),
      min_buy: minBuy.toString(),
      slippage_bps: intent.maxSlippageBps,
      payment_received: true,
    }, 'Generated paid quote');

    // Add X-Payment-Response header to indicate successful payment processing
    const paymentResponse = {
      status: endpoint === 'settle' ? (settlementResult?.success ? 'completed' : 'failed') : 'verified',
      transactionHash: settlementResult?.transactionHash || settlementResult?.txHash || null,
      blockNumber: settlementResult?.blockNumber ? Number(settlementResult.blockNumber) : null,
      amount: sdkRequest.amount,
      token: sdkRequest.token,
      settled: !!settlementResult?.success,
    };

    reply.header('X-Payment-Response', Buffer.from(JSON.stringify(paymentResponse)).toString('base64'));
    
    return attestation;
  } catch (error) {
    fastify.log.error(error, 'Quote generation failed');
    
    if (error instanceof Error) {
      reply.status(400).send({ error: error.message });
    } else {
      reply.status(500).send({ error: 'Internal server error' });
    }
  }
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: 3001, host: '0.0.0.0' });
    console.log('x402-compliant Quote service running on http://localhost:3001');
    console.log('Accepts payments via x402 protocol');
    console.log('Signer address:', signer.getAddress());
    console.log('Executor address:', addresses.executor);
    console.log('Payment: 0.001 USDC per quote');
    console.log('Settlement:', ENV.ENABLE_SETTLEMENT ? 'ENABLED (facilitator)' : 'DISABLED (verification only)');
    console.log('Facilitator URL:', FACILITATOR_URL);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

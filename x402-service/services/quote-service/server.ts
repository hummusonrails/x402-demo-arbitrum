import Fastify from 'fastify';
import cors from '@fastify/cors';
import { parseUnits } from 'viem';
import { PaymentSwapQuoteIntentSchema, PaymentSwapQuoteAttestation, QuoteStruct, X402PaymentRequirement, EIP3009PaymentPayload } from '../../app/types';
import { QuoteSigner } from './signer';
import { loadContractAddresses, ENV, ARBITRUM_SEPOLIA_CHAIN_ID } from '../../app/config';
import { decodePaymentHeader, verifyTransferAuthorization } from '../../app/eip3009';
import { SettlementService } from '../../app/settlement';
import { CAIP2_ARBITRUM_SEPOLIA, normalizeNetworkId } from '../../app/x402-utils';

const fastify = Fastify({ logger: true });

fastify.register(cors as any, {
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Payment', 'Payment-Signature'],
  exposedHeaders: ['Payment-Response', 'X-Payment-Response'],
});

// Initialize signer, settlement service, and load addresses
const signer = new QuoteSigner();
const addresses = loadContractAddresses();
const settlementService = ENV.ENABLE_SETTLEMENT ? new SettlementService(ENV.QUOTE_SERVICE_PRIVATE_KEY) : null;

const PAYMENT_AMOUNT = '1000';
const PAYMENT_TIMEOUT_SECONDS = 300;

function buildRequirements(): { requirements: { x402Version: number; error: string; accepts: X402PaymentRequirement[]; facilitator: { url: string } } } {
  const requirements = {
    x402Version: 2,
    error: 'Payment required',
    accepts: [
      {
        scheme: 'exact',
        network: CAIP2_ARBITRUM_SEPOLIA,
        maxAmountRequired: PAYMENT_AMOUNT, // 0.001 USDC
        resource: '/quote',
        description: 'Payment for swap quote generation',
        mimeType: 'application/json',
        outputSchema: null,
        payTo: signer.getAddress(),
        maxTimeoutSeconds: PAYMENT_TIMEOUT_SECONDS,
        asset: addresses.usdc, // Token contract address as string
        extra: {
          name: 'TestUSDC',
          version: '1',
        },
      },
    ],
    facilitator: {
      url: 'http://localhost:3002',
    },
  };

  return { requirements };
}

function sendPaymentRequired(reply: any, errorMessage?: string) {
  const { requirements } = buildRequirements();
  const requirementsJson = JSON.stringify(requirements);

  reply.header('PAYMENT-RESPONSE', requirementsJson);
  reply.header('X-PAYMENT-RESPONSE', requirementsJson);
  reply.status(402);

  return reply.send({
    error: errorMessage || requirements.error,
    facilitator: requirements.facilitator,
  });
}

function parsePaymentPayloadFromHeaders(request: any): EIP3009PaymentPayload | null {
  const paymentSignatureHeader = request.headers['payment-signature'] as string | undefined;
  if (paymentSignatureHeader) {
    try {
      const parsed = JSON.parse(paymentSignatureHeader) as {
        paymentPayload?: EIP3009PaymentPayload;
      };
      if (parsed.paymentPayload) {
        return parsed.paymentPayload;
      }
      if ((parsed as EIP3009PaymentPayload).scheme) {
        return parsed as EIP3009PaymentPayload;
      }
    } catch {
      return null;
    }
  }

  const paymentHeader = request.headers['x-payment'] as string | undefined;
  if (paymentHeader) {
    return decodePaymentHeader(paymentHeader);
  }

  return null;
}

fastify.get('/health', async (request, reply) => {
  return { status: 'ok', signer: signer.getAddress() };
});

// x402 quote endpoint
fastify.post('/quote', async (request, reply) => {
  try {
    const paymentPayload = parsePaymentPayloadFromHeaders(request);
    if (!paymentPayload) {
      return sendPaymentRequired(reply);
    }

    fastify.log.info('Processing paid quote request with payment proof...');

    const { requirements } = buildRequirements();
    const requirement = requirements.accepts[0];

    // Verify payment scheme and network
    if (paymentPayload.scheme !== 'exact' || normalizeNetworkId(paymentPayload.network) !== CAIP2_ARBITRUM_SEPOLIA) {
      return sendPaymentRequired(reply, 'Unsupported payment scheme or network');
    }

    // Verify payment amount
    const paymentAmount = BigInt(paymentPayload.payload.value);
    const requiredAmount = BigInt(requirement.maxAmountRequired);
    if (paymentAmount < requiredAmount) {
      return sendPaymentRequired(
        reply,
        `Insufficient payment amount. Required: ${requiredAmount}, provided: ${paymentAmount}`
      );
    }

    // Verify payment recipient
    if (paymentPayload.payload.to.toLowerCase() !== requirement.payTo.toLowerCase()) {
      return sendPaymentRequired(reply, 'Payment recipient mismatch');
    }

    // Verify EIP-3009 signature
    const authorization = {
      from: paymentPayload.payload.from,
      to: paymentPayload.payload.to,
      value: paymentPayload.payload.value,
      validAfter: paymentPayload.payload.validAfter,
      validBefore: paymentPayload.payload.validBefore,
      nonce: paymentPayload.payload.nonce,
    };

    const paymentSignature = {
      v: paymentPayload.payload.v,
      r: paymentPayload.payload.r,
      s: paymentPayload.payload.s,
    };

    const recoveredSigner = await verifyTransferAuthorization(
      authorization,
      paymentSignature,
      addresses.usdc,
      'TestUSDC',
      '1',
      ARBITRUM_SEPOLIA_CHAIN_ID
    );

    fastify.log.info({
      recoveredSigner,
      expectedSigner: paymentPayload.payload.from,
      match: recoveredSigner?.toLowerCase() === paymentPayload.payload.from.toLowerCase(),
    }, 'Signature verification result');

    if (!recoveredSigner || recoveredSigner.toLowerCase() !== paymentPayload.payload.from.toLowerCase()) {
      fastify.log.error({
        recoveredSigner,
        expectedSigner: paymentPayload.payload.from,
      }, 'Signature verification failed');
      return sendPaymentRequired(reply, 'Invalid payment signature');
    }

    // Check time validity
    const now = Math.floor(Date.now() / 1000);
    if (now < paymentPayload.payload.validAfter || now > paymentPayload.payload.validBefore) {
      return sendPaymentRequired(reply, 'Payment authorization expired or not yet valid');
    }

    fastify.log.info({
      payer: paymentPayload.payload.from,
      amount: paymentPayload.payload.value,
      nonce: paymentPayload.payload.nonce,
    }, 'Payment verified successfully');

    // Execute settlement if enabled
    let settlementResult = null;
    if (settlementService && ENV.ENABLE_SETTLEMENT) {
      fastify.log.info('Executing on-chain settlement...');
      settlementResult = await settlementService.settlePayment(
        addresses.usdc,
        paymentPayload
      );

      if (!settlementResult.success) {
        fastify.log.error({ error: settlementResult.error }, 'Settlement failed');
        return sendPaymentRequired(reply, `Settlement failed: ${settlementResult.error}`);
      }

      fastify.log.info({
        transactionHash: settlementResult.transactionHash,
        blockNumber: settlementResult.blockNumber?.toString(),
        gasUsed: settlementResult.gasUsed?.toString(),
      }, 'Settlement executed successfully');
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
      status: settlementResult?.success ? 'completed' : 'verified',
      transactionHash: settlementResult?.transactionHash || null,
      blockNumber: settlementResult?.blockNumber ? Number(settlementResult.blockNumber) : null,
      gasUsed: settlementResult?.gasUsed ? settlementResult.gasUsed.toString() : null,
      amount: paymentPayload.payload.value,
      token: addresses.usdc,
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
    console.log('Settlement:', ENV.ENABLE_SETTLEMENT ? 'ENABLED (on-chain)' : 'DISABLED (verification only)');
    if (settlementService) {
      console.log('Settlement facilitator:', settlementService.getAddress());
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { CONFIG, validateConfig, EXPLORER_BASE_URL } from './config.js';
import { MandateManager } from './mandate-manager.js';
import { UsageMeter } from './usage-meter.js';
import { SettlementAdapter } from './settlement-adapter.js';
import { ReceiptManager } from './receipt-manager.js';
import { OllamaClient } from './ollama-client.js';
import {
  CreateMandateRequestSchema,
  InferenceRequestSchema,
  InferenceResponse,
} from './types.js';

// Validate configuration on startup
validateConfig();

const fastify = Fastify({ 
  logger: {
    level: CONFIG.NODE_ENV === 'development' ? 'info' : 'warn',
  },
});

// Enable CORS for frontend
fastify.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// Initialize services
const mandateManager = new MandateManager();
const usageMeter = new UsageMeter();
const settlementAdapter = new SettlementAdapter();
const receiptManager = new ReceiptManager();
const ollamaClient = new OllamaClient();

// Health check
fastify.get('/health', async (request, reply) => {
  const ollamaHealthy = await ollamaClient.checkHealth();
  const facilitatorHealthy = await settlementAdapter.checkFacilitatorHealth();
  const quoteServiceHealthy = await settlementAdapter.checkQuoteServiceHealth();

  return {
    status: 'ok',
    services: {
      ollama: ollamaHealthy ? 'healthy' : 'unavailable',
      facilitator: facilitatorHealthy ? 'healthy' : 'unavailable',
      quoteService: quoteServiceHealthy ? 'healthy' : 'unavailable',
    },
    config: {
      model: ollamaClient.getModelName(),
      pricePerMessage: `${CONFIG.PRICE_PER_MESSAGE_MICRO_USDC} micro-USDC`,
      dailyCap: `${CONFIG.DAILY_CAP_MICRO_USDC} micro-USDC`,
      batchThreshold: `${CONFIG.BATCH_THRESHOLD_MESSAGES} messages`,
      merchantAddress: mandateManager.getMerchantAddress(),
    },
  };
});

fastify.get('/status', async (request, reply) => {
  return {
    totalMandates: mandateManager.getAllMandates().length,
    totalEvents: usageMeter.getAllEvents().length,
    totalBatches: usageMeter.getAllBatches().length,
    totalReceipts: receiptManager.getAllReceipts().length,
  };
});

// Mandate Management
fastify.post('/mandate/create', async (request, reply) => {
  try {
    const body = CreateMandateRequestSchema.parse(request.body);

    // Extract client info
    const ipAddress = request.ip;
    const userAgent = request.headers['user-agent'];

    // Create unsigned mandate
    const unsignedMandate = mandateManager.createUnsignedMandate({
      userAddress: body.userAddress,
      dailyCapMicroUsdc: body.dailyCapMicroUsdc,
      sessionId: body.sessionId,
      userAgent,
      ipAddress,
    });

    // Get signing data for frontend
    const signingData = mandateManager.getMandateSigningData(unsignedMandate);

    // Convert BigInt values to strings for JSON serialization
    const serializableSigningData = {
      domain: signingData.domain,
      types: signingData.types,
      primaryType: signingData.primaryType,
      message: {
        mandateId: signingData.message.mandateId,
        userAddress: signingData.message.userAddress,
        merchantAddress: signingData.message.merchantAddress,
        dailyCapMicroUsdc: signingData.message.dailyCapMicroUsdc.toString(),
        pricePerMessageMicroUsdc: signingData.message.pricePerMessageMicroUsdc.toString(),
        batchThreshold: signingData.message.batchThreshold.toString(),
        serviceType: signingData.message.serviceType,
        modelName: signingData.message.modelName,
        expiresAt: signingData.message.expiresAt.toString(),
      },
    };

    fastify.log.info({
      mandateId: unsignedMandate.mandateId,
      userAddress: unsignedMandate.userAddress,
      dailyCap: unsignedMandate.dailyCapMicroUsdc,
    }, 'Created unsigned Intent Mandate');

    return {
      unsignedMandate,
      signingData: serializableSigningData,
      message: 'Unsigned Intent Mandate created. Please sign to activate.',
    };
  } catch (error) {
    fastify.log.error(error, 'Failed to create mandate');
    reply.status(400);
    return {
      error: error instanceof Error ? error.message : 'Failed to create mandate',
    };
  }
});

fastify.post('/mandate/submit', async (request, reply) => {
  try {
    const { unsignedMandate, signature } = request.body as {
      unsignedMandate: any;
      signature: `0x${string}`;
    };

    if (!signature || !signature.startsWith('0x')) {
      reply.status(400);
      return { error: 'Invalid signature format' };
    }

    // Submit signed mandate
    const mandate = await mandateManager.submitSignedMandate(
      unsignedMandate,
      signature
    );

    fastify.log.info({
      mandateId: mandate.mandateId,
      userAddress: mandate.userAddress,
      signatureVerified: true,
    }, 'Intent Mandate signed and verified');

    return {
      mandate,
      message: 'Intent Mandate signed and activated successfully',
    };
  } catch (error) {
    fastify.log.error(error, 'Failed to submit signed mandate');
    reply.status(400);
    return {
      error: error instanceof Error ? error.message : 'Failed to submit signed mandate',
    };
  }
});

fastify.get('/mandate/:mandateId', async (request, reply) => {
  const { mandateId } = request.params as { mandateId: string };
  
  const mandate = mandateManager.getMandate(mandateId);
  if (!mandate) {
    reply.status(404);
    return { error: 'Mandate not found' };
  }

  return { mandate };
});

fastify.get('/mandate/user/:userAddress', async (request, reply) => {
  const { userAddress } = request.params as { userAddress: string };
  
  const mandates = mandateManager.getUserMandates(userAddress);
  
  return { mandates, count: mandates.length };
});

// AI Inference with Metering
fastify.post('/inference', async (request, reply) => {
  try {
    const body = InferenceRequestSchema.parse(request.body);

    // Validate mandate
    const mandate = mandateManager.getMandate(body.mandateId);
    if (!mandate) {
      reply.status(404);
      return { error: 'Mandate not found' };
    }

    if (!mandateManager.isMandateValid(body.mandateId)) {
      reply.status(400);
      return { error: 'Mandate has expired' };
    }

    if (!mandateManager.verifyMandateOwnership(body.mandateId, body.userAddress)) {
      reply.status(403);
      return { error: 'Mandate does not belong to this user' };
    }

    // Check daily cap
    const dailyUsage = usageMeter.getDailyUsage(body.userAddress);
    if (usageMeter.hasExceededDailyCap(body.userAddress, mandate.dailyCapMicroUsdc)) {
      reply.status(429);
      return {
        error: 'Daily spending cap exceeded',
        dailyUsage,
        dailyCap: mandate.dailyCapMicroUsdc,
      };
    }

    // Check if adding this message would exceed cap
    if (dailyUsage + mandate.pricePerMessageMicroUsdc > mandate.dailyCapMicroUsdc) {
      reply.status(429);
      return {
        error: 'This message would exceed daily spending cap',
        dailyUsage,
        dailyCap: mandate.dailyCapMicroUsdc,
        pricePerMessage: mandate.pricePerMessageMicroUsdc,
      };
    }

    fastify.log.info({
      mandateId: body.mandateId,
      userAddress: body.userAddress,
      promptLength: body.prompt.length,
    }, 'Processing inference request');

    // Call Ollama for AI inference
    const ollamaResponse = await ollamaClient.generate({
      prompt: body.prompt,
      temperature: body.temperature,
    });

    // Record usage
    const event = usageMeter.recordUsage({
      mandateId: body.mandateId,
      userAddress: body.userAddress,
      prompt: body.prompt,
      response: ollamaResponse.response,
      modelName: ollamaResponse.model,
      tokensUsed: ollamaResponse.eval_count,
      priceMicroUsdc: mandate.pricePerMessageMicroUsdc,
    });

    fastify.log.info({
      eventId: event.eventId,
      tokensUsed: event.tokensUsed,
      price: event.priceMicroUsdc,
    }, 'Usage recorded');

    // Check if we should trigger batch settlement
    let settlementTriggered = false;
    let batchId: string | undefined;
    let transactionHash: string | undefined;
    let explorerUrl: string | undefined;
    let needsSignature = false;
    let settlementAuthorization = undefined;

    if (usageMeter.shouldTriggerBatch(body.mandateId, mandate.batchThreshold)) {
      fastify.log.info({
        mandateId: body.mandateId,
        threshold: mandate.batchThreshold,
      }, 'Batch threshold reached, triggering settlement');

      // Create batch invoice
      const batch = usageMeter.createBatchInvoice({
        mandateId: body.mandateId,
        userAddress: body.userAddress,
        merchantAddress: mandate.merchantAddress,
      });

      if (batch) {
        batchId = batch.batchId;
        settlementTriggered = true;
        needsSignature = true;

        // Generate unsigned authorization for user to sign
        settlementAuthorization = settlementAdapter.generateSettlementAuthorization({
          from: body.userAddress,
          amountMicroUsdc: batch.totalMicroUsdc,
          batchId: batch.batchId,
        });

        fastify.log.info({
          batchId: batch.batchId,
          amount: batch.totalMicroUsdc,
        }, 'Settlement authorization generated, waiting for user signature');
      }
    }

    // Build response
    const response: InferenceResponse = {
      eventId: event.eventId,
      response: ollamaResponse.response,
      priceMicroUsdc: event.priceMicroUsdc,
      dailyUsageMicroUsdc: usageMeter.getDailyUsage(body.userAddress),
      dailyCapMicroUsdc: mandate.dailyCapMicroUsdc,
      messagesUntilSettlement: usageMeter.getMessagesUntilSettlement(
        body.mandateId,
        mandate.batchThreshold
      ),
      settlementTriggered,
      batchId,
      transactionHash,
      explorerUrl,
      needsSignature,
      settlementAuthorization,
    };

    return response;
  } catch (error) {
    fastify.log.error(error, 'Inference request failed');
    reply.status(500);
    return {
      error: error instanceof Error ? error.message : 'Inference failed',
    };
  }
});

// Usage & Receipt Queries
fastify.get('/usage/user/:userAddress', async (request, reply) => {
  const { userAddress } = request.params as { userAddress: string };
  
  const dailyUsage = usageMeter.getDailyUsage(userAddress);
  const batches = usageMeter.getUserBatches(userAddress);
  const receipts = receiptManager.getUserReceipts(userAddress);

  return {
    userAddress,
    dailyUsage,
    totalBatches: batches.length,
    totalReceipts: receipts.length,
    batches,
    receipts,
  };
});

fastify.get('/batch/:batchId', async (request, reply) => {
  const { batchId } = request.params as { batchId: string };
  
  const batch = usageMeter.getBatch(batchId);
  if (!batch) {
    reply.status(404);
    return { error: 'Batch not found' };
  }

  const receipt = receiptManager.getReceiptForBatch(batchId);

  return { batch, receipt };
});

fastify.get('/receipt/:receiptId', async (request, reply) => {
  const { receiptId } = request.params as { receiptId: string };
  
  const receipt = receiptManager.getReceipt(receiptId);
  if (!receipt) {
    reply.status(404);
    return { error: 'Receipt not found' };
  }

  return { receipt };
});

// Complete Settlement with User Signature
fastify.post('/settlement/complete', async (request, reply) => {
  try {
    const { batchId, signature, userAddress, authorization } = request.body as {
      batchId: string;
      signature: `0x${string}`;
      userAddress: string;
      authorization: any; // The exact authorization data that was signed
    };

    if (!batchId || !signature || !userAddress || !authorization) {
      reply.status(400);
      return { error: 'Missing required fields: batchId, signature, userAddress, authorization' };
    }

    // Get the batch
    const batch = usageMeter.getBatch(batchId);
    if (!batch) {
      reply.status(404);
      return { error: 'Batch not found' };
    }

    if (batch.status !== 'pending') {
      reply.status(400);
      return { error: `Batch is already ${batch.status}` };
    }

    // Get the mandate
    const mandate = mandateManager.getMandate(batch.mandateId);
    if (!mandate) {
      reply.status(404);
      return { error: 'Mandate not found' };
    }

    // Update batch status to settling
    usageMeter.updateBatchStatus({
      batchId: batch.batchId,
      status: 'settling',
    });

    // Execute settlement with user signature and the exact authorization they signed
    const settlementResult = await settlementAdapter.settlePaymentWithAuth({
      authorization,
      signature,
    });

    if (settlementResult.success && settlementResult.transactionHash) {
      // Update batch as settled
      usageMeter.updateBatchStatus({
        batchId: batch.batchId,
        status: 'settled',
        transactionHash: settlementResult.transactionHash,
        blockNumber: settlementResult.blockNumber ? Number(settlementResult.blockNumber) : undefined,
      });

      // Create receipt
      const receipt = receiptManager.createReceipt({
        batch,
        transactionHash: settlementResult.transactionHash,
        blockNumber: settlementResult.blockNumber ? Number(settlementResult.blockNumber) : 0,
        gasUsed: settlementResult.gasUsed?.toString(),
        modelName: mandate.modelName,
      });

      fastify.log.info({
        batchId: batch.batchId,
        transactionHash: settlementResult.transactionHash,
        receiptId: receipt.receiptId,
      }, 'Settlement completed successfully');

      return {
        success: true,
        transactionHash: settlementResult.transactionHash,
        explorerUrl: `${EXPLORER_BASE_URL}/tx/${settlementResult.transactionHash}`,
        receiptId: receipt.receiptId,
      };
    } else {
      // Update batch as failed
      usageMeter.updateBatchStatus({
        batchId: batch.batchId,
        status: 'failed',
        errorMessage: settlementResult.error,
      });

      fastify.log.error({
        batchId: batch.batchId,
        error: settlementResult.error,
      }, 'Settlement failed');

      reply.status(500);
      return {
        success: false,
        error: settlementResult.error,
      };
    }
  } catch (error) {
    fastify.log.error(error, 'Settlement completion failed');
    reply.status(500);
    return {
      error: error instanceof Error ? error.message : 'Settlement completion failed',
    };
  }
});

// Start Server
const start = async () => {
  try {
    // Check service health on startup
    const ollamaHealthy = await ollamaClient.checkHealth();
    const facilitatorHealthy = await settlementAdapter.checkFacilitatorHealth();
    const quoteServiceHealthy = await settlementAdapter.checkQuoteServiceHealth();

    console.log('\nAP2 AI Inference Metering Service');
    console.log('=====================================');
    console.log(`Port: ${CONFIG.PORT}`);
    console.log(`Merchant: ${mandateManager.getMerchantAddress()}`);
    console.log(`Model: ${ollamaClient.getModelName()}`);
    console.log(`Price: ${CONFIG.PRICE_PER_MESSAGE_MICRO_USDC} micro-USDC per message`);
    console.log(`Daily Cap: ${CONFIG.DAILY_CAP_MICRO_USDC} micro-USDC`);
    console.log(`Batch Threshold: ${CONFIG.BATCH_THRESHOLD_MESSAGES} messages`);
    console.log('\nService Health:');
    console.log(`  Ollama: ${ollamaHealthy ? 'OK' : 'FAIL'} (${CONFIG.OLLAMA_URL})`);
    console.log(`  Facilitator: ${facilitatorHealthy ? 'OK' : 'FAIL'} (${CONFIG.FACILITATOR_URL})`);
    console.log(`  Quote Service: ${quoteServiceHealthy ? 'OK' : 'FAIL'} (${CONFIG.QUOTE_SERVICE_URL})`);
    console.log('\nEndpoints:');
    console.log('  POST /mandate/create    - Create Intent Mandate');
    console.log('  POST /inference         - AI inference with metering');
    console.log('  GET  /health            - Service health check');
    console.log('  GET  /usage/user/:addr  - User usage & receipts');

    if (!ollamaHealthy) {
      console.warn('Warning: Ollama is not available. Make sure it\'s running on', CONFIG.OLLAMA_URL);
    }

    if (!facilitatorHealthy || !quoteServiceHealthy) {
      console.warn('Warning: x402 services not available. Settlements will fail.');
      console.warn('Make sure quote-service and facilitator are running.');
    }

    await fastify.listen({ port: CONFIG.PORT, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Cleanup on shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await fastify.close();
  process.exit(0);
});

start();

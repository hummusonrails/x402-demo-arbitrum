# AP2 AI Inference Metering Service

A complete demonstration of the [AP2 protocol](https://github.com/google-agentic-commerce/AP2) (Agentic Protocol 2) integrated with [x402](https://www.x402.org/) for metered AI inference with on-chain settlement on Arbitrum Sepolia.

## Overview

This service implements a local, end-to-end demo showcasing:

- **AI Inference Metering**: Each chat message with a local Ollama model is priced in micro-USDC
- **Intent Mandates**: User authorization for AI services following AP2 "human not present" patterns
- **Batch Settlement**: Automatic on-chain payment every 5 messages via x402 protocol
- **Payment Receipts**: AP2-compliant Payment Mandates with transaction hashes and usage details

## Architecture

```
┌─────────────────┐     Chat UI      ┌─────────────────┐     Ollama API    ┌─────────────────┐
│                 │ ───────────────► │                 │ ────────────────► │                 │
│  React Frontend │                  │  AP2 Backend    │                   │  Ollama (Docker)│
│  (Wagmi/Viem)   │ ◄─────────────── │  (Fastify)      │ ◄──────────────── │  llama3.1:8b    │
│                 │   AI Response    │                 │   AI Response     │                 │
└─────────────────┘                  └─────────────────┘                   └─────────────────┘
         │                                    │
         │                                    │ Every 5 messages
         │                                    ▼
         │                           ┌─────────────────┐
         │                           │ Batch Invoice   │
         │                           │ (Usage Events)  │
         │                           └─────────────────┘
         │                                    │
         │                                    │ x402 Settlement
         │                                    ▼
         │                           ┌─────────────────┐     Verify/Settle    ┌─────────────────┐
         │                           │  Quote Service  │ ──────────────────► │   Facilitator   │
         │                           │   (:3001)       │                     │     (:3002)     │
         │                           └─────────────────┘                     └─────────────────┘
         │                                                                             │
         │                                                                             │
         ▼                                                                             ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 Arbitrum Sepolia Network (421614)                            │
│  ┌─────────────────┐                                           ┌─────────────────┐          │
│  │   TestUSDC      │                                           │ EIP-3009        │          │
│  │   Contract      │ ◄───────────────────────────────────────► │ Settlement      │          │
│  └─────────────────┘                                           └─────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/)
- [Docker](https://www.docker.com/) for running a local AI service
- Arbitrum Sepolia ETH for gas fees
- Deployed x402 contracts (TestUSDC, QuoteRegistry, ComposableExecutor)
- Running x402 services (quote-service on :3001, facilitator on :3002)
- **Merchant registration with the facilitator operator** (see below)

## Merchant Registration

**IMPORTANT**: Before using this service, you must register as a merchant with the facilitator operator.

The facilitator now requires authentication and merchant registration. See the [x402 Facilitator documentation](https://github.com/hummusonrails/x402-facilitator) for setup instructions.

To register as a merchant, contact the facilitator operator to:

1. **Register Your Merchant Address**: Provide your merchant wallet address (the address that will receive payments after fees)
2. **Receive API Credentials**: The operator will provide you with:
   - `MERCHANT_API_KEY`: Your unique API key for authenticated settlement requests
   - `FACILITATOR_URL`: The facilitator service endpoint URL
   
Note: The facilitator's wallet address is provided dynamically via the `/requirements` endpoint, so you don't need to configure it. Fee information (`SERVICE_FEE_BPS` and `GAS_FEE_USDC`) is also returned by the facilitator.

3. **Database Setup** (if self-hosting facilitator): The facilitator uses a database to track merchants and payments. You'll need to set up PostgreSQL and configure the `DATABASE_URL` environment variable.

### Facilitator Merchant Store

If you're running your own facilitator, merchants are stored in a database with the following structure:
- **address**: Merchant wallet address (0x...)
- **name**: Merchant name/identifier
- **apiKeyHash**: Bcrypt hash of the API key
- **enabled**: Whether the merchant is enabled for settlements
- **createdAt**: Registration timestamp

The facilitator operator can add merchants using the merchant management CLI or database tools.

## Installation

### 0. Deploy x402 Contracts First (Required)

**Before setting up AP2, you must deploy the x402 smart contracts.**

From the **monorepo root**:

```bash
# Deploy contracts to Arbitrum Sepolia
pnpm x402:deploy

# Seed test tokens
pnpm x402:seed
```

This creates `x402-service/out/addresses.sepolia.json` with the TestUSDC address you'll need in step 2.

See [x402-service/README.md](../x402-service/README.md) for detailed deployment instructions.

### 1. Install Dependencies

From the **monorepo root**:

```bash
# Install all workspace dependencies
pnpm install
```

Or install individually:

```bash
# Install ap2-service backend
pnpm --filter ap2-service install

# Install ap2-frontend
pnpm --filter ap2-frontend install
```

### 2. Set Up Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
# Network Configuration (CAIP-2)
NETWORK=eip155:421614  # eip155:42161 (Arbitrum One) or eip155:421614 (Arbitrum Sepolia)
ARBITRUM_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc  # Or use ARBITRUM_SEPOLIA_RPC_URL
MERCHANT_PRIVATE_KEY=0x...  # Merchant wallet that receives payments (after facilitator fees)

# x402 External Facilitator Integration
# IMPORTANT: You must be registered as a merchant first! See "Merchant Registration" above.
FACILITATOR_URL=http://localhost:3002  # Or external facilitator URL
MERCHANT_API_KEY=your-api-key  # API key provided by facilitator operator (REQUIRED)
QUOTE_SERVICE_URL=http://localhost:3001

# Note: Facilitator address is provided dynamically by the /requirements endpoint
# Requirements are delivered via PAYMENT-RESPONSE header (mirrored to X-PAYMENT-RESPONSE)

# USDC Token
# For Arbitrum Sepolia: Use TestUSDC address from x402-service deployment
USDC_ADDRESS=0x...  # USDC contract address

# Ollama Configuration
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b

# Metering Configuration
PRICE_PER_MESSAGE_MICRO_USDC=100  # 0.0001 USDC per message
DAILY_CAP_MICRO_USDC=10000000     # 10 USDC daily cap
BATCH_THRESHOLD_MESSAGES=5         # Settle every 5 messages
BATCH_TIMEOUT_SECONDS=3600         # Or settle after 1 hour

# Server Configuration
PORT=3003
NODE_ENV=development
```

### 3. Start Ollama with Docker

From the **monorepo root**:

```bash
# Start Ollama container
pnpm ap2:docker:up

# Wait for Ollama to be ready
pnpm --filter ap2-service docker:logs

# Pull the model (first time only)
pnpm ap2:ollama:pull
```

Or directly from ap2-service directory:

```bash
cd ap2-service
docker-compose up -d
docker exec -it ap2-ollama ollama pull llama3.1:8b
```

Verify Ollama is running:
```bash
curl http://localhost:11434/api/tags
```

### 4. Ensure x402 Services Are Running

From the **monorepo root**:

```bash
# Terminal 1: Start facilitator
pnpm x402:facilitator

# Terminal 2: Start quote service
pnpm x402:service

# Or start both together
pnpm dev:x402
```

Or from x402-service directory:

```bash
cd x402-service
pnpm dev:facilitator  # Terminal 1 - runs on :3002
pnpm dev:service      # Terminal 2 - runs on :3001
```

## Usage

### Start the AP2 Service

From the **monorepo root**:

```bash
# Start backend
pnpm ap2:backend

# Start frontend (in another terminal)
pnpm ap2:frontend

# Or start both together
pnpm dev:ap2

# Or start EVERYTHING (x402 + ap2)
pnpm dev:all
```

Or from ap2-service directory:

```bash
cd ap2-service

# Start backend
pnpm dev  # Starts on :3003

# Start frontend (in another terminal)
cd frontend
pnpm dev  # Starts on :5173
```

### Access the Application

1. Open http://localhost:5173 in your browser
2. Click "Connect Wallet" and connect to Arbitrum Sepolia
3. The service will automatically create an Intent Mandate for your wallet
4. Start chatting with the AI privately without sending any messages to an external service

### How It Works

1. **Connect Wallet**: Connect your wallet to Arbitrum Sepolia (Chain ID: 421614)
2. **Mandate Creation**: An Intent Mandate is automatically created with your spending limits
3. **Chat with AI**: Each message costs 100 micro-USDC (0.0001 USDC)
4. **Usage Tracking**: The service tracks your usage and enforces caps
5. **Batch Settlement**: After 5 messages, the service:
   - Creates a batch invoice
   - Calls the x402 facilitator to settle payment on-chain
   - Records a Payment Mandate receipt with the transaction hash
6. **View Transactions**: Click the explorer link to see your settlement on Arbiscan

## API Endpoints

### Backend API (:3003)

```bash
# Health check
GET /health

# Service status
GET /status

# Create Intent Mandate
POST /mandate/create
Body: { userAddress, dailyCapMicroUsdc?, sessionId }

# Submit signed Intent Mandate
POST /mandate/submit
Body: { unsignedMandate, signature }

# Get mandate
GET /mandate/:mandateId

# Get user mandates
GET /mandate/user/:userAddress

# AI inference with metering
POST /inference
Body: { mandateId, userAddress, prompt, temperature? }

# Get user usage and receipts
GET /usage/user/:userAddress

# Get batch details
GET /batch/:batchId

# Get receipt
GET /receipt/:receiptId
```

## Project Structure

```
ap2-service/
├── src/
│   ├── server.ts              # Main Fastify server
│   ├── config.ts              # Configuration and environment
│   ├── types.ts               # TypeScript type definitions
│   ├── mandate-manager.ts     # Intent Mandate creation and storage
│   ├── usage-meter.ts         # Usage tracking and batch invoicing
│   ├── settlement-adapter.ts  # x402 settlement integration
│   ├── receipt-manager.ts     # Payment Mandate receipts
│   └── ollama-client.ts       # Ollama API client
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Main React component
│   │   ├── main.tsx           # Entry point with Wagmi providers
│   │   ├── wagmi.ts           # Wagmi configuration
│   │   ├── api.ts             # Backend API client
│   │   └── types.ts           # Frontend type definitions
│   ├── package.json
│   └── vite.config.ts
├── docker-compose.yml         # Ollama container
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Configuration

### Metering Settings

Adjust in `.env`:

- `PRICE_PER_MESSAGE_MICRO_USDC`: Cost per AI inference (default: 100 = 0.0001 USDC)
- `DAILY_CAP_MICRO_USDC`: Maximum daily spending (default: 10000000 = 10 USDC)
- `BATCH_THRESHOLD_MESSAGES`: Messages before settlement (default: 5)
- `BATCH_TIMEOUT_SECONDS`: Maximum time before settlement (default: 3600 = 1 hour)

### Ollama Model

Change the model in `.env`:

```bash
OLLAMA_MODEL=llama3.1:8b  # Or any other Ollama model
```

Available models: https://ollama.com/library

## Troubleshooting

### Ollama Not Available

```bash
# Check if Ollama is running
docker ps | grep ollama

# View Ollama logs
docker-compose logs ollama

# Restart Ollama
docker-compose restart ollama

# Pull model again
docker exec -it ap2-ollama ollama pull llama3.1:8b
```

### x402 Services Not Available

Make sure both services are running:

```bash
# Check quote service
curl http://localhost:3001/health

# Check facilitator
curl http://localhost:3002/supported
```

### Wrong Network

The app requires Arbitrum Sepolia (Chain ID: 421614). Add it to your wallet:

- **Network Name**: Arbitrum Sepolia
- **RPC URL**: https://sepolia-rollup.arbitrum.io/rpc
- **Chain ID**: 421614
- **Currency Symbol**: ETH
- **Block Explorer**: https://sepolia.arbiscan.io

### Settlement Fails

Common causes:
- Insufficient USDC balance in user wallet
- x402 services not running
- Invalid contract addresses in `.env`
- Network connectivity issues
- **Missing or invalid `MERCHANT_API_KEY`**
- **Merchant not registered with facilitator**

Check backend logs for detailed error messages.

### Authentication Errors (401/403)

If you see `401 Unauthorized` or `403 Forbidden` errors from the facilitator:

1. **Verify Merchant Registration**: Ensure you're registered with the facilitator operator
2. **Check API Key**: Confirm your `MERCHANT_API_KEY` in `.env` is correct
3. **Check Merchant Status**: Your merchant account may be disabled - contact the operator
4. **Verify Merchant Address**: Ensure `MERCHANT_PRIVATE_KEY` matches the registered merchant address

Example error messages:
- `"Missing X-API-Key header"` → Add `MERCHANT_API_KEY` to `.env`
- `"Invalid API key"` → Check that your API key is correct
- `"Merchant account disabled"` → Contact facilitator operator
- `"Merchant not registered"` → Complete merchant registration first

## Development

### Build

```bash
# Build backend
pnpm build:backend

# Build frontend
pnpm build:frontend

# Build both
pnpm build
```

### Type Checking

```bash
pnpm typecheck
```

### Clean Start

```bash
# Stop all services
docker-compose down

# Remove Ollama data
docker volume rm ap2-service_ollama_data

# Reinstall dependencies
rm -rf node_modules frontend/node_modules
pnpm install
cd frontend && pnpm install
```

## Resources

- [AP2 Protocol Documentation](https://github.com/google-agentic-commerce/AP2)
- [AP2 Specification](https://github.com/google-agentic-commerce/AP2/blob/main/docs/specification.md)
- [x402 Protocol](https://www.x402.org/)
- [x402 GitHub](https://github.com/coinbase/x402)
- [Ollama Documentation](https://ollama.com/)
- [Docker Model Runner](https://docs.docker.com/ai/model-runner/)
- [Wagmi Documentation](https://wagmi.sh/)
- [Arbitrum Sepolia](https://sepolia.arbiscan.io/)

## License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.

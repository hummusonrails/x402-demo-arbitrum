# x402 + AP2 Demo on Arbitrum Sepolia

A complete monorepo demonstrating the [x402 protocol](https://www.x402.org/) and [AP2 protocol](https://github.com/google-agentic-commerce/AP2) for metered AI inference with on-chain settlement on Arbitrum Sepolia.

## Overview

This monorepo contains two integrated services:

### **x402-service** - Payment Protocol Infrastructure
Implementation of x402 for HTTP 402 Payment Required responses with:
- Quote service for swap quotes
- Custom facilitator for Arbitrum Sepolia
- EIP-3009 payment authorizations
- On-chain settlement with custom token deployed on Arbitrum Sepolia

### **ap2-service** - AI Inference Metering
Complete AP2 protocol implementation with:
- Intent Mandates for user authorization
- Metered AI inference with local AI service
- Batch settlement every 5 messages via x402
- Payment Mandates (receipts) with transaction hashes

## Quick Start

### Prerequisites

- Node.js 20+ and pnpm
- [Foundry](https://getfoundry.sh/) for smart contract deployment
- Docker (for Ollama AI service)
- Arbitrum Sepolia wallet with Sepolia ETH for gas fees

### Installation & Setup

Follow these steps in order:

#### 1. Install Dependencies

```bash
pnpm install
```

#### 2. Configure Environment Variables

Set up environment variables for both services:

```bash
# x402-service configuration
cp x402-service/.env.example x402-service/.env

# ap2-service configuration
cp ap2-service/.env.example ap2-service/.env
```

Edit the `.env` files with your wallet private keys and RPC URLs. See individual service READMEs for detailed configuration.
Note: The x402 flow now uses CAIP-2 network IDs and returns requirements in the `PAYMENT-RESPONSE` header (mirrored to `X-PAYMENT-RESPONSE`).

#### 3. Deploy Smart Contracts (Required First Step)

**This step must be completed before running the services.**

Deploy TestUSDC, TestWETH, QuoteRegistry, MockAdapter, and ComposableExecutor contracts to Arbitrum Sepolia:

```bash
pnpm x402:deploy
```

This creates `x402-service/out/addresses.sepolia.json` with deployed contract addresses.

#### 4. Seed Test Tokens

Mint test USDC and WETH tokens to your wallet:

```bash
pnpm x402:seed
```

#### 5. Start Ollama (for AP2 AI Inference)

Start the Docker container and pull the AI model:

```bash
# Start Ollama container
pnpm ap2:docker:up

# Pull the AI model (first time only)
pnpm ap2:ollama:pull
```

Verify Ollama is running:
```bash
curl http://localhost:11434/api/tags
```

#### 6. Run the Services

You have several options:

**Run everything together:**
```bash
pnpm dev:all
```

**Run x402 services only:**
```bash
pnpm dev:x402
```

**Run AP2 services only:**
```bash
pnpm dev:ap2
```

**Run services individually:**
```bash
# x402 services
pnpm x402:facilitator    # Custom facilitator on :3002
pnpm x402:service        # Quote service on :3001

# AP2 services
pnpm ap2:backend         # AP2 backend on :3003
pnpm ap2:frontend        # React frontend on :5173
```

### Testing

Test the x402 payment flow:
```bash
pnpm --filter x402-service pay test-x402
```

Access the AP2 chat interface at http://localhost:5173

### Documentation

- **[x402-service/README.md](./x402-service/README.md)** - x402 documentation
- **[ap2-service/README.md](./ap2-service/README.md)** - AP2 documentation

## Architecture

```
┌─────────────────┐
│   AP2 Service   │
│  (Agent Layer)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  x402 Service   │
│ (Payment Layer) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Arbitrum Sepolia│
│    Network      │
└─────────────────┘
```

## Available Scripts Reference

### Setup Scripts (Run Once)
- **`pnpm x402:deploy`** - Deploy smart contracts to Arbitrum Sepolia (TestUSDC, TestWETH, etc.)
- **`pnpm x402:seed`** - Mint test tokens to your wallet
- **`pnpm ap2:docker:up`** - Start Ollama Docker container
- **`pnpm ap2:docker:down`** - Stop Ollama Docker container
- **`pnpm ap2:ollama:pull`** - Pull the AI model (llama3.1:8b)

### Development Scripts
- **`pnpm dev:all`** - Run all services together (x402 + AP2)
- **`pnpm dev:x402`** - Run x402 facilitator and quote service
- **`pnpm dev:ap2`** - Run AP2 backend and frontend
- **`pnpm x402:facilitator`** - Run x402 facilitator only (port 3002)
- **`pnpm x402:service`** - Run x402 quote service only (port 3001)
- **`pnpm ap2:backend`** - Run AP2 backend only (port 3003)
- **`pnpm ap2:frontend`** - Run AP2 frontend only (port 5173)

### Testing & Utilities
- **`pnpm --filter x402-service pay test-x402`** - Test x402 payment flow
- **`pnpm --filter x402-service pay pay --swap ...`** - Execute a paid swap

## Troubleshooting

### "Contract addresses not found"
Make sure you've deployed the contracts:
```bash
pnpm x402:deploy
```

### "Insufficient balance" errors
Seed your wallet with test tokens:
```bash
pnpm x402:seed
```

### Ollama not responding
Verify Docker container is running:
```bash
docker ps | grep ollama
pnpm ap2:docker:up
```

### Services not connecting
Ensure all required services are running in the correct order:
1. Deploy contracts (`pnpm x402:deploy`)
2. Start Ollama (`pnpm ap2:docker:up`)
3. Start x402 services (`pnpm dev:x402`)
4. Start AP2 services (`pnpm dev:ap2`)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

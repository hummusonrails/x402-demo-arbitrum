# Payment Flow with x402 Standard on Arbitrum 

An implementation of the [x402 standard](https://www.x402.org/) for HTTP 402 Payment Required responses, demonstrating swap execution on Arbitrum (Arbitrum One by default; Sepolia supported) with EIP-3009 payment signatures and on-chain settlement.

## What is X402?

[X402](https://www.x402.org/) is a protocol that activates `HTTP 402 Payment Required responses` for machine-to-machine payments. It enables:

- **Automatic payments** for API access
- **Gasless transactions** via EIP-3009 payment authorization
- **Standardized payment flows** across web services
- **AI agent payments** with seamless integration

This project showcases x402 by requiring signed payment authorizations for swap quote generation, then executing the swap on-chain.

## Architecture

```
┌─────────────────┐    HTTP 402     ┌─────────────────┐    Verify/Settle    ┌─────────────────┐
│                 │ ──────────────► │                 │ ──────────────────► │                 │
│  X402 Client    │                 │  Quote Service  │                     │Custom Facilitator│
│  (auto-pay)     │ ◄────────────── │  (requires pay) │ ◄────────────────── │ (NETWORK-config) │
│                 │    Quote + Proof│                 │    Payment Confirmed│                 │
└─────────────────┘                 └─────────────────┘                     └─────────────────┘
         │                                   │                                       │
         │                                   │                                       │
         ▼                                   ▼                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 Arbitrum Network (NETWORK env)                               │
│  ┌─────────────────┐                                           ┌─────────────────┐          │
│  │                 │                                           │                 │          │
│  │   Swap Execution│                                           │ Smart Contracts │          │
│  │                 │                                           │ (Verify & Swap) │          │
│  └─────────────────┘                                           └─────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/)
- [Foundry](https://getfoundry.sh/) for smart contract deployment
- Arbitrum Sepolia ETH or Arbitrum One ETH for gas fees (match `NETWORK`)
- Custom USDC and WETH contracts on the configured Arbitrum network

## Installation

1. **Clone and install dependencies**:
```bash
git clone https://github.com/hummusonrails/x402-demo-arbitrum.git
cd x402-demo-arbitrum/x402-service
pnpm install
```

2. **Set up environment variables**:
```bash
cp .env.example .env
```

Edit `.env` with your values:
```bash
# Required
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc  # Preferred; overrides ARBITRUM_SEPOLIA_RPC_URL when set
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
NETWORK=eip155:42161  # eip155:42161 (Arbitrum One) or eip155:421614 (Arbitrum Sepolia)
FACILITATOR_URL=http://localhost:3002
MERCHANT_API_KEY=your-merchant-api-key # Required for facilitator /settle
PRIVATE_KEY=0x... # Your wallet private key (needs ETH for gas on the configured network)
QUOTE_SERVICE_PRIVATE_KEY=0x... # Separate wallet private key for quote service signing
ENABLE_SETTLEMENT=false       # Set to 'true' to execute payments on-chain
```

## Deployment

1. **Deploy smart contracts**:
```bash
pnpm run deploy
```

This deploys:
- TestUSDC and TestWETH tokens
- QuoteRegistry for replay protection
- MockAdapter for swaps
- ComposableExecutor for quote verification

2. **Seed with test tokens**:
```bash
pnpm run seed
```

This mints tokens to your wallet for testing.

3. **Verify deployment**:
```bash
cat out/addresses.arbitrum.json

# For Arbitrum Sepolia, use:
# cat out/addresses.sepolia.json
```

Should show deployed contract addresses.

## Usage

### 1. Start the Custom X402 Facilitator

```bash
pnpm dev:facilitator
```

The facilitator will start on `http://localhost:3002` and provide:
- Payment verification for the configured network
- EIP-3009 payment settlement
- USDC transfer authorization handling

### 2. Start the X402 Quote Service

```bash
pnpm dev:service
```

The service will start on `http://localhost:3001` and:
- Return HTTP 402 for unpaid requests
- Accept payments via x402 protocol using the custom facilitator
- Provide signed quotes after payment

### 3. Test X402 Payment Flow

```bash
pnpm pay test-x402
```

This demonstrates:
1. Request without payment returns `HTTP 402 Payment Required`
2. Automatic payment handling via the local x402 client utilities
3. Successful quote retrieval with payment proof

### 4. Execute Paid Swap

```bash
pnpm pay pay --swap --sell USDC --buy WETH --amount 25 --max-slippage 0.3
```

Full flow:
1. **Payment**: Automatically pays 0.001 USDC for quote
2. **Quote**: Receives signed swap quote
3. **Approval**: Approves token spending if needed
4. **Swap**: Executes on-chain swap with quote
5. **Verification**: Shows transaction details and events

### Available Commands

```bash
# Development
pnpm dev:facilitator      # Start custom x402 facilitator
pnpm dev:service          # Start x402 quote service
pnpm pay test-x402        # Test payment flow
pnpm build               # Compile TypeScript

# Smart Contracts  
pnpm run deploy          # Deploy contracts (default: Arbitrum Sepolia)
pnpm seed                # Mint test tokens
pnpm test:sol            # Run Solidity tests

# Swaps
pnpm pay pay --swap --sell USDC --buy WETH --amount 25 --max-slippage 0.3
pnpm pay pay --swap --sell WETH --buy USDC --amount 0.01 --max-slippage 0.5
```

## Payment Flow Details

### 1. Initial Request (No Payment)
```bash
curl -X POST http://localhost:3001/quote \
  -H "Content-Type: application/json" \
  -d '{"from":"0x...","sell":"0x...","buy":"0x...","sellAmount":"1000000","maxSlippageBps":30,"deadline":1234567890,"chainId":421614,"nonce":"0x..."}'

Note: Replace `chainId` with the numeric chain ID that matches `NETWORK` (421614 for Sepolia, 42161 for Arbitrum One).
```

**Response: HTTP 402 (X402-Compliant)**

The server returns requirements in the `PAYMENT-RESPONSE` header (mirrored to `X-PAYMENT-RESPONSE` for legacy clients). The body is still JSON but clients should read the header first.

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:421614",
    "maxAmountRequired": "1000",
    "resource": "/quote",
    "description": "Payment for swap quote generation",
    "mimeType": "application/json",
    "outputSchema": null,
    "payTo": "0x...",
    "maxTimeoutSeconds": 300,
    "asset": "0x...",
    "extra": {
      "name": "TestUSDC",
      "version": "1"
    }
  }],
  "facilitator": {
    "url": "http://localhost:3002"
  }
}
```

### 2. Automatic Payment with EIP-3009 Signatures

The client automatically:
1. **Creates EIP-3009 payment authorization** with proper parameters
2. **Signs with EIP-712** using the wallet private key
3. **Encodes as base64** and adds to `X-Payment` header (legacy) and sends the SDK request in `PAYMENT-SIGNATURE`
4. **Retries request** with signed payment payload
5. **Server verifies signature** locally (checks signer, amount, recipient, timing)
6. **Receives quote** with `X-Payment-Response` confirmation

**X-Payment Header Structure (legacy):**
```json
{
  "x402Version": 2,
  "scheme": "exact",
  "network": "eip155:421614",
  "payload": {
    "from": "0x...",
    "to": "0x...",
    "value": "1000",
    "validAfter": 1234567890,
    "validBefore": 1234568190,
    "nonce": "0x...",
    "v": 27,
    "r": "0x...",
    "s": "0x..."
  }
}
```

## File Structure

```
├── app/
│   ├── agent.ts          # Swap orchestration logic
│   ├── cli.ts            # X402 compliant CLI interface
│   ├── client.ts         # X402 client with EIP-3009 signatures
│   ├── config.ts         # Environment and contract config
│   ├── eip3009.ts        # EIP-3009 signature utilities
│   └── types.ts          # TypeScript type definitions
├── contracts/
│   ├── ComposableExecutor.sol    # Main swap execution contract
│   ├── QuoteRegistry.sol         # Nonce tracking for replay protection
│   ├── Token/
│   │   ├── TestUSDC.sol         # Test USDC with EIP-3009
│   │   └── TestWETH.sol         # Test WETH with EIP-3009
│   └── adapters/
│       ├── IAdapter.sol         # Adapter interface
│       └── MockAdapter.sol      # Mock DEX adapter
├── services/
│   └── quote-service/
│       ├── server.ts            # X402 compliant with signature verification
│       ├── facilitator.ts       # X402 facilitator integration
│       └── signer.ts           # EIP-712 quote signing
├── script/
│   ├── Deploy.s.sol            # Contract deployment script
│   └── Seed.s.sol              # Token minting script
└── test/
    └── Executor.t.sol          # Smart contract tests
```

## Troubleshooting

### Common Issues

1. **"forge-std not found"**:
```bash
git submodule update --init --recursive
```

2. **"Contract addresses not found"**:
```bash
pnpm run deploy
```

3. **"Insufficient balance" during swap**:
```bash
pnpm seed
```

4. **"Payment verification failed"**:
- Ensure you have a USDC/TestUSDC contract deployed on the configured network: `pnpm run deploy` (Sepolia) or use mainnet USDC for Arbitrum One
- Check that the facilitator service is accessible: `pnpm dev:facilitator`
- Verify your private key has sufficient balance: `pnpm seed`

5. **"Transaction reverted"**:
- Check token approvals
- Verify slippage settings
- Ensure quote hasn't expired

## Development

### Running Tests

```bash
# Solidity tests
pnpm test:sol

# TypeScript compilation check
pnpm check

# Build project
pnpm build
```

### Adding New Payment Methods

1. Update `x402-service/services/facilitator/requirements.ts` with new payment scheme
2. Add token configuration in `x402-service/services/facilitator/config.ts`
3. Update payment handling in `x402-service/services/quote-service/server.ts`
4. Test with new token addresses

## Manual Verification (Facilitator v2)

1. **GET /supported**
```bash
curl http://localhost:3002/supported
```
Confirm `versions["2"].kinds` includes the configured network (e.g., `eip155:421614` or `eip155:42161`) and `payTo`.

2. **POST /requirements**
```bash
curl -i -X POST http://localhost:3002/requirements -H "Content-Type: application/json" -d '{"amount":"1000"}'
```
Confirm status 402 and `PAYMENT-RESPONSE` header with `x402Version: 2` and `accepts[0].payTo/maxAmountRequired/asset/network`.

3. **Merchant 402 headers**
```bash
curl -i -X POST http://localhost:3001/quote -H "Content-Type: application/json" -d '{"type":"payment.swap.quote.intent","from":"0x...","sell":"0x...","buy":"0x...","sellAmount":"1000000","maxSlippageBps":30,"recipient":"0x...","deadline":1234567890,"chainId":421614,"nonce":"0x..."}'
```
Confirm `PAYMENT-RESPONSE` and `X-PAYMENT-RESPONSE` headers are present.

4. **Settlement (requires X-API-Key)**
Confirm the quote-service is configured with `MERCHANT_API_KEY` and that `/settle` requests succeed against the facilitator.

## Resources

- [X402 Protocol](https://www.x402.org/) - Official protocol documentation
- [X402 Facilitator](https://github.com/hummusonrails/x402-facilitator) - Facilitator reference implementation
- [Arbitrum Sepolia](https://sepolia.arbiscan.io/) - Block explorer (Sepolia)
- [Arbitrum One](https://arbiscan.io/) - Block explorer (mainnet)
- [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009) - Transfer with authorization standard

## License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.

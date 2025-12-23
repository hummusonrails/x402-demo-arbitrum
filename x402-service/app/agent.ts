import { keccak256, encodePacked, parseUnits, formatUnits } from 'viem';
import { PaymentSwapQuoteIntent, QuoteStruct, SwapOptions } from './types';
import { X402QuoteClient } from './client';
import { loadContractAddresses, TOKENS, ENV, NETWORK_CHAIN_ID } from './config';

export class SwapAgent {
  private x402Client: X402QuoteClient;
  private addresses: ReturnType<typeof loadContractAddresses>;

  constructor() {
    this.x402Client = new X402QuoteClient();
    this.addresses = loadContractAddresses();
  }

  /**
   * Build a payment swap quote intent from CLI options
   */
  buildIntent(
    from: `0x${string}`,
    options: SwapOptions,
    recipient?: `0x${string}`
  ): PaymentSwapQuoteIntent {
    const sellToken = this.getTokenAddress(options.sell);
    const buyToken = this.getTokenAddress(options.buy);
    const sellDecimals = this.getTokenDecimals(options.sell);
    
    // Parse amount with correct decimals
    const sellAmount = parseUnits(options.amount, sellDecimals);
    
    // Convert max slippage percentage to basis points
    const maxSlippageBps = Math.floor(parseFloat(options.maxSlippage) * 100);
    
    // Generate a random nonce
    const nonce = keccak256(encodePacked(['uint256', 'uint256'], [BigInt(Date.now()), BigInt(Math.floor(Math.random() * 1000000))]));
    
    // Set deadline to 5 minutes from now
    const deadline = Math.floor(Date.now() / 1000) + 300;
    const chainId = NETWORK_CHAIN_ID;
    if (!chainId) {
      throw new Error(`Unsupported NETWORK for intent chainId: ${ENV.NETWORK}`);
    }

    const intent: PaymentSwapQuoteIntent = {
      type: 'payment.swap.quote.intent',
      from,
      sell: sellToken,
      buy: buyToken,
      sellAmount: sellAmount.toString(),
      maxSlippageBps,
      recipient: recipient || from,
      deadline,
      chainId,
      nonce,
    };

    return intent;
  }

  /**
   * Get quote from the x402 service
   */
  async getQuote(intent: PaymentSwapQuoteIntent) {
    // Get quote from x402 service and handle 402 payment automatically
    return await this.x402Client.getQuote(intent);
  }

  /**
   * Compute intent hash for canonical JSON representation
   */
  computeIntentHash(intent: PaymentSwapQuoteIntent): `0x${string}` {
    // Create canonical JSON representation
    const canonical = JSON.stringify(intent, Object.keys(intent).sort());
    return keccak256(encodePacked(['string'], [canonical]));
  }

  /**
   * Convert intent to QuoteStruct for EIP-712 signing
   */
  intentToQuoteStruct(intent: PaymentSwapQuoteIntent, minBuy: bigint): QuoteStruct {
    return {
      from: intent.from as `0x${string}`,
      sell: intent.sell as `0x${string}`,
      buy: intent.buy as `0x${string}`,
      sellAmount: BigInt(intent.sellAmount),
      minBuy,
      deadline: BigInt(intent.deadline),
      chainId: BigInt(intent.chainId),
      nonce: intent.nonce as `0x${string}`,
    };
  }

  /**
   * Get token address by symbol
   */
  public getTokenAddress(symbol: string): `0x${string}` {
    const upperSymbol = symbol.toUpperCase();
    switch (upperSymbol) {
      case 'USDC':
        return this.addresses.usdc;
      case 'WETH':
      case 'ETH':
        return this.addresses.weth;
      default:
        throw new Error(`Unsupported token: ${symbol}`);
    }
  }

  /**
   * Get token decimals by symbol
   */
  public getTokenDecimals(symbol: string): number {
    const upperSymbol = symbol.toUpperCase();
    switch (upperSymbol) {
      case 'USDC':
        return TOKENS.USDC.decimals;
      case 'WETH':
      case 'ETH':
        return TOKENS.WETH.decimals;
      default:
        throw new Error(`Unsupported token: ${symbol}`);
    }
  }

  /**
   * Format token amount for display
   */
  formatTokenAmount(amount: bigint, symbol: string): string {
    const decimals = this.getTokenDecimals(symbol);
    return formatUnits(amount, decimals);
  }

  /**
   * Get contract addresses
   */
  getAddresses() {
    return this.addresses;
  }
}

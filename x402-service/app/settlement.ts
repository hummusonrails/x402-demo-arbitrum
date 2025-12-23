import { createPublicClient, createWalletClient, http, parseAbi, parseGwei, type Address, type Hash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum, arbitrumSepolia } from 'viem/chains';
import { ENV } from './config';
import { CAIP2_ARBITRUM_SEPOLIA, normalizeNetworkId } from './x402-utils';
import type { EIP3009PaymentPayload } from './types';

const EIP3009_ABI = parseAbi([
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external',
  'function authorizationState(address authorizer, bytes32 nonce) external view returns (bool)',
]);

export interface SettlementResult {
  success: boolean;
  transactionHash?: Hash;
  blockNumber?: bigint;
  gasUsed?: bigint;
  error?: string;
}

export interface GasEstimate {
  gasLimit: bigint;
  gasPrice: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  estimatedCost: bigint;
}

/**
 * Settlement service for executing EIP-3009 payments
 */
export class SettlementService {
  private publicClient;
  private walletClient;
  private account;
  private chain;

  constructor(privateKey: `0x${string}`) {
    this.account = privateKeyToAccount(privateKey);
    const normalizedNetwork = normalizeNetworkId(ENV.NETWORK);
    this.chain = normalizedNetwork === CAIP2_ARBITRUM_SEPOLIA ? arbitrumSepolia : arbitrum;
    
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(ENV.RPC_URL),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(ENV.RPC_URL),
    });
  }

  /**
   * Estimate gas for settlement transaction
   */
  async estimateGas(
    tokenAddress: Address,
    paymentPayload: EIP3009PaymentPayload
  ): Promise<GasEstimate> {
    try {
      // Estimate gas limit
      const gasLimit = await this.publicClient.estimateContractGas({
        address: tokenAddress,
        abi: EIP3009_ABI,
        functionName: 'transferWithAuthorization',
        args: [
          paymentPayload.payload.from,
          paymentPayload.payload.to,
          BigInt(paymentPayload.payload.value),
          BigInt(paymentPayload.payload.validAfter),
          BigInt(paymentPayload.payload.validBefore),
          paymentPayload.payload.nonce,
          paymentPayload.payload.v,
          paymentPayload.payload.r,
          paymentPayload.payload.s,
        ],
        account: this.account,
      });

      // Get current gas price
      const gasPrice = await this.publicClient.getGasPrice();

      // Get EIP-1559 fee data
      const block = await this.publicClient.getBlock({ blockTag: 'latest' });
      const baseFeePerGas = block.baseFeePerGas || 0n;
      
      // Calculate max fees with buffer
      const maxPriorityFeePerGas = parseGwei('0.01');
      const maxFeePerGas = baseFeePerGas * 2n + maxPriorityFeePerGas;

      // Apply gas limit buffer (20%)
      const bufferedGasLimit = (gasLimit * BigInt(Math.floor(ENV.GAS_PRICE_MULTIPLIER * 100))) / 100n;

      // Calculate estimated cost
      const estimatedCost = bufferedGasLimit * maxFeePerGas;

      return {
        gasLimit: bufferedGasLimit,
        gasPrice,
        maxFeePerGas,
        maxPriorityFeePerGas,
        estimatedCost,
      };
    } catch (error) {
      console.error('Gas estimation failed:', error);
      throw new Error(`Failed to estimate gas: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if authorization has already been used
   */
  async isAuthorizationUsed(
    tokenAddress: Address,
    authorizer: Address,
    nonce: `0x${string}`
  ): Promise<boolean> {
    try {
      const isUsed = await this.publicClient.readContract({
        address: tokenAddress,
        abi: EIP3009_ABI,
        functionName: 'authorizationState',
        args: [authorizer, nonce],
      });

      return isUsed as boolean;
    } catch (error) {
      console.error('Failed to check authorization state:', error);
      return false;
    }
  }

  /**
   * Execute settlement transaction
   */
  async settlePayment(
    tokenAddress: Address,
    paymentPayload: EIP3009PaymentPayload
  ): Promise<SettlementResult> {
    try {
      // Check if already used
      const isUsed = await this.isAuthorizationUsed(
        tokenAddress,
        paymentPayload.payload.from,
        paymentPayload.payload.nonce
      );

      if (isUsed) {
        return {
          success: false,
          error: 'Authorization already used',
        };
      }

      // Estimate gas
      const gasEstimate = await this.estimateGas(tokenAddress, paymentPayload);

      console.log('Settlement gas estimate:', {
        gasLimit: gasEstimate.gasLimit.toString(),
        maxFeePerGas: gasEstimate.maxFeePerGas.toString(),
        estimatedCost: gasEstimate.estimatedCost.toString(),
      });

      // Check max gas price limit
      const maxGasPriceWei = parseGwei(ENV.MAX_GAS_PRICE_GWEI.toString());
      if (gasEstimate.maxFeePerGas > maxGasPriceWei) {
        return {
          success: false,
          error: `Gas price too high: ${gasEstimate.maxFeePerGas} > ${maxGasPriceWei}`,
        };
      }

      // Execute transaction
      const hash = await this.walletClient.writeContract({
        address: tokenAddress,
        abi: EIP3009_ABI,
        functionName: 'transferWithAuthorization',
        args: [
          paymentPayload.payload.from,
          paymentPayload.payload.to,
          BigInt(paymentPayload.payload.value),
          BigInt(paymentPayload.payload.validAfter),
          BigInt(paymentPayload.payload.validBefore),
          paymentPayload.payload.nonce,
          paymentPayload.payload.v,
          paymentPayload.payload.r,
          paymentPayload.payload.s,
        ],
        gas: gasEstimate.gasLimit,
        maxFeePerGas: gasEstimate.maxFeePerGas,
        maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
      });

      console.log('Settlement transaction submitted:', hash);

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      if (receipt.status === 'success') {
        console.log('Settlement confirmed:', {
          hash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
        });

        return {
          success: true,
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
        };
      } else {
        return {
          success: false,
          transactionHash: receipt.transactionHash,
          error: 'Transaction reverted',
        };
      }
    } catch (error) {
      console.error('Settlement failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown settlement error',
      };
    }
  }

  /**
   * Get facilitator address
   */
  getAddress(): Address {
    return this.account.address;
  }
}

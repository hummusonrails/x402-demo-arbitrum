#!/usr/bin/env node

import { Command } from 'commander';
import { createPublicClient, createWalletClient, http, parseAbi, getContract, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum, arbitrumSepolia } from 'viem/chains';
import { SwapAgent } from './agent';
import { X402QuoteClient } from './client';
import { validateEnvironment, ENV } from './config';
import { CAIP2_ARBITRUM_SEPOLIA, normalizeNetworkId } from './x402-utils';

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
]);

const EXECUTOR_ABI = parseAbi([
  'function executeSwap((address from, address sell, address buy, uint256 sellAmount, uint256 minBuy, uint256 deadline, uint256 chainId, bytes32 nonce) quote, bytes signature, address adapter, bytes dexData, address recipient) external returns (uint256)',
  'event QuoteExecuted(bytes32 indexed intentHash, address indexed sell, address indexed buy, uint256 sellAmount, uint256 bought, address to)',
]);

const program = new Command();

program
  .name('x402-pay')
  .description('X402 Composable Arbitrum Payment CLI (for demo purposes only - unverified and not production ready)')
  .version('1.0.0');

program
  .command('test-x402')
  .description('Test x402 payment flow')
  .action(async () => {
    try {
      validateEnvironment();
      console.log('Testing x402 payment flow...');
      
      const x402Client = new X402QuoteClient();
      await x402Client.testPaymentFlow();
      
    } catch (error) {
      console.error('Test failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('pay')
  .description('Execute a swap payment using x402 standard')
  .option('--swap', 'Enable swap mode', false)
  .option('--sell <token>', 'Token to sell (USDC, WETH)')
  .option('--buy <token>', 'Token to buy (USDC, WETH)')
  .option('--amount <amount>', 'Amount to sell')
  .option('--max-slippage <slippage>', 'Maximum slippage percentage (e.g., 0.3 for 0.3%)')
  .option('--recipient <address>', 'Recipient address (defaults to sender)')
  .action(async (options) => {
    try {
      // Validate environment
      validateEnvironment();

      // Validate required options
      if (!options.swap) {
        throw new Error('--swap flag is required');
      }
      if (!options.sell || !options.buy || !options.amount || !options.maxSlippage) {
        throw new Error('--sell, --buy, --amount, and --max-slippage are required');
      }

      console.log('Starting X402-compliant swap execution...');
      console.log(`This will require payment for quote generation (0.001 USDC)`);
      console.log(`Selling ${options.amount} ${options.sell} for ${options.buy}`);
      console.log(`Max slippage: ${options.maxSlippage}%`);

      // Initialize clients
      const account = privateKeyToAccount(ENV.PRIVATE_KEY);
      const normalizedNetwork = normalizeNetworkId(ENV.NETWORK);
      const chain = normalizedNetwork === CAIP2_ARBITRUM_SEPOLIA ? arbitrumSepolia : arbitrum;
      const explorerBaseUrl =
        normalizedNetwork === CAIP2_ARBITRUM_SEPOLIA
          ? 'https://sepolia.arbiscan.io'
          : 'https://arbiscan.io';
      const publicClient = createPublicClient({
        chain,
        transport: http(ENV.RPC_URL),
      });
      const walletClient = createWalletClient({
        account,
        chain,
        transport: http(ENV.RPC_URL),
      });

      // Initialize swap agent and x402 client
      const agent = new SwapAgent();
      const x402Client = new X402QuoteClient();
      const addresses = agent.getAddresses();
      const recipient = (options.recipient as `0x${string}`) || account.address;

      console.log(`Building intent for ${account.address}...`);

      // Build intent
      const intent = agent.buildIntent(account.address, {
        sell: options.sell,
        buy: options.buy,
        amount: options.amount,
        maxSlippage: options.maxSlippage,
      }, recipient);

      console.log(`Getting quote from x402 service (will auto-pay)...`);

      // Get quote using x402 client and handle payment automatically
      const attestation = await x402Client.getQuote(intent);

      console.log(`Received paid quote:`);
      console.log(`Expected output: ${agent.formatTokenAmount(BigInt(attestation.route.expected_out), options.buy)} ${options.buy}`);
      console.log(`Minimum output: ${agent.formatTokenAmount(BigInt(attestation.quote.minBuy), options.buy)} ${options.buy}`);
      console.log(`Signer: ${attestation.signer}`);

      // Check token approval
      const sellTokenContract = getContract({
        address: agent.getTokenAddress(options.sell),
        abi: ERC20_ABI,
        client: { public: publicClient, wallet: walletClient },
      });

      const currentAllowance = await sellTokenContract.read.allowance([account.address, addresses.executor]);
      const sellAmount = BigInt(attestation.quote.sellAmount);

      if (currentAllowance < sellAmount) {
        console.log(`Approving ${options.sell} spending...`);
        
        const approveTx = await walletClient.writeContract({
          address: agent.getTokenAddress(options.sell),
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [addresses.executor, sellAmount],
        });

        console.log(`  Approval tx: ${approveTx}`);
        
        // Wait for approval confirmation
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
        console.log(`Approval confirmed`);
      } else {
        console.log(`${options.sell} already approved`);
      }

      // Execute swap
      console.log(`Executing swap...`);

      const quote = {
        from: attestation.quote.from as `0x${string}`,
        sell: attestation.quote.sell as `0x${string}`,
        buy: attestation.quote.buy as `0x${string}`,
        sellAmount: BigInt(attestation.quote.sellAmount),
        minBuy: BigInt(attestation.quote.minBuy),
        deadline: BigInt(attestation.quote.deadline),
        chainId: BigInt(attestation.quote.chainId),
        nonce: attestation.quote.nonce as `0x${string}`,
      };

      const swapTx = await walletClient.writeContract({
        address: addresses.executor,
        abi: EXECUTOR_ABI,
        functionName: 'executeSwap',
        args: [
          quote,
          attestation.signature as `0x${string}`,
          addresses.mockAdapter,
          '0x', // empty hexdata for mock
          recipient,
        ],
      });

      console.log(`Swap transaction: ${swapTx}`);
      console.log(`Explorer: ${explorerBaseUrl}/tx/${swapTx}`);

      // Wait for confirmation and get receipt
      const receipt = await publicClient.waitForTransactionReceipt({ hash: swapTx });
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);

      // Decode QuoteExecuted event
      try {
        const decodedLogs = parseEventLogs({
          abi: EXECUTOR_ABI,
          logs: receipt.logs,
          eventName: 'QuoteExecuted',
        });

        if (decodedLogs.length > 0) {
          const decoded = decodedLogs[0];
          const { sellAmount, bought, to, intentHash } = decoded.args;
          console.log(`\nX402-compliant swap completed successfully!`);
          console.log(`Quote payment: 0.001 USDC (paid via x402)`);
          console.log(`Sold: ${agent.formatTokenAmount(sellAmount, options.sell)} ${options.sell}`);
          console.log(`Bought: ${agent.formatTokenAmount(bought, options.buy)} ${options.buy}`);
          console.log(`Recipient: ${to}`);
          console.log(`Intent Hash: ${intentHash}`);
        }
      } catch (error) {
        console.log('Swap completed (event parsing failed)');
      }

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program.parse();

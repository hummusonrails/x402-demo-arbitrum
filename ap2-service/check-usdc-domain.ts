import { createPublicClient, http } from 'viem';
import { arbitrum, arbitrumSepolia } from 'viem/chains';
import { CONFIG } from './src/config.js';
import { CAIP2_ARBITRUM_SEPOLIA, normalizeNetworkId } from './src/x402-utils.js';

const USDC_ADDRESS = CONFIG.USDC_ADDRESS;
const normalizedNetwork = normalizeNetworkId(CONFIG.NETWORK);
const chain = normalizedNetwork === CAIP2_ARBITRUM_SEPOLIA ? arbitrumSepolia : arbitrum;

const publicClient = createPublicClient({
  chain,
  transport: http(CONFIG.ARBITRUM_RPC_URL),
});

async function checkUSDCDomain() {
  const networkLabel = chain.id === arbitrum.id ? 'Arbitrum One' : 'Arbitrum Sepolia';
  console.log(`Checking USDC EIP-712 domain on ${networkLabel}...\n`);
  
  try {
    // Try to read the name
    const name = await publicClient.readContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: [{
        name: 'name',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'string' }],
      }],
      functionName: 'name',
    });
    
    console.log('Token name:', name);
    
    // Try to read version
    const version = await publicClient.readContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: [{
        name: 'version',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'string' }],
      }],
      functionName: 'version',
    });
    
    console.log('Version:', version);
    
    // Try to read DOMAIN_SEPARATOR
    const domainSeparator = await publicClient.readContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: [{
        name: 'DOMAIN_SEPARATOR',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'bytes32' }],
      }],
      functionName: 'DOMAIN_SEPARATOR',
    });
    
    console.log('DOMAIN_SEPARATOR:', domainSeparator);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkUSDCDomain();

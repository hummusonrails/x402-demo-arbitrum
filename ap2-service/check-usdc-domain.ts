import { createPublicClient, http } from 'viem';
import { arbitrum } from 'viem/chains';

const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

const publicClient = createPublicClient({
  chain: arbitrum,
  transport: http('https://arb1.arbitrum.io/rpc'),
});

async function checkUSDCDomain() {
  console.log('Checking USDC EIP-712 domain on Arbitrum One...\n');
  
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

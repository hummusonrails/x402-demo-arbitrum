import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked } from 'viem';
import { QuoteStruct, EIP712_DOMAIN, EIP712_TYPES } from '../../app/types';
import { ENV, NETWORK_CHAIN_ID } from '../../app/config';

const SIGNING_CHAIN_ID = NETWORK_CHAIN_ID;
if (!SIGNING_CHAIN_ID) {
  throw new Error(`Unsupported NETWORK for quote signing: ${ENV.NETWORK}`);
}

export class QuoteSigner {
  private account: ReturnType<typeof privateKeyToAccount>;

  constructor() {
    this.account = privateKeyToAccount(ENV.QUOTE_SERVICE_PRIVATE_KEY);
  }

  /**
   * Sign a quote using EIP-712
   */
  async signQuote(quote: QuoteStruct, verifyingContract: `0x${string}`): Promise<{
    signature: `0x${string}`;
    signer: `0x${string}`;
  }> {
    // Create EIP-712 domain with the verifying contract
    const domain = {
      ...EIP712_DOMAIN,
      chainId: SIGNING_CHAIN_ID,
      verifyingContract,
    };

    // Sign the typed data
    const signature = await this.account.signTypedData({
      domain,
      types: EIP712_TYPES,
      primaryType: 'Quote',
      message: quote,
    });

    return {
      signature,
      signer: this.account.address,
    };
  }

  /**
   * Get the signer address
   */
  getAddress(): `0x${string}` {
    return this.account.address;
  }

  /**
   * Compute intent hash from canonical JSON
   */
  computeIntentHash(intent: any): `0x${string}` {
    const canonical = JSON.stringify(intent, Object.keys(intent).sort());
    return keccak256(encodePacked(['string'], [canonical]));
  }
}

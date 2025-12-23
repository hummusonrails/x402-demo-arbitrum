import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, encodeAbiParameters, parseAbiParameters, recoverAddress, type Address } from 'viem';
import type { EIP3009Authorization, EIP3009Signature, EIP3009PaymentPayload } from './types';
import { normalizeNetworkId } from './x402-utils';

/**
 * EIP-3009 Transfer with Authorization utilities
 * Implements the x402 payment scheme for EVM chains
 */

const EIP3009_TYPEHASH = keccak256(
  encodePacked(
    ['string'],
    ['TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)']
  )
);

/**
 * Create EIP-712 domain separator for a token contract
 */
export function createDomainSeparator(
  tokenAddress: Address,
  tokenName: string,
  tokenVersion: string,
  chainId: number
): `0x${string}` {
  const domainTypeHash = keccak256(
    encodePacked(
      ['string'],
      ['EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)']
    )
  );

  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32, bytes32, bytes32, uint256, address'),
      [
        domainTypeHash,
        keccak256(encodePacked(['string'], [tokenName])),
        keccak256(encodePacked(['string'], [tokenVersion])),
        BigInt(chainId),
        tokenAddress,
      ]
    )
  );
}

/**
 * Sign an EIP-3009 transfer authorization
 */
export async function signTransferAuthorization(
  authorization: EIP3009Authorization,
  tokenAddress: Address,
  tokenName: string,
  tokenVersion: string,
  chainId: number,
  privateKey: `0x${string}`
): Promise<EIP3009Signature> {
  const account = privateKeyToAccount(privateKey);

  const structHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32, address, address, uint256, uint256, uint256, bytes32'),
      [
        EIP3009_TYPEHASH,
        authorization.from,
        authorization.to,
        BigInt(authorization.value),
        BigInt(authorization.validAfter),
        BigInt(authorization.validBefore),
        authorization.nonce,
      ]
    )
  );

  // Create domain separator
  const domainSeparator = createDomainSeparator(tokenAddress, tokenName, tokenVersion, chainId);

  // Create digest
  const digest = keccak256(
    encodePacked(['string', 'bytes32', 'bytes32'], ['\x19\x01', domainSeparator, structHash])
  );

  // Sign the digest 
  const signature = await account.signTypedData({
    domain: {
      name: tokenName,
      version: tokenVersion,
      chainId: chainId,
      verifyingContract: tokenAddress,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });

  // Parse signature into v, r, s for x402 payment payload
  const r = signature.slice(0, 66) as `0x${string}`;
  const s = `0x${signature.slice(66, 130)}` as `0x${string}`;
  const v = parseInt(signature.slice(130, 132), 16);

  return { v, r, s };
}

/**
 * Create a complete x402 payment payload for EIP-3009
 */
export async function createX402PaymentPayload(
  authorization: EIP3009Authorization,
  tokenAddress: Address,
  tokenName: string,
  tokenVersion: string,
  chainId: number,
  privateKey: `0x${string}`,
  network: string
): Promise<EIP3009PaymentPayload> {
  const signature = await signTransferAuthorization(
    authorization,
    tokenAddress,
    tokenName,
    tokenVersion,
    chainId,
    privateKey
  );

  return {
    x402Version: 2,
    scheme: 'exact',
    network: normalizeNetworkId(network),
    payload: {
      from: authorization.from,
      to: authorization.to,
      value: authorization.value,
      validAfter: authorization.validAfter,
      validBefore: authorization.validBefore,
      nonce: authorization.nonce,
      v: signature.v,
      r: signature.r,
      s: signature.s,
    },
  };
}

/**
 * Encode payment payload as base64 for X-PAYMENT header
 */
export function encodePaymentHeader(payload: EIP3009PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Decode payment payload from X-PAYMENT header
 */
export function decodePaymentHeader(header: string): EIP3009PaymentPayload | null {
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf-8');
    const payload = JSON.parse(decoded) as EIP3009PaymentPayload;

    // Validate required fields
    if (
      !payload.x402Version ||
      !payload.scheme ||
      !payload.network ||
      !payload.payload ||
      !payload.payload.from ||
      !payload.payload.to ||
      !payload.payload.value ||
      payload.payload.validAfter === undefined ||
      payload.payload.validBefore === undefined ||
      !payload.payload.nonce ||
      payload.payload.v === undefined ||
      !payload.payload.r ||
      !payload.payload.s
    ) {
      return null;
    }

    return payload;
  } catch (error) {
    console.error('Failed to decode payment header:', error);
    return null;
  }
}

/**
 * Verify an EIP-3009 signature and recover the signer address
 */
export async function verifyTransferAuthorization(
  authorization: EIP3009Authorization,
  signature: EIP3009Signature,
  tokenAddress: Address,
  tokenName: string,
  tokenVersion: string,
  chainId: number
): Promise<Address | null> {
  try {
    // Validate signature format
    if (signature.v !== 27 && signature.v !== 28) {
      console.error('Invalid signature v value:', signature.v);
      return null;
    }

    // Create struct hash must match signing
    const structHash = keccak256(
      encodeAbiParameters(
        parseAbiParameters('bytes32, address, address, uint256, uint256, uint256, bytes32'),
        [
          EIP3009_TYPEHASH,
          authorization.from,
          authorization.to,
          BigInt(authorization.value),
          BigInt(authorization.validAfter),
          BigInt(authorization.validBefore),
          authorization.nonce,
        ]
      )
    );

    // Create domain separator
    const domainSeparator = createDomainSeparator(tokenAddress, tokenName, tokenVersion, chainId);

    // Create digest
    const digest = keccak256(
      encodePacked(['string', 'bytes32', 'bytes32'], ['\x19\x01', domainSeparator, structHash])
    );

    // Recover signer address
    const recoveredAddress = await recoverAddressFromDigest(digest, signature);

    return recoveredAddress;
  } catch (error) {
    console.error('Failed to verify signature:', error);
    return null;
  }
}

/**
 * Recover address from digest and signature
 */
async function recoverAddressFromDigest(
  digest: `0x${string}`,
  signature: EIP3009Signature
): Promise<Address | null> {
  try {
    // Convert signature components to proper format
    const r = BigInt(signature.r);
    const s = BigInt(signature.s);
    const v = signature.v;

    // Validate signature parameters
    // Using secp256k1 curve order
    const secp256k1N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
    const secp256k1halfN = secp256k1N / 2n;

    if (s > secp256k1halfN) {
      // Invalid signature - s value too high (malleable signature)
      return null;
    }

    if (r === 0n || s === 0n) {
      return null;
    }

    // Use viem's built-in signature recovery
    // recoverAddress expects the hash and signature
    const fullSignature = `${signature.r}${signature.s.slice(2)}${v.toString(16).padStart(2, '0')}` as `0x${string}`;
    
    // The digest is already the full EIP-712 hash, so we use it directly
    const recoveredAddress = recoverAddress({
      hash: digest,
      signature: fullSignature,
    });

    return await recoveredAddress;
  } catch (error) {
    console.error('Failed to recover address:', error);
    return null;
  }
}

/**
 * Generate a random nonce for EIP-3009
 */
export function generateNonce(): `0x${string}` {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return `0x${Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as `0x${string}`;
}

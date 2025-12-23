export enum Network {
  ARBITRUM = 'eip155:42161',
  ARBITRUM_SEPOLIA = 'eip155:421614',
}

export const LEGACY_NETWORK_ARBITRUM = 'arbitrum';
export const LEGACY_NETWORK_ARBITRUM_SEPOLIA = 'arbitrum-sepolia';

const ALIAS_TO_CAIP: Record<string, Network> = {
  [Network.ARBITRUM]: Network.ARBITRUM,
  [Network.ARBITRUM_SEPOLIA]: Network.ARBITRUM_SEPOLIA,
  [LEGACY_NETWORK_ARBITRUM]: Network.ARBITRUM,
  [LEGACY_NETWORK_ARBITRUM_SEPOLIA]: Network.ARBITRUM_SEPOLIA,
};

const CAIP_TO_LEGACY: Record<Network, string> = {
  [Network.ARBITRUM]: LEGACY_NETWORK_ARBITRUM,
  [Network.ARBITRUM_SEPOLIA]: LEGACY_NETWORK_ARBITRUM_SEPOLIA,
};

export const CAIP2_ARBITRUM_ONE = Network.ARBITRUM;
export const CAIP2_ARBITRUM_SEPOLIA = Network.ARBITRUM_SEPOLIA;

export function resolveNetwork(value: string): Network {
  const normalized = ALIAS_TO_CAIP[value];
  if (!normalized) {
    throw new Error(`Invalid NETWORK: ${value}. Supported: ${Object.keys(ALIAS_TO_CAIP).join(', ')}`);
  }
  return normalized;
}

export function normalizeNetworkId(networkId?: string): string {
  if (!networkId) return '';
  return ALIAS_TO_CAIP[networkId] || ALIAS_TO_CAIP[networkId.toLowerCase()] || networkId;
}

export function chainIdFromNetworkId(networkId: string): number | null {
  const normalized = normalizeNetworkId(networkId);
  if (normalized === CAIP2_ARBITRUM_ONE) return 42161;
  if (normalized === CAIP2_ARBITRUM_SEPOLIA) return 421614;
  if (normalized.startsWith('eip155:')) {
    const raw = normalized.split(':')[1];
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toLegacyNetworkId(networkId: string): string {
  const normalized = normalizeNetworkId(networkId);
  return CAIP_TO_LEGACY[normalized as Network] || networkId;
}

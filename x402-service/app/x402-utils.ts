const NETWORK_ALIASES: Record<string, string> = {
  'arbitrum': 'eip155:42161',
  'arbitrum-sepolia': 'eip155:421614',
  'eip155:42161': 'eip155:42161',
  'eip155:421614': 'eip155:421614',
};

export const CAIP2_ARBITRUM_ONE = 'eip155:42161';
export const CAIP2_ARBITRUM_SEPOLIA = 'eip155:421614';

export function normalizeNetworkId(networkId?: string): string {
  if (!networkId) return '';
  const normalized = NETWORK_ALIASES[networkId.toLowerCase()] || networkId;
  return normalized.toLowerCase();
}

export function toLegacyNetworkId(networkId: string): string {
  const normalized = normalizeNetworkId(networkId);
  if (normalized === CAIP2_ARBITRUM_ONE) return 'arbitrum';
  if (normalized === CAIP2_ARBITRUM_SEPOLIA) return 'arbitrum-sepolia';
  return networkId;
}

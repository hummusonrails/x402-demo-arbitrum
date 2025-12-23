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
  if (normalized === CAIP2_ARBITRUM_ONE) return 'arbitrum';
  if (normalized === CAIP2_ARBITRUM_SEPOLIA) return 'arbitrum-sepolia';
  return networkId;
}

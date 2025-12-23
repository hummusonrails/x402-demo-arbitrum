import { http, createConfig } from 'wagmi';
import { arbitrum, arbitrumSepolia } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';

const NETWORK_ALIASES: Record<string, string> = {
  'arbitrum': 'eip155:42161',
  'arbitrum-sepolia': 'eip155:421614',
  'eip155:42161': 'eip155:42161',
  'eip155:421614': 'eip155:421614',
};

const rawNetwork = import.meta.env.VITE_NETWORK ?? 'eip155:421614';
const resolvedNetworkId = NETWORK_ALIASES[rawNetwork.toLowerCase()];

if (!resolvedNetworkId) {
  throw new Error(`VITE_NETWORK must be one of: ${Object.keys(NETWORK_ALIASES).join(', ')}`);
}

const selectedChain = resolvedNetworkId === 'eip155:42161' ? arbitrum : arbitrumSepolia;

export const networkConfig = {
  caip2: resolvedNetworkId,
  label: selectedChain.id === arbitrum.id ? 'Arbitrum One' : 'Arbitrum Sepolia',
  chainId: selectedChain.id,
  explorerBaseUrl: selectedChain.id === arbitrum.id ? 'https://arbiscan.io' : 'https://sepolia.arbiscan.io',
} as const;

export const config = createConfig({
  chains: [selectedChain],
  connectors: [
    injected(),
    walletConnect({
      projectId: 'demo-project-id',
    }),
  ],
  transports: {
    [selectedChain.id]: http(),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}

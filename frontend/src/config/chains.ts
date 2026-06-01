import { defineChain } from 'viem'

export const tempoMainnet = defineChain({
  id: 4217,
  name: 'Tempo',
  nativeCurrency: { name: 'Tempo', symbol: 'TEMPO', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.tempo.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Tempo Explorer', url: 'https://explorer.tempo.xyz' },
  },
})

export const tempoTestnet = defineChain({
  id: 42431,
  name: 'Tempo Moderato',
  nativeCurrency: { name: 'Tempo', symbol: 'TEMPO', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.moderato.tempo.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Moderato Explorer', url: 'https://explorer.moderato.tempo.xyz' },
  },
  testnet: true,
})

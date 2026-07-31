import { defineChain } from 'viem'

// 兩個網路都有部署標準 Multicall3（0xcA11bde...）。註冊後 wagmi 的 useReadContracts
// 會自動把多筆讀取合併成一次 multicall RPC 呼叫，避免逐筆呼叫觸發 RPC 的 429 rate limit。
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as const

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
  contracts: {
    multicall3: { address: MULTICALL3_ADDRESS },
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
  contracts: {
    multicall3: { address: MULTICALL3_ADDRESS },
  },
  testnet: true,
})

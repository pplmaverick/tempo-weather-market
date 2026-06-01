import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { tempoMainnet, tempoTestnet } from './chains'

const network = (import.meta.env.VITE_NETWORK ?? 'mainnet') as 'mainnet' | 'testnet'

export const activeChain = network === 'testnet' ? tempoTestnet : tempoMainnet

export const wagmiConfig = createConfig({
  chains: [tempoMainnet, tempoTestnet],
  connectors: [injected()],
  transports: {
    [tempoMainnet.id]: http('https://rpc.tempo.xyz'),
    [tempoTestnet.id]: http('https://rpc.moderato.tempo.xyz'),
  },
})

import { useReadContract, useReadContracts } from 'wagmi'
import { WEATHER_MARKET_ABI, CONTRACTS, BUCKET_LABELS } from '../config/contracts'
import { activeChain } from '../config/wagmi'

const network = (import.meta.env.VITE_NETWORK ?? 'mainnet') as 'mainnet' | 'testnet'
const address = CONTRACTS[network]

export function useMarket(marketId: bigint) {
  const { data, isLoading, error } = useReadContract({
    address,
    abi: WEATHER_MARKET_ABI,
    functionName: 'getMarket',
    args: [marketId],
    chainId: activeChain.id,
  })

  const bucketContracts = BUCKET_LABELS.map((_, i) => ({
    address,
    abi: WEATHER_MARKET_ABI,
    functionName: 'bucketTotals' as const,
    args: [marketId, i] as [bigint, number],
    chainId: activeChain.id,
  }))

  const { data: bucketData } = useReadContracts({ contracts: bucketContracts })

  return {
    market: data,
    bucketTotals: bucketData?.map(r => (r.result as bigint | undefined) ?? 0n),
    isLoading,
    error,
  }
}

export function useUserBets(marketId: bigint, userAddress?: `0x${string}`) {
  const bucketContracts = BUCKET_LABELS.map((_, i) => ({
    address,
    abi: WEATHER_MARKET_ABI,
    functionName: 'bets' as const,
    args: [marketId, i, userAddress ?? '0x0000000000000000000000000000000000000000'] as [bigint, number, `0x${string}`],
    chainId: activeChain.id,
    query: { enabled: !!userAddress },
  }))

  const { data } = useReadContracts({ contracts: bucketContracts })
  return data?.map(r => (r.result as bigint | undefined) ?? 0n)
}

export function useContractAddress() {
  return address
}

// 城市順序必須跟 createMarket 建立順序一致：Taipei/Tokyo/New York/Seoul
const CITY_ORDER = ['Taipei', 'Tokyo', 'New York', 'Seoul'] as const

export function useLatestMarkets() {
  const { data: nextId } = useReadContract({
    address,
    abi: WEATHER_MARKET_ABI,
    functionName: 'nextMarketId',
    chainId: activeChain.id,
  })

  if (!nextId || nextId < 4n) return null // null = still loading

  // 往回推 4 個，對應 CITY_ORDER
  const startId = nextId - 4n
  return CITY_ORDER.map((cityName, i) => ({
    cityName,
    marketId: startId + BigInt(i),
  }))
}

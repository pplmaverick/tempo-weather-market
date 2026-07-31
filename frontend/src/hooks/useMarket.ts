import { useMemo } from 'react'
import { useReadContract, useReadContracts } from 'wagmi'
import { WEATHER_MARKET_ABI, CONTRACTS, BUCKET_LABELS, CITIES } from '../config/contracts'
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

export type CityMarket = {
  cityName: string
  marketId: bigint
  status: number // -1 = 該城市目前沒有任何市場
}

// 每輪開幾個市場、開哪些城市都不是固定的（例如某輪只開 New York、Seoul 兩個）。
// 不能用「nextMarketId - 4」反推，必須實際讀出每個市場的 city 欄位，
// 依城市分組取最新一筆（marketId 最大者）當作該城市目前的市場。
export function useLatestMarkets(): CityMarket[] | null {
  const { data: nextId } = useReadContract({
    address,
    abi: WEATHER_MARKET_ABI,
    functionName: 'nextMarketId',
    chainId: activeChain.id,
  })

  const count = nextId !== undefined ? Number(nextId) : 0

  const marketContracts = useMemo(
    () =>
      Array.from({ length: count }, (_, id) => ({
        address,
        abi: WEATHER_MARKET_ABI,
        functionName: 'getMarket' as const,
        args: [BigInt(id)] as [bigint],
        chainId: activeChain.id,
      })),
    [count],
  )

  const { data: marketsData } = useReadContracts({
    contracts: marketContracts,
    query: { enabled: count > 0 },
  })

  if (nextId === undefined) return null // 還在讀 nextMarketId
  if (count === 0) return CITIES.map(c => ({ cityName: c.name, marketId: 0n, status: -1 }))
  if (!marketsData) return null // 還在讀各市場詳情

  const byCity = new Map<string, { marketId: bigint; status: number }>()
  marketsData.forEach((r, id) => {
    const result = r.result as readonly unknown[] | undefined
    if (!result) return
    const cityName = result[0] as string
    const status = result[4] as number
    byCity.set(cityName, { marketId: BigInt(id), status }) // id 遞增覆寫，最後留下的即最新一筆
  })

  return CITIES.map(c => {
    const found = byCity.get(c.name)
    return { cityName: c.name, marketId: found?.marketId ?? 0n, status: found?.status ?? -1 }
  })
}

// 掃描全部市場（0 .. nextMarketId-1），找出指定錢包有下注紀錄的市場 ID。
// 不用 eth_getLogs：Tempo RPC 對單次查詢有 100,000 區塊上限，合約部署至今要切成上百段查詢，
// 又慢又容易被 rate limit；直接讀 userTotalBets 對目前市場規模（幾十個）簡單又可靠。
export function useAllUserBets(userAddress?: `0x${string}`) {
  const { data: nextId } = useReadContract({
    address,
    abi: WEATHER_MARKET_ABI,
    functionName: 'nextMarketId',
    chainId: activeChain.id,
  })

  const count = nextId !== undefined ? Number(nextId) : 0

  const betContracts = useMemo(
    () =>
      Array.from({ length: count }, (_, id) => ({
        address,
        abi: WEATHER_MARKET_ABI,
        functionName: 'userTotalBets' as const,
        args: [BigInt(id), userAddress ?? '0x0000000000000000000000000000000000000000'] as [bigint, `0x${string}`],
        chainId: activeChain.id,
      })),
    [count, userAddress],
  )

  const { data, isLoading } = useReadContracts({
    contracts: betContracts,
    query: { enabled: count > 0 && !!userAddress },
  })

  const marketIds = useMemo(() => {
    if (!data || !userAddress) return []
    const ids: bigint[] = []
    data.forEach((r, id) => {
      const amt = (r.result as bigint | undefined) ?? 0n
      if (amt > 0n) ids.push(BigInt(id))
    })
    console.log(`[useAllUserBets] 錢包 ${userAddress} 掃描 ${count} 個市場，找到 ${ids.length} 筆下注紀錄`, ids.map(String))
    return ids
  }, [data, count, userAddress])

  return {
    marketIds,
    isLoading: nextId === undefined || (count > 0 && !!userAddress && isLoading),
  }
}

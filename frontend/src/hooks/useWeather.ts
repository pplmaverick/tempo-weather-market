import { useQuery } from '@tanstack/react-query'

interface WeatherData {
  city: string
  temperature: number
  humidity: number
  description: string
  windSpeed?: number
  precipitation?: number
}

export function useWeather(city: string) {
  return useQuery<WeatherData>({
    queryKey: ['weather', city],
    queryFn: async () => {
      const res = await fetch(`/api/oracle/weather/${encodeURIComponent(city)}`)
      if (!res.ok) throw new Error('Weather fetch failed')
      return res.json()
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 2,
  })
}

import { useQuery } from '@tanstack/react-query'

interface WeatherData {
  city: string
  temperature: number
  humidity: number
  description: string
  windSpeed?: number
  precipitation?: number
  sources?: {
    median: number
    count: number
    openweather?: number
    weatherapi?: number
    openmeteo?: number
  }
}

const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  Taipei:     { lat: 25.04, lon: 121.53 },
  Tokyo:      { lat: 35.68, lon: 139.69 },
  'New York': { lat: 40.71, lon: -74.00 },
  Seoul:      { lat: 37.57, lon: 126.98 },
}

// WMO weather code → simple description
function describeWeatherCode(code: number): string {
  if (code === 0) return 'Clear sky'
  if (code <= 2) return 'Partly cloudy'
  if (code === 3) return 'Overcast'
  if (code <= 49) return 'Foggy'
  if (code <= 59) return 'Drizzle'
  if (code <= 69) return 'Rain'
  if (code <= 79) return 'Snow'
  if (code <= 82) return 'Rain showers'
  if (code <= 99) return 'Thunderstorm'
  return 'Unknown'
}

export function useWeather(city: string) {
  return useQuery<WeatherData>({
    queryKey: ['weather', city],
    queryFn: async () => {
      const coords = CITY_COORDS[city]
      if (!coords) throw new Error(`Unknown city: ${city}`)
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation&timezone=UTC`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Weather fetch failed')
      const json = await res.json()
      const c = json.current
      const temp = Math.round(c.temperature_2m * 10) / 10
      return {
        city,
        temperature: temp,
        humidity: c.relative_humidity_2m,
        description: describeWeatherCode(c.weather_code),
        windSpeed: c.wind_speed_10m,
        precipitation: c.precipitation,
        sources: {
          median: temp,
          count: 1,
          openmeteo: temp,
        },
      }
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 2,
  })
}

import { useQuery } from '@tanstack/react-query'
import { useWeather } from '../hooks/useWeather'

interface Props {
  oracleCity: string  // exact name oracle server expects: "Taipei", "New York", etc.
  cityName: string
}

function useOracleHealth() {
  return useQuery<{ status: string }>({
    queryKey: ['oracle-health'],
    queryFn: async () => {
      const res = await fetch('/api/oracle/health')
      if (!res.ok) throw new Error('offline')
      return res.json()
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  })
}

export default function WeatherStrip({ oracleCity, cityName }: Props) {
  const { error: healthError } = useOracleHealth()
  const { data, isLoading, error: weatherError } = useWeather(oracleCity)

  // 只在確認失敗時顯示 OFFLINE；載入中（healthError=null）和成功都顯示 LIVE
  const oracleOnline = !healthError

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #c7c4d8',
      borderRadius: 12,
      padding: '12px 20px',
      marginBottom: 24,
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: oracleOnline ? '#16a34a' : '#ba1a1a',
            boxShadow: oracleOnline ? '0 0 0 2px #bbf7d0' : 'none',
          }} />
          <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: oracleOnline ? '#15803d' : '#ba1a1a', fontWeight: 600, letterSpacing: '0.05em' }}>
            {oracleOnline ? 'ORACLE LIVE' : 'ORACLE OFFLINE'}
          </span>
        </div>
        <div style={{ width: 1, height: 16, background: '#c7c4d8' }} />
        <span style={{ fontSize: 18, fontWeight: 600 }}>
          {cityName}
        </span>
      </div>

      {isLoading && oracleOnline && (
        <span style={{ color: '#777587', fontSize: 14 }}>Loading weather…</span>
      )}
      {weatherError && oracleOnline && (
        <span style={{ color: '#777587', fontSize: 13 }}>Weather data unavailable</span>
      )}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ display: 'flex', gap: 32 }}>
            <Stat label="TEMPERATURE" value={`${data.temperature}°C`} highlight />
            <Stat label="HUMIDITY" value={`${data.humidity}%`} />
            {data.precipitation !== undefined && data.precipitation > 0 && (
              <Stat label="PRECIPITATION" value={`${data.precipitation} mm/h`} />
            )}
            {data.windSpeed !== undefined && (
              <Stat label="WIND" value={`${data.windSpeed} km/h`} />
            )}
          </div>
          {data.sources && (
            <div style={{
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              color: '#9592a3',
              letterSpacing: '0.03em',
            }}>
              {[
                data.sources.openweather !== undefined && `OW: ${data.sources.openweather}°`,
                data.sources.weatherapi  !== undefined && `WA: ${data.sources.weatherapi}°`,
                data.sources.openmeteo   !== undefined && `OM: ${data.sources.openmeteo}°`,
              ].filter(Boolean).join(' | ')}
              {' '}
              <span style={{ color: '#b8b5c6' }}>({data.sources.count} {data.sources.count === 1 ? 'source' : 'sources'})</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#464555', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 600, color: highlight ? '#4d41df' : '#191c1d' }}>{value}</span>
    </div>
  )
}

import { formatUnits } from 'viem'
import { CITIES, MARKET_STATUS, STABLECOINS } from '../config/contracts'
import { useMarket, useContractAddress } from '../hooks/useMarket'

const network = (import.meta.env.VITE_NETWORK ?? 'mainnet') as 'mainnet' | 'testnet'
const { symbol } = STABLECOINS[network]

function MarketCard({ city }: { city: typeof CITIES[number] }) {
  const { market, bucketTotals, isLoading } = useMarket(city.marketId)

  const status = market?.[4] ?? 0
  const totalPool = market?.[5] ?? 0n
  const finalTemp = market?.[6]
  const winningBucket = market?.[7]
  const noWinner = market?.[9]
  const settleMemo = market?.[10]
  const targetDate = market?.[2]
    ? new Date(Number(market[2]) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—'

  const statusStyle = status === MARKET_STATUS.OPEN
    ? { label: 'OPEN', color: '#15803d', bg: '#dcfce7', border: '#bbf7d0' }
    : status === MARKET_STATUS.LOCKED
    ? { label: 'LOCKED', color: '#92400e', bg: '#fef3c7', border: '#fde68a' }
    : { label: 'SETTLED', color: '#3730a3', bg: '#e0e7ff', border: '#c7d2fe' }

  return (
    <article style={{ background: '#fff', border: '1px solid #c7c4d8', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: '#464555', letterSpacing: '0.05em' }}>
                Market #{city.marketId.toString()}
              </span>
              <span style={{
                padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.08em',
                background: statusStyle.bg, color: statusStyle.color, border: `1px solid ${statusStyle.border}`,
              }}>
                {statusStyle.label}
              </span>
            </div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{city.name}</h2>
            <p style={{ margin: '4px 0 0', color: '#464555', fontSize: 14 }}>
              {status === MARKET_STATUS.SETTLED ? `Settlement Date: ${targetDate}` : `Target Date: ${targetDate}`}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#464555', marginBottom: 2 }}>TOTAL POOL</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>
              {isLoading ? '—' : Number(formatUnits(totalPool, 6)).toLocaleString()} {symbol}
            </div>
          </div>
        </div>

        {status === MARKET_STATUS.SETTLED ? (
          <div style={{ background: '#f3f4f5', borderRadius: 10, padding: 16, border: '1px solid #c7c4d8' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#464555', marginBottom: 8 }}>SETTLEMENT RESULT</div>
                {noWinner ? (
                  <div style={{ fontSize: 18, fontWeight: 600, color: '#777587' }}>No Winner — All Refunded</div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 38, fontWeight: 700 }}>{finalTemp !== undefined ? (Number(finalTemp) / 10).toFixed(1) : '—'}°C</span>
                    <span style={{ color: '#4d41df', fontWeight: 700, fontSize: 15 }}>
                      Winning Range: {winningBucket !== undefined ? city.bucketLabels[winningBucket] : '—'}
                    </span>
                  </div>
                )}
                {settleMemo && (
                  <div style={{ marginTop: 8, fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: '#464555', wordBreak: 'break-word' }}>
                    {settleMemo}
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#464555', marginBottom: 8 }}>POOL DISTRIBUTION</div>
                <div style={{ display: 'flex', height: 20, borderRadius: 999, overflow: 'hidden', background: '#edeeef' }}>
                  {city.bucketLabels.map((_, i) => {
                    const bt = bucketTotals?.[i] ?? 0n
                    const pct = totalPool > 0n ? Number((bt * 100n) / totalPool) : 0
                    const colors = ['#c7c4d8', '#a8a0f8', '#4d41df', '#575e70', '#914800']
                    return pct > 0 ? (
                      <div
                        key={i}
                        style={{ width: `${pct}%`, height: '100%', background: colors[i] }}
                        title={`${city.bucketLabels[i]}: ${pct}%`}
                      />
                    ) : null
                  })}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {city.bucketLabels.map((label, i) => {
                    const bt = bucketTotals?.[i] ?? 0n
                    const pct = totalPool > 0n ? Number((bt * 100n) / totalPool) : 0
                    const colors = ['#c7c4d8', '#a8a0f8', '#4d41df', '#575e70', '#914800']
                    return (
                      <span key={i} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: colors[i] }} />
                        {label}: {pct}%
                      </span>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {city.bucketLabels.map((label, i) => {
              const bt = bucketTotals?.[i] ?? 0n
              const pct = totalPool > 0n ? Number((bt * 100n) / totalPool) : 0
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f3f4f5', fontSize: 14 }}>
                  <span>{label}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#464555' }}>
                    {Number(formatUnits(bt, 6)).toLocaleString()} {symbol} ({pct}%)
                  </span>
                </div>
              )
            })}
            {status === MARKET_STATUS.LOCKED && (
              <div style={{
                background: '#fef3c7', border: '1px dashed #fde68a',
                borderRadius: 8, padding: 16, display: 'flex', alignItems: 'center', gap: 10, marginTop: 8,
              }}>
                <span className="material-symbols-outlined" style={{ color: '#92400e', fontSize: 28 }}>hourglass_empty</span>
                <span style={{ fontSize: 14, color: '#92400e' }}>Awaiting final temperature verification from oracle.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

export default function MarketStatus() {
  const contractAddress = useContractAddress()

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 40, fontWeight: 700, letterSpacing: '-0.02em' }}>Market Registry</h1>
        <p style={{ margin: '8px 0 0', color: '#464555', fontSize: 18, maxWidth: 600 }}>
          Settlement history and operational status for all weather prediction markets on Tempo Network.
        </p>
      </div>

      {/* Oracle sidebar info */}
      <div style={{
        background: '#fff', border: '1px solid #c7c4d8', borderRadius: 12, padding: 20,
        marginBottom: 24, display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#464555', marginBottom: 4 }}>CONTRACT ADDRESS ({network.toUpperCase()})</div>
          <code style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: '#191c1d' }}>
            {contractAddress}
          </code>
        </div>
        <div>
          <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#464555', marginBottom: 4 }}>DATA SOURCE</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-outlined" style={{ color: '#4d41df', fontSize: 20 }}>cloud</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>OpenWeather API</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#464555', marginBottom: 4 }}>SETTLEMENT</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-outlined" style={{ color: '#4d41df', fontSize: 20 }}>verified_user</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>On-chain via Oracle Server</span>
          </div>
        </div>
        <div style={{
          marginLeft: 'auto', background: 'linear-gradient(135deg, #4d41df, #675df9)',
          borderRadius: 10, padding: '10px 16px', color: '#fff',
          display: 'flex', gap: 8,
        }}>
          <span style={{ padding: '2px 8px', background: 'rgba(255,255,255,0.2)', borderRadius: 6, fontSize: 12 }}>MPP</span>
          <span style={{ padding: '2px 8px', background: 'rgba(255,255,255,0.2)', borderRadius: 6, fontSize: 12 }}>Payment Memo</span>
          <span style={{ padding: '2px 8px', background: 'rgba(255,255,255,0.2)', borderRadius: 6, fontSize: 12 }}>Scheduled Tx</span>
        </div>
      </div>

      {/* Market cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {CITIES.map(city => (
          <MarketCard key={city.code} city={city} />
        ))}
      </div>
    </div>
  )
}

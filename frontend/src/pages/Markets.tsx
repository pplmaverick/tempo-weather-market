import { useState } from 'react'
import { useAccount } from 'wagmi'
import { formatUnits } from 'viem'
import { CITIES, MARKET_STATUS, STABLECOINS } from '../config/contracts'
import { useMarket } from '../hooks/useMarket'
import { useWeather } from '../hooks/useWeather'
import { usePlaceBet } from '../hooks/usePlaceBet'
import WeatherStrip from '../components/WeatherStrip'
import BucketBar from '../components/BucketBar'

const network = (import.meta.env.VITE_NETWORK ?? 'mainnet') as 'mainnet' | 'testnet'
const { symbol } = STABLECOINS[network]

export default function Markets() {
  const [cityIdx, setCityIdx] = useState(0)
  const city = CITIES[cityIdx]
  const { market, bucketTotals, isLoading } = useMarket(city.marketId)
  const { data: weather } = useWeather(city.code)
  const { isConnected } = useAccount()
  const [selectedBucket, setSelectedBucket] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const { placeBet, step, errorMsg, balance, reset } = usePlaceBet()

  const status = market?.[4] ?? 0
  const totalPool = market?.[5] ?? 0n
  const targetDate = market?.[2] ? new Date(Number(market[2]) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
  const lockTime = market?.[3] ? new Date(Number(market[3]) * 1000) : null
  const timeLeft = lockTime ? Math.max(0, Math.floor((lockTime.getTime() - Date.now()) / 3600000)) : 0

  const statusBadge = status === MARKET_STATUS.OPEN
    ? { label: 'OPEN', bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' }
    : status === MARKET_STATUS.LOCKED
    ? { label: 'LOCKED', bg: '#fef3c7', color: '#92400e', border: '#fde68a' }
    : { label: 'SETTLED', bg: '#e0e7ff', color: '#3730a3', border: '#c7d2fe' }

  const balanceFormatted = balance ? Number(formatUnits(balance, 6)).toFixed(2) : '0.00'
  const feeAmt = amount ? (parseFloat(amount) * 0.02).toFixed(2) : '0.00'
  const totalAmt = amount ? parseFloat(amount).toFixed(2) : '0.00'

  async function handleBet() {
    if (selectedBucket === null || !amount) return
    await placeBet(city.marketId, selectedBucket, amount)
  }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px' }}>
      <WeatherStrip oracleCity={city.oracleCity} cityName={`${city.name}${weather ? `, ${weather.description ?? ''}` : ''}`} />

      {/* City tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 32, flexWrap: 'wrap' }}>
        {CITIES.map((c, i) => (
          <button
            key={c.code}
            onClick={() => { setCityIdx(i); setSelectedBucket(null); setAmount(''); reset() }}
            style={{
              padding: '8px 20px',
              borderRadius: 999,
              border: cityIdx === i ? '1px solid #c7c4d8' : '1px solid transparent',
              background: cityIdx === i ? '#fff' : '#edeeef',
              color: cityIdx === i ? '#4d41df' : '#575e70',
              fontWeight: cityIdx === i ? 600 : 400,
              cursor: 'pointer',
              fontSize: 15,
              boxShadow: cityIdx === i ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, alignItems: 'start' }}>
        {/* Left: Market card */}
        <div style={{ background: '#fff', border: '1px solid #c7c4d8', borderRadius: 12, overflow: 'hidden' }}>
          {/* Card header */}
          <div style={{
            background: '#f3f4f5', padding: '20px 24px',
            borderBottom: '1px solid #c7c4d8',
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: '-0.01em' }}>
                {city.name} Temperature Prediction
              </h1>
              <div style={{ display: 'flex', gap: 16, marginTop: 6, color: '#464555', fontSize: 14 }}>
                <span>📅 {targetDate}</span>
                {status === MARKET_STATUS.OPEN && <span>⏱ {timeLeft}h remaining</span>}
              </div>
            </div>
            <span style={{
              padding: '4px 12px', borderRadius: 999,
              background: statusBadge.bg, color: statusBadge.color,
              border: `1px solid ${statusBadge.border}`,
              fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
            }}>
              {statusBadge.label}
            </span>
          </div>

          <div style={{ padding: 24 }}>
            {/* Pool */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: '#464555', marginBottom: 4 }}>TOTAL LIQUIDITY POOL</div>
              {isLoading ? (
                <div style={{ fontSize: 36, fontWeight: 700, color: '#c7c4d8' }}>Loading…</div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 42, fontWeight: 700, color: '#4d41df' }}>{Number(formatUnits(totalPool, 6)).toLocaleString()}</span>
                  <span style={{ fontSize: 18, color: '#464555' }}>{symbol}</span>
                </div>
              )}
            </div>

            <BucketBar
              bucketTotals={bucketTotals}
              selectedBucket={selectedBucket}
              onSelect={setSelectedBucket}
              status={status}
              winningBucket={market?.[7]}
              labels={[...city.bucketLabels]}
            />

            {status === MARKET_STATUS.SETTLED && market?.[9] === false && (
              <div style={{ marginTop: 24, padding: 16, background: '#e0e7ff', borderRadius: 10, border: '1px solid #c7d2fe' }}>
                <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: '#3730a3' }}>SETTLEMENT MEMO</div>
                <div style={{ fontSize: 15, color: '#1e1b4b', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                  {market?.[10] || '—'}
                </div>
                <div style={{ marginTop: 8, fontSize: 14, color: '#464555' }}>
                  Final Temp: <strong>{market?.[6] !== undefined ? (Number(market[6]) / 10).toFixed(1) : '—'}°C</strong>
                  {' · '}Winning Range: <strong>{city.bucketLabels[market?.[7] ?? 0]}</strong>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Bet sidebar */}
        <div style={{
          background: '#fff', border: '1px solid #c7c4d8',
          borderRadius: 12, padding: 24,
          position: 'sticky', top: 80,
        }}>
          <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 600 }}>Place Your Position</h3>

          {status !== MARKET_STATUS.OPEN ? (
            <div style={{ padding: 16, background: '#f3f4f5', borderRadius: 8, color: '#464555', textAlign: 'center', fontSize: 14 }}>
              Market is {statusBadge.label.toLowerCase()} — betting closed.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Selected range */}
              <div>
                <label style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#464555', display: 'block', marginBottom: 6 }}>SELECTED RANGE</label>
                <div style={{
                  padding: 12, background: '#edeeef', borderRadius: 8, border: '1px solid #c7c4d8',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  minHeight: 42,
                }}>
                  <span style={{ fontWeight: 600, fontSize: 16 }}>
                    {selectedBucket !== null ? city.bucketLabels[selectedBucket] : <span style={{ color: '#777587' }}>Select a range above</span>}
                  </span>
                </div>
              </div>

              {/* Amount input */}
              <div>
                <label style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#464555', display: 'block', marginBottom: 6 }}>
                  BET AMOUNT ({symbol})
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    style={{
                      width: '100%', padding: '10px 80px 10px 12px',
                      border: '1px solid #c7c4d8', borderRadius: 8,
                      fontSize: 15, fontFamily: "'JetBrains Mono', monospace",
                      background: '#f3f4f5', outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      onClick={() => balance && setAmount(formatUnits(balance, 6))}
                      style={{ fontSize: 11, fontWeight: 700, color: '#4d41df', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace" }}
                    >MAX</button>
                    <span style={{ fontSize: 11, color: '#464555', borderLeft: '1px solid #c7c4d8', paddingLeft: 6, fontFamily: "'JetBrains Mono', monospace" }}>{symbol}</span>
                  </div>
                </div>
                {balance !== undefined && (
                  <div style={{ fontSize: 12, color: '#777587', marginTop: 4 }}>Balance: {balanceFormatted} {symbol}</div>
                )}
              </div>

              {/* Fee summary */}
              <div style={{ background: '#f3f4f5', border: '1px solid #c7c4d8', borderRadius: 8, padding: 12, fontSize: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: '#464555' }}>Market Fee (2%)</span>
                  <span>- {feeAmt} {symbol}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: '#464555' }}>Gas</span>
                  <span style={{ color: '#464555' }}>Paid in USDCE</span>
                </div>
                <div style={{ borderTop: '1px solid #c7c4d8', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                  <span>Total to Pay</span>
                  <span>{totalAmt} {symbol}</span>
                </div>
              </div>

              {/* CTA */}
              {!isConnected ? (
                <div style={{ textAlign: 'center', color: '#777587', fontSize: 14 }}>Connect wallet to place a bet</div>
              ) : (
                <button
                  onClick={handleBet}
                  disabled={selectedBucket === null || !amount || step === 'approving' || step === 'betting'}
                  style={{
                    width: '100%', padding: '14px 0', borderRadius: 12,
                    background: selectedBucket !== null && amount ? '#4d41df' : '#c7c4d8',
                    color: '#fff', border: 'none', cursor: selectedBucket !== null && amount ? 'pointer' : 'not-allowed',
                    fontSize: 17, fontWeight: 600,
                    transition: 'all 0.1s',
                  }}
                >
                  {step === 'approving' ? 'Approving…' : step === 'betting' ? 'Confirming…' : step === 'done' ? '✓ Bet Placed!' : 'Place Bet'}
                </button>
              )}

              {errorMsg && (
                <div style={{ fontSize: 13, color: '#ba1a1a', background: '#ffdad6', padding: 10, borderRadius: 8 }}>
                  {errorMsg}
                </div>
              )}

              <p style={{ fontSize: 11, color: '#777587', textAlign: 'center', margin: 0 }}>
                Weather data is finalized via the Tempo Oracle within 24h of market close.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { formatUnits } from 'viem'
import { CITIES, BUCKET_LABELS, MARKET_STATUS, STABLECOINS } from '../config/contracts'
import { useMarket, useUserBets } from '../hooks/useMarket'
import { usePlaceBet } from '../hooks/usePlaceBet'

const network = (import.meta.env.VITE_NETWORK ?? 'mainnet') as 'mainnet' | 'testnet'
const { symbol } = STABLECOINS[network]

function CityBetRow({ city, userAddress }: { city: typeof CITIES[number]; userAddress: `0x${string}` }) {
  const { market, bucketTotals } = useMarket(city.marketId)
  const userBets = useUserBets(city.marketId, userAddress)
  const { claimWinnings, step } = usePlaceBet()

  const status = market?.[4] ?? 0
  const totalPool = market?.[5] ?? 0n
  const winningBucket = market?.[7]
  const noWinner = market?.[9]

  const totalBet = userBets?.reduce((a, b) => a + b, 0n) ?? 0n
  if (totalBet === 0n) return null

  const userBuckets = userBets?.map((amt, i) => ({ amt, i })).filter(b => b.amt > 0n) ?? []

  const statusBadge = status === MARKET_STATUS.OPEN
    ? { label: 'OPEN', color: '#15803d', bg: '#dcfce7' }
    : status === MARKET_STATUS.LOCKED
    ? { label: 'LOCKED', color: '#92400e', bg: '#fef3c7' }
    : { label: 'SETTLED', color: '#3730a3', bg: '#e0e7ff' }

  const targetDate = market?.[2]
    ? new Date(Number(market[2]) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—'

  const canClaim = status === MARKET_STATUS.SETTLED && !noWinner && userBets?.[winningBucket ?? 0] && (userBets?.[winningBucket ?? 0] ?? 0n) > 0n

  function estimateWinnings(bucketIdx: number): string {
    const myBet = userBets?.[bucketIdx] ?? 0n
    const bucketTotal = bucketTotals?.[bucketIdx] ?? 0n
    if (bucketTotal === 0n) return '0'
    const pct = (myBet * 10000n) / bucketTotal
    const gross = (totalPool * pct) / 10000n
    const fee = (gross * 200n) / 10000n
    return Number(formatUnits(gross - fee, 6)).toFixed(2)
  }

  return (
    <tr style={{ borderBottom: '1px solid #edeeef' }}>
      <td style={{ padding: '16px 20px' }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{city.name}</span>
      </td>
      <td style={{ padding: '16px 20px', color: '#464555', fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}>
        {targetDate}
      </td>
      <td style={{ padding: '16px 20px' }}>
        {userBuckets.map(b => (
          <div key={b.i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <span style={{
              background: '#edeeef', padding: '2px 8px', borderRadius: 6,
              fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
              border: status === MARKET_STATUS.SETTLED && winningBucket === b.i ? '1px solid #4d41df' : '1px solid transparent',
              color: status === MARKET_STATUS.SETTLED && winningBucket === b.i ? '#4d41df' : '#191c1d',
              fontWeight: status === MARKET_STATUS.SETTLED && winningBucket === b.i ? 700 : 400,
            }}>
              {BUCKET_LABELS[b.i]}
            </span>
            <span style={{ fontSize: 13, color: '#464555', fontFamily: "'JetBrains Mono', monospace" }}>
              {Number(formatUnits(b.amt, 6)).toFixed(2)} {symbol}
            </span>
          </div>
        ))}
      </td>
      <td style={{ padding: '16px 20px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>
        {Number(formatUnits(totalBet, 6)).toFixed(2)} {symbol}
      </td>
      <td style={{ padding: '16px 20px' }}>
        <span style={{
          padding: '3px 10px', borderRadius: 999,
          background: statusBadge.bg, color: statusBadge.color,
          fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
        }}>
          {statusBadge.label}
        </span>
      </td>
      <td style={{ padding: '16px 20px', textAlign: 'right' }}>
        {status === MARKET_STATUS.OPEN && (
          <span style={{ color: '#4d41df', fontSize: 14, fontWeight: 500 }}>Active</span>
        )}
        {status === MARKET_STATUS.LOCKED && (
          <span style={{ color: '#92400e', fontSize: 14 }}>🔒 Awaiting Oracle</span>
        )}
        {status === MARKET_STATUS.SETTLED && noWinner && (
          <span style={{ color: '#777587', fontSize: 14 }}>No Winner — Refund</span>
        )}
        {canClaim && (
          <div>
            <div style={{ fontSize: 12, color: '#464555', marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>
              Est. {estimateWinnings(winningBucket ?? 0)} {symbol}
            </div>
            <button
              onClick={() => claimWinnings(city.marketId)}
              disabled={step === 'betting'}
              style={{
                background: '#914800', color: '#fff',
                border: 'none', padding: '6px 14px', borderRadius: 8,
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {step === 'betting' ? 'Claiming…' : 'Claim Reward'}
            </button>
          </div>
        )}
        {status === MARKET_STATUS.SETTLED && !noWinner && !canClaim && (
          <span style={{ color: '#ba1a1a', fontSize: 14 }}>Lost</span>
        )}
      </td>
    </tr>
  )
}

export default function MyBets() {
  const { address, isConnected } = useAccount()
  const [filter, setFilter] = useState<'all' | 'active' | 'history'>('all')

  if (!isConnected) {
    return (
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#c7c4d8' }}>account_balance_wallet</span>
        <h2 style={{ color: '#464555', fontWeight: 400, marginTop: 16 }}>Connect wallet to see your bets</h2>
      </div>
    )
  }

  const filterBtns: { key: typeof filter; label: string }[] = [
    { key: 'all', label: 'All Predictions' },
    { key: 'active', label: 'Active' },
    { key: 'history', label: 'History' },
  ]

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600 }}>My Predictions</h1>
        <p style={{ margin: '6px 0 0', color: '#464555', fontSize: 16 }}>
          Manage your active positions and review settlement history.
        </p>
      </div>

      <div style={{ background: '#fff', border: '1px solid #c7c4d8', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #c7c4d8',
          background: '#f3f4f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
        }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {filterBtns.map(b => (
              <button
                key={b.key}
                onClick={() => setFilter(b.key)}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  border: filter === b.key ? '1px solid #c7c4d8' : '1px solid transparent',
                  background: filter === b.key ? '#fff' : 'transparent',
                  color: filter === b.key ? '#4d41df' : '#575e70',
                  boxShadow: filter === b.key ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 13, color: '#777587', fontFamily: "'JetBrains Mono', monospace" }}>
            {address?.slice(0, 8)}…{address?.slice(-6)}
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fff', borderBottom: '1px solid #c7c4d8' }}>
                {['City', 'Target Date', 'Range Bet On', 'Stake', 'Status', 'Result / Action'].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      padding: '12px 20px', textAlign: i >= 3 ? 'right' : 'left',
                      fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                      color: '#464555', letterSpacing: '0.05em', fontWeight: 600,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {address && CITIES.map(city => (
                <CityBetRow key={city.code} city={city} userAddress={address} />
              ))}
            </tbody>
          </table>
          <div style={{ padding: '12px 20px', background: '#f3f4f5', borderTop: '1px solid #c7c4d8', fontSize: 13, color: '#464555' }}>
            Showing markets: {CITIES.map(c => c.name).join(', ')}
          </div>
        </div>
      </div>
    </div>
  )
}

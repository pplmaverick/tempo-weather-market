import { BUCKET_LABELS } from '../config/contracts'
import { formatUnits } from 'viem'

interface Props {
  bucketTotals?: bigint[]
  selectedBucket: number | null
  onSelect: (i: number) => void
  status: number
  winningBucket?: number
}

export default function BucketBar({ bucketTotals, selectedBucket, onSelect, status, winningBucket }: Props) {
  const totalPool = bucketTotals?.reduce((a, b) => a + b, 0n) ?? 0n

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: '#464555', marginBottom: 4 }}>
        TEMPERATURE RANGE SELECTOR
      </div>
      {BUCKET_LABELS.map((label, i) => {
        const bucketTotal = bucketTotals?.[i] ?? 0n
        const pct = totalPool > 0n ? Number((bucketTotal * 100n) / totalPool) : 0
        const isSelected = selectedBucket === i
        const isWinner = status === 2 && winningBucket === i
        const isLocked = status > 0

        return (
          <div
            key={i}
            onClick={() => !isLocked && onSelect(i)}
            style={{ cursor: isLocked ? 'default' : 'pointer' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, padding: '0 2px' }}>
              <span style={{ fontSize: 15, fontWeight: isSelected || isWinner ? 700 : 400, color: isSelected || isWinner ? '#4d41df' : '#191c1d' }}>
                {label}
              </span>
              <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: isSelected ? '#4d41df' : '#464555', fontWeight: isSelected ? 700 : 400 }}>
                {formatUnits(bucketTotal, 6)} USDCE ({pct}%)
              </span>
            </div>
            <div style={{
              width: '100%',
              height: isSelected ? 40 : 32,
              background: '#edeeef',
              borderRadius: 8,
              overflow: 'hidden',
              border: isWinner ? '2px solid #4d41df' : isSelected ? '2px solid #4d41df' : '1px solid #c7c4d8',
              position: 'relative',
              transition: 'height 0.15s',
            }}>
              <div style={{
                width: `${pct}%`,
                height: '100%',
                background: isWinner ? '#4d41df' : '#675df9',
                opacity: isWinner ? 0.4 : isSelected ? 0.25 : 0.15,
                transition: 'width 0.5s ease',
              }} />
              {isWinner && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 6 }}>
                  <span className="material-symbols-outlined" style={{ color: '#4d41df', fontSize: 18 }}>check_circle</span>
                  <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: '#4d41df', fontWeight: 700 }}>WINNER</span>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

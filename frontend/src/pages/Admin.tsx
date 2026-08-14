import { useState } from 'react'
import { useAccount } from 'wagmi'
import { CITIES, MARKET_STATUS, determineWinningBucket } from '../config/contracts'
import { useIsOwner, useCreateMarket, useLockMarket, useSubmitResult } from '../hooks/useAdmin'
import { useMarket } from '../hooks/useMarket'
import { activeChain } from '../config/wagmi'

const explorerBase = activeChain.blockExplorers?.default.url ?? ''

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#464555',
  display: 'block', marginBottom: 6, letterSpacing: '0.03em',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px',
  border: '1px solid #c7c4d8', borderRadius: 8,
  fontSize: 15, fontFamily: "'JetBrains Mono', monospace",
  background: '#f3f4f5', outline: 'none',
  boxSizing: 'border-box',
}

const panelStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #c7c4d8', borderRadius: 12, padding: 24,
}

const primaryBtn = (enabled: boolean): React.CSSProperties => ({
  padding: '12px 0', width: '100%', borderRadius: 10,
  background: enabled ? '#4d41df' : '#c7c4d8',
  color: '#fff', border: 'none', cursor: enabled ? 'pointer' : 'not-allowed',
  fontSize: 15, fontWeight: 600,
})

function TxStatus({ step, txHash, errorMsg, extra }: { step: string; txHash?: string; errorMsg?: string; extra?: React.ReactNode }) {
  if (step === 'idle') return null
  return (
    <div style={{ marginTop: 16 }}>
      {(step === 'pending' || step === 'confirming') && (
        <div style={{ fontSize: 13, color: '#464555' }}>
          {step === 'pending' ? 'Waiting for wallet confirmation…' : 'Confirming on-chain…'}
        </div>
      )}
      {errorMsg && (
        <div style={{ fontSize: 13, color: '#ba1a1a', background: '#ffdad6', padding: 10, borderRadius: 8 }}>
          {errorMsg}
        </div>
      )}
      {txHash && (
        <div style={{ background: '#f3f4f5', border: '1px solid #c7c4d8', borderRadius: 8, padding: 12, marginTop: 8 }}>
          <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#464555', marginBottom: 4 }}>
            {step === 'done' ? '✓ TX CONFIRMED' : 'TX HASH'}
          </div>
          <a
            href={explorerBase ? `${explorerBase}/tx/${txHash}` : undefined}
            target="_blank" rel="noreferrer"
            style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: '#4d41df', wordBreak: 'break-all' }}
          >
            {txHash}
          </a>
          {extra}
        </div>
      )}
    </div>
  )
}

function CreateMarketPanel() {
  const [cityIdx, setCityIdx] = useState(0)
  const [lockTimeLocal, setLockTimeLocal] = useState('')
  const [buckets, setBuckets] = useState(['', '', '', ''])
  const { createMarket, step, txHash, marketId, errorMsg, reset } = useCreateMarket()
  // 只在 mount 時捕捉一次「現在」當作驗證基準，避免在 render 中直接呼叫 Date.now()（impure）。
  // 真正的時效性由送出當下的合約 require(lockTime > block.timestamp) 把關。
  const [nowUnix] = useState(() => Math.floor(Date.now() / 1000))

  const lockTimeUnix = lockTimeLocal ? Math.floor(new Date(lockTimeLocal).getTime() / 1000) : null
  const targetDateUnix = lockTimeUnix ? lockTimeUnix + 3600 : null
  const lockTimeValid = !!lockTimeUnix && lockTimeUnix > nowUnix

  const bucketNums = buckets.map(b => parseFloat(b))
  const bucketsFilled = bucketNums.every(n => !Number.isNaN(n))
  const bucketsAscending = bucketsFilled && bucketNums.every((n, i) => i === 0 || n > bucketNums[i - 1])

  const canSubmit = lockTimeValid && bucketsFilled && bucketsAscending && step !== 'pending' && step !== 'confirming'

  async function handleSubmit() {
    if (!canSubmit || !lockTimeUnix || !targetDateUnix) return
    const bucketsX10 = bucketNums.map(n => BigInt(Math.round(n * 10)))
    await createMarket(CITIES[cityIdx].name, 'HIGH_TEMP', BigInt(targetDateUnix), bucketsX10, BigInt(lockTimeUnix))
  }

  return (
    <div style={panelStyle}>
      <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 600 }}>Create Market</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={labelStyle}>CITY</label>
          <select value={cityIdx} onChange={e => setCityIdx(Number(e.target.value))} style={inputStyle}>
            {CITIES.map((c, i) => <option key={c.code} value={i}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label style={labelStyle}>PREDICTION TYPE</label>
          <div style={{ ...inputStyle, color: '#464555' }}>HIGH_TEMP (fixed)</div>
        </div>

        <div>
          <label style={labelStyle}>LOCK TIME (CLOSE TIME)</label>
          <input
            type="datetime-local"
            value={lockTimeLocal}
            onChange={e => setLockTimeLocal(e.target.value)}
            style={inputStyle}
          />
          {lockTimeLocal && !lockTimeValid && (
            <div style={{ fontSize: 12, color: '#ba1a1a', marginTop: 4 }}>Lock time must be in the future.</div>
          )}
          {targetDateUnix && (
            <div style={{ fontSize: 12, color: '#777587', marginTop: 4 }}>
              Target date (lockTime + 1h): {new Date(targetDateUnix * 1000).toISOString()}
            </div>
          )}
        </div>

        <div>
          <label style={labelStyle}>BUCKET BOUNDARIES (°C, strictly ascending)</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {buckets.map((v, i) => (
              <input
                key={i}
                type="number"
                step="0.1"
                placeholder={`B${i + 1}`}
                value={v}
                onChange={e => setBuckets(prev => prev.map((p, pi) => pi === i ? e.target.value : p))}
                style={inputStyle}
              />
            ))}
          </div>
          {bucketsFilled && !bucketsAscending && (
            <div style={{ fontSize: 12, color: '#ba1a1a', marginTop: 4 }}>Boundaries must be strictly ascending.</div>
          )}
        </div>

        <button onClick={handleSubmit} disabled={!canSubmit} style={primaryBtn(canSubmit)}>
          {step === 'pending' ? 'Confirm in wallet…' : step === 'confirming' ? 'Confirming…' : 'Create Market'}
        </button>

        <TxStatus
          step={step}
          txHash={txHash}
          errorMsg={errorMsg}
          extra={marketId !== undefined && (
            <div style={{ fontSize: 14, color: '#191c1d', marginTop: 8, fontWeight: 600 }}>
              Market ID: #{marketId.toString()}
            </div>
          )}
        />

        {step === 'done' && (
          <button
            onClick={() => { reset(); setLockTimeLocal(''); setBuckets(['', '', '', '']) }}
            style={{ background: 'none', border: 'none', color: '#4d41df', fontSize: 13, cursor: 'pointer', padding: 0, textAlign: 'left' }}
          >
            Create another market
          </button>
        )}
      </div>
    </div>
  )
}

function LockMarketPanel() {
  const [marketIdStr, setMarketIdStr] = useState('')
  const { lockMarket, step, txHash, errorMsg } = useLockMarket()

  const marketIdValid = /^\d+$/.test(marketIdStr)
  const canSubmit = marketIdValid && step !== 'pending' && step !== 'confirming'

  async function handleSubmit() {
    if (!canSubmit) return
    await lockMarket(BigInt(marketIdStr))
  }

  return (
    <div style={panelStyle}>
      <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 600 }}>Lock Market</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={labelStyle}>MARKET ID</label>
          <input
            type="number" min="0" placeholder="e.g. 27"
            value={marketIdStr}
            onChange={e => setMarketIdStr(e.target.value)}
            style={inputStyle}
          />
        </div>
        <button onClick={handleSubmit} disabled={!canSubmit} style={primaryBtn(canSubmit)}>
          {step === 'pending' ? 'Confirm in wallet…' : step === 'confirming' ? 'Confirming…' : 'Lock Market'}
        </button>
        <TxStatus step={step} txHash={txHash} errorMsg={errorMsg} />
      </div>
    </div>
  )
}

function SubmitResultPanel() {
  const [marketIdStr, setMarketIdStr] = useState('')
  const [tempStr, setTempStr] = useState('')
  const marketIdValid = /^\d+$/.test(marketIdStr)
  const marketId = marketIdValid ? BigInt(marketIdStr) : 0n
  const { market, bucketTotals } = useMarket(marketId)
  const { submitResult, step, txHash, errorMsg } = useSubmitResult()

  const cityName = market?.[0] ?? ''
  const predictionType = market?.[1] ?? ''
  const status = market?.[4]
  const buckets = (market?.[8] as readonly bigint[] | undefined) ?? []

  const tempNum = parseFloat(tempStr)
  const tempValid = !Number.isNaN(tempNum)
  const finalTempX10 = tempValid ? BigInt(Math.round(tempNum * 10)) : 0n

  const winningBucket = tempValid && buckets.length > 0 ? determineWinningBucket(buckets, finalTempX10) : null
  const noWinner = winningBucket !== null ? (bucketTotals?.[winningBucket] ?? 0n) === 0n : null
  const outcome = noWinner === null ? '' : (noWinner ? 'NO_WINNER' : 'WIN')
  const memo = cityName && predictionType && winningBucket !== null
    ? `${cityName}/${predictionType}/${finalTempX10}/${outcome}`
    : ''

  const marketFound = marketIdValid && !!cityName
  const isLocked = status === MARKET_STATUS.LOCKED
  const canSubmit = marketFound && isLocked && tempValid && !!memo && step !== 'pending' && step !== 'confirming'

  async function handleSubmit() {
    if (!canSubmit) return
    await submitResult(marketId, finalTempX10, memo)
  }

  return (
    <div style={panelStyle}>
      <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 600 }}>Submit Result</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={labelStyle}>MARKET ID</label>
          <input
            type="number" min="0" placeholder="e.g. 27"
            value={marketIdStr}
            onChange={e => setMarketIdStr(e.target.value)}
            style={inputStyle}
          />
          {marketIdValid && (
            <div style={{ fontSize: 12, color: marketFound ? '#464555' : '#ba1a1a', marginTop: 4 }}>
              {marketFound
                ? `${cityName} (${predictionType}) — status: ${['OPEN', 'LOCKED', 'SETTLED'][status ?? 0]}`
                : 'Market not found.'}
            </div>
          )}
          {marketFound && !isLocked && (
            <div style={{ fontSize: 12, color: '#ba1a1a', marginTop: 4 }}>
              Market must be LOCKED before submitting a result{status === MARKET_STATUS.OPEN ? ' — lock it first.' : ' — already settled.'}
            </div>
          )}
        </div>

        <div>
          <label style={labelStyle}>ACTUAL TEMPERATURE (°C, one decimal)</label>
          <input
            type="number" step="0.1" placeholder="e.g. 32.6"
            value={tempStr}
            onChange={e => setTempStr(e.target.value)}
            style={inputStyle}
          />
        </div>

        {memo && (
          <div style={{ background: '#f3f4f5', border: '1px solid #c7c4d8', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#464555', marginBottom: 4 }}>MEMO PREVIEW</div>
            <div style={{ fontSize: 14, fontFamily: "'JetBrains Mono', monospace", color: '#191c1d' }}>{memo}</div>
          </div>
        )}

        <button onClick={handleSubmit} disabled={!canSubmit} style={primaryBtn(canSubmit)}>
          {step === 'pending' ? 'Confirm in wallet…' : step === 'confirming' ? 'Confirming…' : 'Submit Result'}
        </button>

        <TxStatus step={step} txHash={txHash} errorMsg={errorMsg} />
      </div>
    </div>
  )
}

export default function Admin() {
  const { isConnected } = useAccount()
  const { isOwner, isLoading } = useIsOwner()

  if (!isConnected) {
    return (
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#c7c4d8' }}>account_balance_wallet</span>
        <h2 style={{ color: '#464555', fontWeight: 400, marginTop: 16 }}>Connect the owner wallet to access Admin.</h2>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '60px 24px', textAlign: 'center', color: '#777587' }}>
        Checking wallet permissions…
      </div>
    )
  }

  if (!isOwner) {
    return (
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
        <h2 style={{ color: '#ba1a1a', fontWeight: 600 }}>Access Denied</h2>
        <p style={{ color: '#464555', fontSize: 15 }}>This page is restricted to the contract owner.</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600 }}>Admin</h1>
        <p style={{ margin: '6px 0 0', color: '#464555', fontSize: 16 }}>
          Create markets, lock them at close time, and submit final settlement results.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24, alignItems: 'start' }}>
        <CreateMarketPanel />
        <LockMarketPanel />
        <SubmitResultPanel />
      </div>
    </div>
  )
}

import { NavLink, Outlet } from 'react-router-dom'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'

const network = (import.meta.env.VITE_NETWORK ?? 'mainnet') as 'mainnet' | 'testnet'

export default function Layout() {
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()

  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ''

  return (
    <div style={{ fontFamily: "'Hanken Grotesk', sans-serif" }}>
      <header style={{
        background: '#f8f9fa',
        borderBottom: '1px solid #c7c4d8',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0 24px', maxWidth: 1280, margin: '0 auto', height: 64,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: '#4d41df' }}>
              Tempo Weather Market
            </span>
            <nav style={{ display: 'flex', gap: 24 }}>
              {[
                { to: '/', label: 'Markets' },
                { to: '/my-bets', label: 'My Bets' },
                { to: '/market-status', label: 'Market Status' },
              ].map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  style={({ isActive }) => ({
                    color: isActive ? '#4d41df' : '#575e70',
                    borderBottom: isActive ? '2px solid #4d41df' : '2px solid transparent',
                    paddingBottom: 4,
                    textDecoration: 'none',
                    fontSize: 16,
                    fontWeight: isActive ? 600 : 400,
                  })}
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{
              padding: '6px 12px',
              border: '1px solid #c7c4d8',
              borderRadius: 8,
              fontSize: 13,
              fontFamily: "'JetBrains Mono', monospace",
              color: '#464555',
              background: '#edeeef',
            }}>
              {network === 'mainnet' ? 'Mainnet' : 'Testnet'}
            </span>
            {isConnected ? (
              <button
                onClick={() => disconnect()}
                style={{
                  background: '#edeeef',
                  color: '#191c1d',
                  border: '1px solid #c7c4d8',
                  padding: '8px 16px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 14,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {short}
              </button>
            ) : (
              <button
                onClick={() => connect({ connector: injected() })}
                style={{
                  background: '#4d41df',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 20px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </header>
      <main style={{ flex: 1 }}>
        <Outlet />
      </main>
      <footer style={{
        background: '#f3f4f5',
        borderTop: '1px solid #c7c4d8',
        padding: '24px',
        marginTop: 40,
      }}>
        <div style={{
          maxWidth: 1280, margin: '0 auto',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: 16,
        }}>
          <div>
            <div style={{ fontWeight: 700, color: '#191c1d' }}>Tempo Weather Market</div>
            <div style={{ fontSize: 14, color: '#464555' }}>© 2025 Powered by Tempo Network.</div>
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            {['Documentation', 'Weather Data Sources', 'Terms of Service'].map(l => (
              <a key={l} href="#" style={{ fontSize: 14, color: '#464555', textDecoration: 'none' }}>{l}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}

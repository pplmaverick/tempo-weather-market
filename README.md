# Tempo Weather Market

[![CI](https://github.com/pplmaverick/tempo-weather-market/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/pplmaverick/tempo-weather-market/actions/workflows/test.yml)
![Tempo Mainnet](https://img.shields.io/badge/Tempo_Mainnet-4217-blue)
![Tempo Testnet](https://img.shields.io/badge/Tempo_Testnet-42431-gray)
![Solidity](https://img.shields.io/badge/Solidity-0.8.28-purple)
![License](https://img.shields.io/badge/license-MIT-green)

**[🌐 Live Demo → tempo-weather-market.vercel.app](https://tempo-weather-market.vercel.app)**

Prediction market infrastructure built natively on Tempo Network | Weather as first use case | MPP · Payment Memo · Fee Sponsorship · Scheduled Transactions | pathUSD/USDC settlement

**Deployed on both Testnet and Mainnet.**

| Network | Contract Address |
|---|---|
| Tempo Mainnet (4217) | [`0x072a3a0c04cf8cdcaf5b4a73a4ed4ff5a841531f`](https://explore.tempo.xyz/address/0x072a3a0c04cf8cdcaf5b4a73a4ed4ff5a841531f) |
| Tempo Moderato Testnet (42431) | [`0xcAC5B9d2817325E78090E3Ce4b9C299C819cF953`](https://explore.tempo.xyz/address/0xcAC5B9d2817325E78090E3Ce4b9C299C819cF953) |

## Why Tempo-Native

This project wasn't ported from another chain. Every design decision maps directly to a Tempo protocol capability, and the contract would look meaningfully different — or require off-chain workarounds — on a generic EVM chain.

| Problem | Generic EVM approach | Tempo-native approach |
|---|---|---|
| Oracle needs compensation for settlement work | Side payment, then manual verification | MPP — fee collected atomically inside `submitResult()` |
| Prove what outcome was settled and why | Parse event logs after the fact | Payment Memo — structured string written on-chain at settlement time |
| Users shouldn't need gas tokens just to place a bet | Require users to bridge and hold native token | Fee Sponsorship — relayer submits the tx, gasTank covers the cost |
| Market must stop accepting bets at a precise time | External keeper or cron job | Scheduled Transactions — IScheduler precompile called from within `createMarket()` (built into the contract; not yet enabled on mainnet — see [Scheduled Transactions](#scheduled-transactions) below) |

The result is a contract that handles its own lifecycle end-to-end: markets lock themselves, oracle payments are enforced by the contract rather than by trust, and bettors interact with a single stablecoin approval.

## Architecture

```
oracle-server (Express + TypeScript)
    │
    ├── POST /oracle/settle     ← n8n calls this after lockTime
    ├── GET  /oracle/market/:id ← n8n polls market status
    └── GET  /oracle/health
         │
         ├── WeatherAPI.com + Open-Meteo Archive API  ← dual-source median oracle
         └── WeatherMarket.sol  ← submitResult() on-chain
```

Settlement uses a **dual-source median oracle: WeatherAPI.com + Open-Meteo Archive API**. Each source's individual reading is recorded in the Payment Memo (`wa:`/`om:`) alongside the median `finalTemp`. OpenWeather is used elsewhere in the stack (see below) but is not part of the settlement median.

## Core Features

### MPP (Monetized Protocol Primitives)

The oracle calls `submitResult()` to settle markets. When `oracleFee > 0`, the caller must first transfer stablecoins to the oracle address and provide a verified `paymentTxHash`. The contract records a `SettlementReceipt` for every settled market, queryable via `getReceipt(marketId)`.

### Payment Memo

Every settlement writes a structured memo to the contract:

```
{city}/{predictionType}/{finalTemp}/{outcome}
// e.g. "Tokyo/HIGH_TEMP/315/WIN"
```

The memo is emitted in the `ResultSubmitted` event and stored on-chain, providing a human-readable audit trail for each market outcome.

### Fee Sponsorship

A `gasTank` mechanism allows the contract owner to pre-fund gas costs so that users can bet without holding the native fee token. Approved relayers call `placeBetFor(marketId, bucket, amount, bettor)` on behalf of users — bettors only need to hold and approve the stablecoin.

### Scheduled Transactions

> **Status: implemented in the contract, not yet enabled on mainnet.** The deployed mainnet contract's `scheduler` address is currently `address(0)` (see `deployments/tempo.json`), so this path is inactive. `lockMarket()` is called manually today — via the owner-only [Admin UI](https://tempo-weather-market.vercel.app/admin) (`/admin`) or maintenance scripts — once `lockTime` passes.

When a scheduler address is configured via `setScheduler()`, `createMarket()` calls the `IScheduler` precompile to schedule an automatic `lockMarket()` call at `lockTime`, removing the need for off-chain cron jobs or manual calls.

```solidity
bytes32 taskId = IScheduler(scheduler).schedule(
    address(this),
    abi.encodeCall(this.lockMarket, (marketId)),
    lockTime
);
```

## Network Information

| Network | Chain ID | RPC | Explorer |
|---|---|---|---|
| Tempo Moderato (Testnet) | 42431 | https://rpc.moderato.tempo.xyz | https://explorer.moderato.tempo.xyz |
| Tempo (Mainnet) | 4217 | https://rpc.tempo.xyz | https://explorer.tempo.xyz |

**Stablecoin addresses**

| Network | Token | Address |
|---|---|---|
| Testnet | pathUSD | `0x20c0000000000000000000000000000000000000` |
| Mainnet | USDC.e | `0x20C000000000000000000000b9537d11c60E8b50` |

## Quick Start

### Prerequisites
- Node.js 18+ (the SDK's `npm run generate:abi` runs a `.ts` file directly with Node, tested on Node 24)
- Docker & Docker Compose (for Oracle server)
- WeatherAPI.com key ([free tier](https://www.weatherapi.com/), 1M calls/month) — settlement oracle source
- OpenWeather API key ([free tier](https://openweathermap.org/api)) — powers the live weather-strip display only, not settlement
- Tempo testnet tokens from [faucet](https://faucet.moderato.tempo.xyz/)

### Local Setup

```bash
git clone https://github.com/pplmaverick/tempo-weather-market
cd tempo-weather-market
npm install

# Setup Oracle server
cd oracle-server
cp .env.example .env
# Edit .env: fill in WEATHERAPI_KEY, OPENWEATHER_API_KEY and ORACLE_PRIVATE_KEY
docker compose up -d

# Run tests
cd ..
npx hardhat test
```

### Network Configuration

| Network | Chain ID | RPC | Stablecoin |
|---------|----------|-----|------------|
| Testnet (Moderato) | 42431 | `https://rpc.moderato.tempo.xyz` | pathUSD |
| Mainnet | 4217 | `https://rpc.tempo.xyz` | USDCE |

Switch networks in `oracle-server/.env`:
```
TEMPO_NETWORK=testnet   # or mainnet
```

## Contract Interface

```solidity
// Owner: create a new market
createMarket(city, predictionType, targetDate, buckets, lockTime)

// Anyone: place a bet into a bucket
placeBet(marketId, bucket, amount)

// Relayer (Fee Sponsorship): place a bet on behalf of a user
placeBetFor(marketId, bucket, amount, bettor)

// Anyone: lock the market after lockTime (also called by Scheduler)
lockMarket(marketId)

// Oracle: settle with real weather data (MPP endpoint)
submitResult(marketId, finalTemp, memo)

// Winner: claim winnings after settlement
claimWinnings(marketId)
```

## Temperature Encoding & Bucket System

Temperatures are stored as `int256` with one decimal place precision:

```
315 = 31.5°C
-12 = -1.2°C
```

Bucket boundaries use the same x10 encoding as temperatures. Given `buckets = [250, 280, 310, 340]`:

| Bucket | Range |
|---|---|
| 0 | ≤ 25.0°C |
| 1 | 25.1°C – 28.0°C |
| 2 | 28.1°C – 31.0°C |
| 3 | 31.1°C – 34.0°C |
| 4 | > 34.0°C |

The SDK's `toX10(celsius)` / `fromX10(v)` helpers implement this encoding (`25.0` ↔ `250n`, `-3.4` ↔ `-34n`) and throw on `NaN` / `Infinity`. `toX10` rounds half away from zero, so at a negative `.5` boundary (e.g. `-2.55°C`) it can differ by 1 from the oracle's `Math.round(temp * 10)`. Settlement always uses the `finalTemp` the oracle submits on-chain.

## TypeScript SDK

`sdk/` is a standalone package, `@pplmaverick/tempo-weather-sdk`. It is **not published to npm yet** and can only be used from this repo. It currently provides chain configs (`tempoMainnet`, `moderato`, `withFeeToken`), the WeatherMarket ABI and deployment addresses, x10 temperature encoding, and a **read-only** market client. Write / bet helpers are not implemented.

```ts
import { createWeatherMarketClient, tempoMainnet } from "./sdk/src";

const client = createWeatherMarketClient({ chain: tempoMainnet });
const markets = await client.listMarkets(); // temperatures and buckets in °C, status as "OPEN" | "LOCKED" | "SETTLED"
const market = await client.getMarket(29);
```

`sdk/src/abi.ts` is generated from the Hardhat artifact (`artifacts/` is gitignored, so `abi.ts` is committed). Regenerate it after changing the contract:

```bash
npx hardhat compile            # repo root
cd sdk && npm run generate:abi
```

## Fees & Security

**Fees**
- Market fee: 2% of total pool, deducted from winnings
- Oracle fee: configurable via `setOracleFee()`, paid in stablecoin per settlement
- No winner: all bets refunded in full, no fee taken

**Security**
- Oracle address set at deployment, updatable only by owner
- Relayer whitelist managed by owner
- `ReentrancyGuard` on `claimWinnings`
- All token transfers use OpenZeppelin `SafeERC20`

## Stack

| Layer | Technology |
|---|---|
| Smart contract | Solidity ^0.8.28, OpenZeppelin 5.x |
| Development | Hardhat 3 + Viem |
| Oracle server | Node.js + Express + TypeScript |
| Automation | n8n workflow |
| Testnet stablecoin | pathUSD (`0x20c000...`) |
| Mainnet stablecoin | USDC.e (`0x20C000...`) |

### Milestones

| Milestone | Description | Status |
|-----------|-------------|--------|
| M1 | Deploy to testnet + mainnet, Oracle server on VPS, 44/44 tests | ✅ Complete |
| M2 | Oracle retry logic (3 attempts, 2s delay) | ✅ Complete |
| M3 | Multi-city support: Taipei, Tokyo, New York, Seoul | ✅ Complete |
| M4 | Developer docs: .env.example with inline comments, README setup guide | ✅ Complete |
| M5 | React frontend on Vercel | ✅ Complete |
| M6 | Dual-source weather median oracle: WeatherAPI + Open-Meteo (OpenWeather History API is not available on this key's plan, dropped from settlement) | ✅ Complete |
| M7 | TypeScript SDK (`sdk/`) — read-only client done; write / bet helpers not yet implemented | 🚧 In progress |

## Developer

GitHub: [pplmaverick](https://github.com/pplmaverick)
Wallet: `0xed2B...78F5` — deployed on both Tempo Testnet and Mainnet

## License

MIT


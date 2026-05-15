# Tempo Weather Market

A decentralized weather prediction market built on the [Tempo](https://tempo.xyz) blockchain, showcasing four native Tempo protocol features: **MPP**, **Payment Memo**, **Fee Sponsorship**, and **Scheduled Transactions**.

## Overview

Users bet on weather outcomes (e.g., tomorrow's high temperature in Tokyo) using stablecoins. An oracle server fetches real weather data after the market closes, settles the contract, and pays out winners — all on-chain, automated, and trustless.

- **Testnet (Moderato):** `0xcAC5B9d2817325E78090E3Ce4b9C299C819cF953`
- **Mainnet:** `0x072a3a0c04cf8cdcaf5b4a73a4ed4ff5a841531f`

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
When creating a market, the contract calls the `IScheduler` precompile to schedule an automatic `lockMarket()` call at `lockTime`. No off-chain cron jobs needed for market locking.

```solidity
bytes32 taskId = IScheduler(scheduler).schedule(
    address(this),
    abi.encodeCall(this.lockMarket, (marketId)),
    lockTime
);
```

## Architecture

```
oracle-server (Express + TypeScript)
    │
    ├── POST /oracle/settle     ← n8n calls this after lockTime
    ├── GET  /oracle/market/:id ← n8n polls market status
    └── GET  /oracle/health
         │
         ├── OpenWeather API    ← fetch real weather data
         └── WeatherMarket.sol  ← submitResult() on-chain
```

**Stack:**
- Smart contract: Solidity `^0.8.28`, OpenZeppelin 5.x
- Development: Hardhat 3 + Viem
- Oracle server: Node.js + Express + TypeScript
- Automation: n8n workflow
- Testnet stablecoin: pathUSD (`0x20c0000000000000000000000000000000000000`)
- Mainnet stablecoin: USDC.e (`0x20C000000000000000000000b9537d11c60E8b50`)

## Network Information

| Network | Chain ID | RPC | Explorer |
|---------|----------|-----|----------|
| Tempo Moderato (Testnet) | 42431 | `https://rpc.moderato.tempo.xyz` | `https://explorer.moderato.tempo.xyz` |
| Tempo (Mainnet) | 4217 | `https://rpc.tempo.xyz` | `https://explorer.tempo.xyz` |

## Quick Start

### Prerequisites

- Node.js 18+
- An OpenWeather API key
- A funded wallet on Tempo Moderato (testnet) or Tempo (mainnet)

### 1. Install dependencies

```bash
npm install
cd oracle-server && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Description |
|----------|-------------|
| `PRIVATE_KEY` | Deployer wallet private key (no `0x` prefix) |
| `ORACLE_ADDRESS` | Oracle service wallet address |
| `PATHUSD_ADDRESS` | pathUSD contract address (testnet) |
| `USDCE_ADDRESS` | USDC.e contract address (mainnet) |
| `SCHEDULER_ADDRESS` | Tempo Scheduler precompile address (leave empty to disable) |
| `ORACLE_FEE_AMOUNT` | MPP fee per settlement, in stablecoin units (default: `"0"`) |

### 3. Compile contracts

```bash
npx hardhat compile
```

### 4. Run tests

```bash
npx hardhat test
```

### 5. Deploy

**Testnet:**
```bash
npx hardhat run scripts/deploy.ts --network moderato
```

**Mainnet:**
```bash
npx hardhat run scripts/deploy.ts --network tempo
```

Deployment records are saved to `deployments/<network>.json`.

### 6. Start the oracle server

```bash
cp oracle-server/.env.example oracle-server/.env
# fill in oracle-server/.env
cd oracle-server && npm start
```

The oracle server starts on port `3001` (configurable via `ORACLE_PORT`).

**Health check:**
```bash
curl http://localhost:3001/oracle/health
```

### 7. Configure n8n

Set up an n8n workflow to:
1. Poll `GET /oracle/market/:marketId` after each market's `lockTime`
2. Call `POST /oracle/settle` with `{ "marketId": N }` when status is `LOCKED`

## Contract Interface (Key Functions)

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

### Temperature Encoding

Temperatures are stored as `int256` with one decimal place precision:

```
315 = 31.5°C
-12 = -1.2°C
```

### Bucket System

Markets define temperature ranges as an ascending array of upper bounds. Given `buckets = [25, 28, 31, 34]`, the prediction ranges are:

| Bucket | Range |
|--------|-------|
| 0 | ≤ 25°C |
| 1 | 26°C – 28°C |
| 2 | 29°C – 31°C |
| 3 | 32°C – 34°C |
| 4 | > 34°C |

## Fees

- **Market fee:** 2% of total pool, deducted from winnings
- **Oracle fee:** configurable via `setOracleFee()`, paid in stablecoin by the oracle on each settlement call
- **No winner:** if no bets were placed in the winning bucket, all bets are refunded in full (no fee taken)

## Security

- Oracle address is set at deployment and updatable only by the owner
- Relayer whitelist is managed by the owner
- `ReentrancyGuard` on `claimWinnings`
- All token transfers use OpenZeppelin `SafeERC20`
- API keys and private keys must be stored in `.env` (never committed)

## License

MIT

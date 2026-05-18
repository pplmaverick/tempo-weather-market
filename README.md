# Tempo Weather Market

![Tempo Mainnet](https://img.shields.io/badge/Tempo_Mainnet-4217-blue)
![Tempo Testnet](https://img.shields.io/badge/Tempo_Testnet-42431-gray)
![Solidity](https://img.shields.io/badge/Solidity-0.8.28-purple)
![License](https://img.shields.io/badge/license-MIT-green)

A decentralized weather prediction market built natively on the Tempo blockchain. Every design decision maps to a Tempo protocol primitive — MPP, Payment Memo, Fee Sponsorship, and Scheduled Transactions — making this a purpose-built implementation, not an EVM port.

**Deployed on both Testnet and Mainnet.**

| Network | Contract Address |
|---|---|
| Tempo Mainnet (4217) | `0x072a3a0c04cf8cdcaf5b4a73a4ed4ff5a841531f` |
| Tempo Moderato Testnet (42431) | `0xcAC5B9d2817325E78090E3Ce4b9C299C819cF953` |

## Why Tempo-Native

This project wasn't ported from another chain. Every design decision maps directly to a Tempo protocol capability, and the contract would look meaningfully different — or require off-chain workarounds — on a generic EVM chain.

| Problem | Generic EVM approach | Tempo-native approach |
|---|---|---|
| Oracle needs compensation for settlement work | Side payment, then manual verification | MPP — fee collected atomically inside `submitResult()` |
| Prove what outcome was settled and why | Parse event logs after the fact | Payment Memo — structured string written on-chain at settlement time |
| Users shouldn't need gas tokens just to place a bet | Require users to bridge and hold native token | Fee Sponsorship — relayer submits the tx, gasTank covers the cost |
| Market must stop accepting bets at a precise time | External keeper or cron job | Scheduled Transactions — IScheduler precompile called from within `createMarket()` |

The result is a contract that handles its own lifecycle end-to-end: markets lock themselves, oracle payments are enforced by the contract rather than by trust, and bettors interact with a single stablecoin approval.

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

**Prerequisites**
- Node.js 18+
- An OpenWeather API key
- A funded wallet on Tempo Moderato (testnet) or Tempo (mainnet)

```bash
# 1. Install dependencies
npm install
cd oracle-server && npm install && cd ..

# 2. Configure environment
cp .env.example .env
```

| Variable | Description |
|---|---|
| `PRIVATE_KEY` | Deployer wallet private key (no 0x prefix) |
| `ORACLE_ADDRESS` | Oracle service wallet address |
| `PATHUSD_ADDRESS` | pathUSD contract address (testnet) |
| `USDCE_ADDRESS` | USDC.e contract address (mainnet) |
| `SCHEDULER_ADDRESS` | Tempo Scheduler precompile address (leave empty to disable) |
| `ORACLE_FEE_AMOUNT` | MPP fee per settlement, in stablecoin units (default: "0") |

```bash
# 3. Compile contracts
npx hardhat compile

# 4. Run tests
npx hardhat test

# 5. Deploy to testnet
npx hardhat run scripts/deploy.ts --network moderato

# 5. Deploy to mainnet
npx hardhat run scripts/deploy.ts --network tempo

# 6. Start the oracle server
cp oracle-server/.env.example oracle-server/.env
cd oracle-server && npm start

# Health check
curl http://localhost:3001/oracle/health
```

**n8n Setup**

Set up an n8n workflow to:
1. Poll `GET /oracle/market/:marketId` after each market's `lockTime`
2. Call `POST /oracle/settle` with `{ "marketId": N }` when status is `LOCKED`

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

Given `buckets = [25, 28, 31, 34]`:

| Bucket | Range |
|---|---|
| 0 | ≤ 25°C |
| 1 | 26°C – 28°C |
| 2 | 29°C – 31°C |
| 3 | 32°C – 34°C |
| 4 | > 34°C |

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

## Roadmap

- ✅ P1 — Tempo Moderato testnet setup, dev wallet funded
- ✅ P2 — Hardhat environment + stablecoin integration (pathUSD testnet / USDC.e mainnet)
- ✅ P3 — Core contracts deployed: Tempo-native MPP, Payment Memo, Fee Sponsorship, Scheduled Transactions
- ✅ P4 — Oracle server deployed to VPS (Docker Compose, dual-network switching via `TEMPO_NETWORK` env var)
- ✅ P5 — Mainnet deployment (`0x072a3a...531f`)
- ✅ P6 — 40/40 tests passing (deployment / createMarket / placeBet / lockMarket / submitResult+MPP / claimWinnings / Fee Sponsorship / Gas Tank / admin)
- ⬜ P7 — End-to-end testnet flow: create market → place bet → oracle settlement → claim winnings
- ⬜ P8 — First batch improvements: oracle retry logic, frontend, Oracle server Dockerized, multi-city support (Tokyo / New York / Seoul)
- ⬜ P9 — Second batch: multi-source weather median (OpenWeather + WeatherAPI), structured settlement log, TypeScript SDK (`createMarket`, `placeBet` wrappers)

## Developer

GitHub: [pplmaverick](https://github.com/pplmaverick)
Wallet: `0xed2B...78F5` — deployed on both Tempo Testnet and Mainnet

## License

MIT


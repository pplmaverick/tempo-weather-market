import "dotenv/config";
import express from "express";
import { oracleRouter } from "./routes/oracle.js";
import { networkInfo } from "./services/chain.js";

const app = express();
const PORT = parseInt(process.env.ORACLE_PORT ?? "3001", 10);

// ─── 必填環境變數檢查 ─────────────────────────────────────────────────────────

const isMainnet = (process.env.TEMPO_NETWORK ?? "testnet") === "mainnet";

const required = [
  "ORACLE_PRIVATE_KEY",
  "OPENWEATHER_API_KEY",
  "ORACLE_SECRET",
  "ORACLE_ADDRESS",
  // 依網路決定需要哪組合約 + stablecoin 地址
  ...(isMainnet
    ? ["CONTRACT_ADDRESS_MAINNET", "USDCE_ADDRESS"]
    : ["CONTRACT_ADDRESS", "PATHUSD_ADDRESS"]),
];

const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`[startup] 缺少必填環境變數: ${missing.join(", ")}`);
  process.exit(1);
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/oracle", oracleRouter);

app.get("/", (_req, res) => {
  res.json({ service: "WeatherMarket Oracle Server", version: "1.0.0" });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[oracle] 啟動成功，port ${PORT}`);
  console.log(`[oracle] 網路: ${networkInfo.network} (chainId ${networkInfo.chainId})`);
  console.log(`[oracle] 合約: ${networkInfo.contractAddress}`);
  console.log(`[oracle] Stablecoin: ${networkInfo.stablecoinSymbol} (${networkInfo.stablecoinAddress})`);
  console.log(`[oracle] RPC: ${networkInfo.rpcUrl}`);
  console.log(`[oracle] 健康檢查: GET /oracle/health`);
});

import "dotenv/config";
import cors from "cors";
import express from "express";
import { discovery } from "mppx/express";
import { oracleRouter, mppx, weatherPay } from "./routes/oracle.js";
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
  "MPP_SECRET_KEY",
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

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://frontend-phi-virid-98.vercel.app',
    /\.vercel\.app$/,
  ],
}));

app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/oracle", oracleRouter);

discovery(app, mppx, {
  info: { title: "Weather Oracle API", version: "1.0.0" },
  routes: [{ handler: weatherPay, method: "get", path: "/oracle/weather/:city" }],
});

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

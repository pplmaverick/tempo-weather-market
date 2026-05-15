import "dotenv/config";
import express from "express";
import { oracleRouter } from "./routes/oracle.js";

const app = express();
const PORT = parseInt(process.env.ORACLE_PORT ?? "3001", 10);

// ─── 必填環境變數檢查 ─────────────────────────────────────────────────────────

const required = [
  "ORACLE_PRIVATE_KEY",
  "CONTRACT_ADDRESS",
  "OPENWEATHER_API_KEY",
  "ORACLE_SECRET",
  "PATHUSD_ADDRESS",
  "ORACLE_ADDRESS",
];

const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`[startup] 缺少必填環境變數: ${missing.join(", ")}`);
  process.exit(1);
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());

// 簡單的 request log
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/oracle", oracleRouter);

// 根路徑
app.get("/", (_req, res) => {
  res.json({ service: "WeatherMarket Oracle Server", version: "1.0.0" });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[oracle] 啟動成功，port ${PORT}`);
  console.log(`[oracle] 合約: ${process.env.CONTRACT_ADDRESS}`);
  console.log(`[oracle] RPC: ${process.env.RPC_URL}`);
  console.log(`[oracle] 健康檢查: GET /oracle/health`);
});

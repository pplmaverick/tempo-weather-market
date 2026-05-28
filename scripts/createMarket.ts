/**
 * WeatherMarket 建立市場腳本
 *
 * testnet 用法:
 *   npx hardhat run scripts/createMarket.ts --network moderato -- --city Tokyo
 *
 * 支援城市（--city）:
 *   Taipei（預設）/ Tokyo / New_York / Seoul
 *
 * bucket 範圍（x10 encoding，e.g. 315 = 31.5°C）:
 *   Taipei   : ≤250 / 251-280 / 281-310 / 311-340 / >340
 *   Tokyo    : ≤200 / 201-250 / 251-300 / 301-350 / >350
 *   New York : ≤100 / 101-150 / 151-200 / 201-250 / >250
 *   Seoul    : ≤150 / 151-200 / 201-250 / 251-300 / >300
 *
 * 必填 .env:
 *   PRIVATE_KEY   部署者私鑰（不含 0x）
 */

import hre from "hardhat";
import { decodeEventLog, type Hex } from "viem";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

// ─── 城市設定 ──────────────────────────────────────────────────────────────────

type SupportedCity = "Taipei" | "Tokyo" | "New York" | "Seoul";

const CITY_CONFIG: Record<SupportedCity, { buckets: bigint[]; label: string }> = {
  Taipei:     { buckets: [250n, 280n, 310n, 340n], label: "夏季高溫 ≤25/25.1-28/28.1-31/31.1-34/>34°C" },
  Tokyo:      { buckets: [200n, 250n, 300n, 350n], label: "≤20/20.1-25/25.1-30/30.1-35/>35°C" },
  "New York": { buckets: [100n, 150n, 200n, 250n], label: "≤10/10.1-15/15.1-20/20.1-25/>25°C" },
  Seoul:      { buckets: [150n, 200n, 250n, 300n], label: "≤15/15.1-20/20.1-25/25.1-30/>30°C" },
};

// ─── 解析 --city 參數 ──────────────────────────────────────────────────────────

function parseCity(): SupportedCity {
  const idx = process.argv.indexOf("--city");
  if (idx === -1) return "Taipei";

  const raw = process.argv[idx + 1];
  if (!raw || raw.startsWith("--")) {
    throw new Error("--city 後面需要城市名稱");
  }

  const name = raw.replace(/_/g, " ") as SupportedCity; // New_York → New York
  if (!(name in CITY_CONFIG)) {
    throw new Error(
      `不支援的城市：${name}\n支援城市：${Object.keys(CITY_CONFIG).join(" / ")}`
    );
  }
  return name;
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

async function main() {
  const connection = await hre.network.connect();
  const networkName = connection.networkName;

  if (!["moderato", "tempo"].includes(networkName)) {
    throw new Error(`請用 --network moderato 或 --network tempo，目前：${networkName}`);
  }

  // 讀取部署記錄
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const deployPath = resolve(__dirname, `../deployments/${networkName}.json`);
  let deploy: { contractAddress: string };
  try {
    deploy = JSON.parse(readFileSync(deployPath, "utf-8"));
  } catch {
    throw new Error(`找不到部署記錄：${deployPath}\n請先執行 scripts/deploy.ts`);
  }

  const contractAddr = deploy.contractAddress as Hex;
  const city = parseCity();
  const { buckets, label } = CITY_CONFIG[city];

  const [owner] = await connection.viem.getWalletClients();
  const publicClient = await connection.viem.getPublicClient();
  const artifact = await hre.artifacts.readArtifact("WeatherMarket");

  // 市場時間設定：30 分鐘後鎖倉，明天為目標日期
  const now = BigInt(Math.floor(Date.now() / 1000));
  const lockTime   = now + 1800n;   // +30 分鐘
  const targetDate = now + 86400n;  // +24 小時

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log(`║  WeatherMarket — createMarket`);
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`\n  網路       : ${networkName}`);
  console.log(`  合約       : ${contractAddr}`);
  console.log(`  城市       : ${city}`);
  console.log(`  bucket 範圍: ${label}`);
  console.log(`  buckets    : [${buckets.join(", ")}] → ${buckets.length + 1} 個區間`);
  console.log(`  lockTime   : ${new Date(Number(lockTime) * 1000).toISOString()} (+30m)`);
  console.log(`  targetDate : ${new Date(Number(targetDate) * 1000).toISOString()} (+24h)`);

  const txHash = await owner.writeContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "createMarket",
    args: [city, "HIGH_TEMP", targetDate, buckets, lockTime],
  });

  console.log(`\n  tx hash: ${txHash}`);
  console.log("  等待確認...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`createMarket tx revert: ${txHash}`);
  }

  // 從 MarketCreated event 解析 marketId
  let marketId: bigint | null = null;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: artifact.abi,
        data: log.data,
        topics: log.topics,
        eventName: "MarketCreated",
      });
      marketId = (decoded.args as { marketId: bigint }).marketId;
      break;
    } catch { /* skip non-matching logs */ }
  }

  console.log(`\n  ✓ 市場建立成功！marketId = ${marketId ?? "（解析失敗，請查鏈上事件）"}`);
  console.log(`  城市: ${city} | predictionType: HIGH_TEMP`);
  console.log();

  await connection.close();
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n✗ 失敗：${message}\n`);
  process.exitCode = 1;
});

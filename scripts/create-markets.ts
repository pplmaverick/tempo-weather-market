/**
 * 在 Tempo Mainnet 一次開啟四個城市市場 — Market #21-24
 *
 * 城市：Taipei / Tokyo / New York / Seoul
 * 時間：lockTime = 2026-07-28T13:23:37Z（固定絕對時間，維持與上一輪同一時間點 +7 天）
 *       targetDate = lockTime + 1h
 * buckets：以 2026-07-23 查詢的即時氣溫為中心，間距 3°C（沿用上一輪設計）
 *
 * 執行方式：
 *   npx hardhat run scripts/create-markets.ts --network tempo
 */
import {
  createWalletClient,
  createPublicClient,
  http,
  decodeEventLog,
  type Hex,
} from "viem";
import { tempo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import hre from "hardhat";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

// ─── 城市設定（bucket 值為 °C × 10）─────────────────────────────────────────
const CITIES = [
  { name: "Taipei",   buckets: [250n, 280n, 310n, 340n] },
  { name: "Tokyo",    buckets: [250n, 280n, 310n, 340n] },
  { name: "New York", buckets: [130n, 160n, 190n, 220n] },
  { name: "Seoul",    buckets: [220n, 250n, 280n, 310n] },
] as const;

// ─── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const deploy = JSON.parse(
    readFileSync(resolve(__dirname, "../deployments/tempo.json"), "utf-8"),
  );
  const contractAddr = deploy.contractAddress as Hex;
  const usdcAddr = deploy.stablecoin.address as Hex;

  const artifact = await hre.artifacts.readArtifact("WeatherMarket");

  const mainnetChain = { ...tempo, feeToken: usdcAddr };
  const rpcUrl = process.env.TEMPO_RPC_URL ?? "https://rpc.tempo.xyz";

  const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY}` as Hex);
  const walletClient = createWalletClient({
    account,
    chain: mainnetChain,
    transport: http(rpcUrl),
  });
  const publicClient = createPublicClient({
    chain: mainnetChain,
    transport: http(rpcUrl),
  });

  // 時間設定（固定絕對時間，與上一輪同一時間點 +7 天）
  const lockTime   = 1785245017; // 2026-07-28T13:23:37Z
  const targetDate = 1785248617; // 2026-07-28T14:23:37Z (lockTime + 1h)

  console.log("=".repeat(60));
  console.log("  Tempo WeatherMarket — 開啟四個市場（Market #21-24）");
  console.log("=".repeat(60));
  console.log(`  錢包       : ${account.address}`);
  console.log(`  合約       : ${contractAddr}`);
  console.log(`  lockTime   : ${new Date(lockTime * 1000).toISOString()}`);
  console.log(`  targetDate : ${new Date(targetDate * 1000).toISOString()}`);

  const nextMarketId = (await publicClient.readContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "nextMarketId",
  })) as bigint;
  console.log(`\n  目前 nextMarketId : ${nextMarketId}`);
  console.log(`  預計市場 #        : ${nextMarketId} ~ ${nextMarketId + 3n}`);

  const results: { city: string; marketId: bigint; txHash: Hex }[] = [];

  for (let i = 0; i < CITIES.length; i++) {
    const { name: city, buckets } = CITIES[i];

    console.log("\n" + "─".repeat(60));
    console.log(`[${i + 1}/4] 建立市場：${city}`);
    console.log(`  buckets : [${buckets.join(", ")}] → ${buckets.length + 1} 個區間`);

    const txHash = await walletClient.writeContract({
      address: contractAddr,
      abi: artifact.abi,
      functionName: "createMarket",
      args: [city, "HIGH_TEMP", BigInt(targetDate), [...buckets], BigInt(lockTime)],
    });

    console.log(`  tx hash : ${txHash}`);
    console.log("  等待確認...");

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`createMarket 失敗（revert），city=${city}，hash=${txHash}`);
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

    if (marketId === null) {
      const updated = (await publicClient.readContract({
        address: contractAddr,
        abi: artifact.abi,
        functionName: "nextMarketId",
      })) as bigint;
      marketId = updated - 1n;
      console.log(`  ⚠️  事件解析失敗，推算 marketId = ${marketId}`);
    }

    console.log(`  ✓ marketId = ${marketId}`);
    results.push({ city, marketId, txHash });
  }

  // ─── 摘要 ───────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("  ✅  四個市場全部建立完成！");
  console.log("=".repeat(60));
  for (const r of results) {
    console.log(`\n  【${r.city}】`);
    console.log(`    marketId : ${r.marketId}`);
    console.log(`    tx hash  : ${r.txHash}`);
  }
  console.log();
}

main().catch((err) => {
  console.error("\n❌ 錯誤:", err.shortMessage ?? err.message);
  if (err.details) console.error("詳情:", err.details);
  if (err.cause) console.error("原因:", err.cause?.shortMessage ?? err.cause?.message);
  process.exit(1);
});

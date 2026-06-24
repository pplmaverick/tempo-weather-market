/**
 * 在 Tempo Mainnet 一次開啟四個城市市場（7 天結算窗口）
 *
 * 城市：Taipei / Tokyo / New York / Seoul
 * 時間：lockTime = now + 6d23h，targetDate = now + 7d
 *
 * 執行方式：
 *   npx hardhat run scripts/createFourMarkets.ts --network tempo
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
  { name: "Tokyo",    buckets: [220n, 250n, 280n, 310n] },
  { name: "New York", buckets: [200n, 230n, 260n, 290n] },
  { name: "Seoul",    buckets: [200n, 230n, 260n, 290n] },
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

  // 時間設定
  const now = Math.floor(Date.now() / 1000);
  const lockTime   = now + 6 * 86400 + 23 * 3600; // +6d23h = 601200s
  const targetDate = now + 7 * 86400;              // +7d    = 604800s

  console.log("=".repeat(60));
  console.log("  Tempo WeatherMarket — 開啟四個市場（7 天窗口）");
  console.log("=".repeat(60));
  console.log(`  錢包       : ${account.address}`);
  console.log(`  合約       : ${contractAddr}`);
  console.log(`  lockTime   : ${new Date(lockTime * 1000).toISOString()} (+6d23h)`);
  console.log(`  targetDate : ${new Date(targetDate * 1000).toISOString()} (+7d)`);

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

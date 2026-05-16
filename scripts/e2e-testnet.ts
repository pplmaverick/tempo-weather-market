/**
 * Tempo Moderato Testnet 完整 e2e 測試腳本
 *
 * 流程：建市場 → 下注 → 等候鎖倉 → lockMarket → submitResult → claimWinnings
 *
 * 說明：
 *   - 網路：Tempo Moderato testnet（chainId 42431）
 *   - 結算幣：pathUSD（native token，同時支援 ERC-20 precompile 0x20c0...）
 *   - dev 錢包 = oracle 地址 → 可直接呼叫 submitResult
 *   - Oracle HTTP server 目前在 mainnet 模式，testnet 結算走直接合約呼叫
 *
 * 執行方式：
 *   npx hardhat run scripts/e2e-testnet.ts --network moderato
 */
import {
  createWalletClient,
  createPublicClient,
  http,
  decodeEventLog,
  maxUint256,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { tempoModerato } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import hre from "hardhat";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

// ─── 常數 ──────────────────────────────────────────────────────────────────────
// pathUSD precompile 實際 decimals = 6（deployment.json 記錯，以 decimals() 為準）
const PATHUSD_DECIMALS = 6n;
const e6 = (n: number) => BigInt(n) * 10n ** PATHUSD_DECIMALS;

const STATUS_LABEL = ["OPEN", "LOCKED", "SETTLED"] as const;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function assertSuccess(receipt: TransactionReceipt, label: string) {
  if (receipt.status !== "success") {
    throw new Error(`${label} tx 失敗（revert），hash: ${receipt.transactionHash}`);
  }
}

async function waitUntil(targetTs: number, label: string) {
  const now = Math.floor(Date.now() / 1000);
  const remaining = targetTs - now;
  if (remaining <= 0) return;
  console.log(`  ⏳ 等待 ${remaining} 秒 (${label})...`);
  for (let i = remaining; i > 0; i -= 5) {
    process.stdout.write(`\r  剩餘 ${i} 秒  `);
    await sleep(Math.min(5000, i * 1000));
  }
  console.log("\r  ✓ 時間到！       ");
}

// 最小 ERC-20 ABI（pathUSD precompile 支援標準 ERC-20 介面）
const erc20Abi = [
  {
    name: "approve",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "spender", type: "address" as const },
      { name: "amount", type: "uint256" as const },
    ],
    outputs: [{ type: "bool" as const }],
  },
  {
    name: "balanceOf",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "account", type: "address" as const }],
    outputs: [{ type: "uint256" as const }],
  },
] as const;

// ─── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
  // ── 讀取部署資訊 ────────────────────────────────────────────────────────────
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const deploy = JSON.parse(
    readFileSync(resolve(__dirname, "../deployments/moderato.json"), "utf-8"),
  );
  const contractAddr = deploy.contractAddress as Hex;
  const pathUSDAddr = deploy.stablecoin.address as Hex;

  const artifact = await hre.artifacts.readArtifact("WeatherMarket");

  // ── 設定 viem clients ──────────────────────────────────────────────────────
  const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY}` as Hex);
  const walletClient = createWalletClient({
    account,
    chain: tempoModerato,
    transport: http(process.env.MODERATO_RPC_URL ?? "https://rpc.moderato.tempo.xyz"),
  });
  const publicClient = createPublicClient({
    chain: tempoModerato,
    transport: http(process.env.MODERATO_RPC_URL ?? "https://rpc.moderato.tempo.xyz"),
  });

  console.log("=".repeat(60));
  console.log("  Tempo WeatherMarket Testnet e2e（Moderato）");
  console.log("=".repeat(60));
  console.log(`  錢包     : ${account.address}`);
  console.log(`  合約     : ${contractAddr}`);
  console.log(`  pathUSD  : ${pathUSDAddr}`);
  console.log(`  chainId  : ${tempoModerato.id}`);

  // ── 查詢餘額 ────────────────────────────────────────────────────────────────
  const pathUSDBal = (await publicClient.readContract({
    address: pathUSDAddr,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  const nextMarketId = (await publicClient.readContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "nextMarketId",
  })) as bigint;
  const oracleFee = (await publicClient.readContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "oracleFee",
  })) as bigint;

  console.log(`\n  pathUSD 餘額     : ${(Number(pathUSDBal) / 1e6).toFixed(2)} pathUSD`);
  console.log(`  nextMarketId     : ${nextMarketId}`);
  console.log(`  oracleFee        : ${oracleFee}`);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1：建立市場
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("STEP 1：建立市場");
  console.log("─".repeat(60));

  const now = Math.floor(Date.now() / 1000);
  const LOCK_DELAY = 90;    // 90 秒後可鎖倉
  const TARGET_DELAY = 180; // 180 秒後是目標日期

  const lockTime = now + LOCK_DELAY;
  const targetDate = now + TARGET_DELAY;
  // 溫度單位：°C × 10（合約慣例，weather.js 也回傳 °C × 10）
  const buckets: bigint[] = [250n, 280n, 310n, 340n];
  const city = "Taipei";
  const predictionType = "HIGH_TEMP";

  console.log(`  city          : ${city}`);
  console.log(`  predictionType: ${predictionType}`);
  console.log(`  buckets       : [${buckets.join(", ")}] → 5 個區間`);
  console.log(`  lockTime      : ${new Date(lockTime * 1000).toISOString()} (+${LOCK_DELAY}s)`);
  console.log(`  targetDate    : ${new Date(targetDate * 1000).toISOString()} (+${TARGET_DELAY}s)`);

  const createHash = await walletClient.writeContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "createMarket",
    args: [city, predictionType, BigInt(targetDate), buckets, BigInt(lockTime)],
    // 不設 gas，讓 viem 自動 eth_estimateGas（需 ~2.58M on Moderato）
  });
  console.log(`\n  tx hash: ${createHash}`);
  console.log("  等待確認...");

  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
  assertSuccess(createReceipt, "createMarket");

  let marketId: bigint | null = null;
  for (const log of createReceipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: artifact.abi,
        data: log.data,
        topics: log.topics,
        eventName: "MarketCreated",
      });
      marketId = (decoded.args as { marketId: bigint }).marketId;
      break;
    } catch { /* skip */ }
  }

  if (marketId === null) {
    // fallback: 直接讀 nextMarketId - 1
    const updated = (await publicClient.readContract({
      address: contractAddr,
      abi: artifact.abi,
      functionName: "nextMarketId",
    })) as bigint;
    marketId = updated - 1n;
    console.log(`  ⚠️  無法解析事件，推算 marketId = ${marketId}`);
  }

  console.log(`\n  ✓ 市場建立成功！marketId = ${marketId}`);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2：Approve pathUSD + 下注
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("STEP 2：Approve pathUSD + 下注");
  console.log("─".repeat(60));

  console.log("  Approve pathUSD（ERC-20 precompile，需 ~280k gas）...");
  const approveHash = await walletClient.writeContract({
    address: pathUSDAddr,
    abi: erc20Abi,
    functionName: "approve",
    args: [contractAddr, maxUint256],
  });
  const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
  assertSuccess(approveReceipt, "approve");
  console.log(`  ✓ Approve 完成 (tx: ${approveHash})`);

  // 下注 10 pathUSD 在 bucket 2（280-310 = 28.0-31.0°C），預期溫度 30.0°C 得獎
  const betBucket = 2;
  const betAmount = e6(10); // 10 pathUSD（decimals=6）

  console.log(`\n  下注 10 pathUSD 在 bucket ${betBucket} (280-310 = 28.0-31.0°C)...`);
  const betHash = await walletClient.writeContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "placeBet",
    args: [marketId, betBucket, betAmount],
    // 不設 gas，viem 自動估算（需 ~1.58M on Moderato）
  });
  const betReceipt = await publicClient.waitForTransactionReceipt({ hash: betHash });
  assertSuccess(betReceipt, "placeBet");
  console.log(`  ✓ 下注成功 (tx: ${betHash})`);

  // 確認市場狀態
  const marketAfterBet = (await publicClient.readContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "getMarket",
    args: [marketId],
  })) as unknown[];
  const totalPoolAfterBet = marketAfterBet[5] as bigint;
  console.log(`  totalPool : ${Number(totalPoolAfterBet) / 1e6} pathUSD`);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3：等待 lockTime → lockMarket
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("STEP 3：等待鎖倉時間 → lockMarket");
  console.log("─".repeat(60));

  await waitUntil(lockTime + 2, "lockTime");

  console.log("  呼叫 lockMarket...");
  const lockHash = await walletClient.writeContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "lockMarket",
    args: [marketId],
  });
  const lockReceipt = await publicClient.waitForTransactionReceipt({ hash: lockHash });
  assertSuccess(lockReceipt, "lockMarket");
  console.log(`  ✓ 市場已鎖盤 (tx: ${lockHash})`);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 4：submitResult（dev 錢包 = oracle 地址，直接結算）
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("STEP 4：submitResult（dev 錢包 = oracle，直接結算）");
  console.log("─".repeat(60));

  const finalTemp = 300n; // 30.0°C × 10 = 300 → bucket 2（280-310）得獎
  const memo = `${city}/${predictionType}/300/WIN`;

  console.log(`  溫度: ${finalTemp}°C → 預期 bucket ${betBucket} 得獎`);
  console.log(`  memo: ${memo}`);

  const settleHash = await walletClient.writeContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "submitResult",
    args: [marketId, finalTemp, memo],
  });
  const settleReceipt = await publicClient.waitForTransactionReceipt({ hash: settleHash });
  assertSuccess(settleReceipt, "submitResult");
  console.log(`  ✓ 結算完成 (tx: ${settleHash})`);

  // 讀取結算後狀態
  const marketSettled = (await publicClient.readContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "getMarket",
    args: [marketId],
  })) as unknown[];

  const statusAfter = marketSettled[4] as number;
  const totalPool = marketSettled[5] as bigint;
  const finalTempOnChain = marketSettled[6] as bigint;
  const winningBucket = marketSettled[7] as number;

  console.log(`  status        : ${STATUS_LABEL[statusAfter] ?? statusAfter}`);
  console.log(`  finalTemp     : ${finalTempOnChain}°C`);
  console.log(`  winningBucket : ${winningBucket}`);
  console.log(`  totalPool     : ${Number(totalPool) / 1e6} pathUSD`);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 5：claimWinnings
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("STEP 5：claimWinnings（領獎）");
  console.log("─".repeat(60));

  if (statusAfter !== 2) {
    console.warn("  ⚠️  市場未 SETTLED，跳過領獎");
  } else {
    const balBefore = (await publicClient.readContract({
      address: pathUSDAddr,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;

    const claimHash = await walletClient.writeContract({
      address: contractAddr,
      abi: artifact.abi,
      functionName: "claimWinnings",
      args: [marketId],
    });
    const claimReceipt = await publicClient.waitForTransactionReceipt({ hash: claimHash });
    assertSuccess(claimReceipt, "claimWinnings");

    const balAfter = (await publicClient.readContract({
      address: pathUSDAddr,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;

    const earned = balAfter - balBefore;
    console.log(`  ✓ 領獎成功 (tx: ${claimHash})`);
    console.log(`  領到金額 : ${Number(earned) / 1e6} pathUSD`);
    console.log(`  pathUSD 餘額: ${Number(balAfter) / 1e6} pathUSD`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 完成
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("  ✅  Testnet e2e 全部完成！");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("\n❌ 錯誤:", err.shortMessage ?? err.message);
  if (err.details) console.error("詳情:", err.details);
  if (err.cause) console.error("原因:", err.cause?.shortMessage ?? err.cause?.message);
  process.exit(1);
});

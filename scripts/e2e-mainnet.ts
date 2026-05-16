/**
 * Tempo Mainnet 完整 e2e 測試腳本
 *
 * 流程：建市場 → 下注 → lockMarket → Oracle HTTP settle（MPP） → claimWinnings
 *
 * 說明：
 *   - 網路：Tempo mainnet（chainId 4217）
 *   - 結算幣：USDC.e（6 decimals）
 *   - Gas：用 feeToken 機制，USDC.e 自動支付
 *   - 結算：POST /oracle/settle（有 oracleFee=200 raw → 觸發 MPP 402 流程）
 *
 * 執行方式：
 *   npx hardhat run scripts/e2e-mainnet.ts --network tempo
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
import { tempo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import hre from "hardhat";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

// ─── 常數 ──────────────────────────────────────────────────────────────────────
const USDC_DECIMALS = 6n;
const e6 = (n: number) => BigInt(n) * 10n ** USDC_DECIMALS;
const STATUS_LABEL = ["OPEN", "LOCKED", "SETTLED"] as const;
const ORACLE_URL = "http://46.62.246.244:3001";

// ─── 工具函數 ──────────────────────────────────────────────────────────────────
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

// 最小 ERC-20 ABI（approve + balanceOf + transfer）
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
  {
    name: "transfer",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "to", type: "address" as const },
      { name: "amount", type: "uint256" as const },
    ],
    outputs: [{ type: "bool" as const }],
  },
] as const;

// ─── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
  // ── 讀取部署資訊 ────────────────────────────────────────────────────────────
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const deploy = JSON.parse(
    readFileSync(resolve(__dirname, "../deployments/tempo.json"), "utf-8"),
  );
  const contractAddr = deploy.contractAddress as Hex;
  const usdcAddr = deploy.stablecoin.address as Hex;

  const artifact = await hre.artifacts.readArtifact("WeatherMarket");

  // ── Tempo mainnet chain（需加 feeToken 讓 viem 用 USDC.e 付 gas）──────────
  const mainnetChain = { ...tempo, feeToken: usdcAddr };
  const rpcUrl = process.env.TEMPO_RPC_URL ?? "https://rpc.tempo.xyz";

  // ── 設定 viem clients ──────────────────────────────────────────────────────
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

  console.log("=".repeat(60));
  console.log("  Tempo WeatherMarket Mainnet e2e");
  console.log("=".repeat(60));
  console.log(`  錢包     : ${account.address}`);
  console.log(`  合約     : ${contractAddr}`);
  console.log(`  USDC.e   : ${usdcAddr}`);
  console.log(`  chainId  : ${mainnetChain.id}`);
  console.log(`  Oracle   : ${ORACLE_URL}`);

  // ── 查詢初始狀態 ────────────────────────────────────────────────────────────
  const usdcBal = (await publicClient.readContract({
    address: usdcAddr,
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

  console.log(`\n  USDC.e 餘額  : ${(Number(usdcBal) / 1e6).toFixed(4)} USDC.e`);
  console.log(`  nextMarketId : ${nextMarketId}`);
  console.log(`  oracleFee    : ${oracleFee} raw = ${Number(oracleFee) / 1e6} USDC.e`);
  console.log(`  ⚠️  oracleFee > 0 → 結算前需 MPP 付款`);

  if (usdcBal < e6(2)) {
    throw new Error(`USDC.e 不足，目前 ${Number(usdcBal) / 1e6}，需要至少 2 USDC.e`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1：建立市場
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("STEP 1：建立市場");
  console.log("─".repeat(60));

  const now = Math.floor(Date.now() / 1000);
  const LOCK_DELAY = 90;
  const TARGET_DELAY = 180;
  const lockTime = now + LOCK_DELAY;
  const targetDate = now + TARGET_DELAY;
  // 溫度單位：°C × 10（合約慣例，weather.js 也回傳 °C × 10）
  // e.g. 280 = 28.0°C, 283 = 28.3°C
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
  });
  console.log(`\n  tx hash: ${createHash}`);
  console.log("  等待確認...");

  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
  assertSuccess(createReceipt, "createMarket");

  // 從 log 解析 marketId
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
  // STEP 2：Approve USDC.e + 下注
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("STEP 2：Approve USDC.e + 下注");
  console.log("─".repeat(60));

  console.log("  Approve USDC.e...");
  const approveHash = await walletClient.writeContract({
    address: usdcAddr,
    abi: erc20Abi,
    functionName: "approve",
    args: [contractAddr, maxUint256],
  });
  const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
  assertSuccess(approveReceipt, "approve");
  console.log(`  ✓ Approve 完成 (tx: ${approveHash})`);

  // 下注 1 USDC.e 在 bucket 2（280-310 = 28.0-31.0°C）
  const betBucket = 2;
  const betAmount = e6(1); // 1 USDC.e

  console.log(`\n  下注 1 USDC.e 在 bucket ${betBucket} (280-310 = 28.0-31.0°C)...`);
  const betHash = await walletClient.writeContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "placeBet",
    args: [marketId, betBucket, betAmount],
  });
  const betReceipt = await publicClient.waitForTransactionReceipt({ hash: betHash });
  assertSuccess(betReceipt, "placeBet");
  console.log(`  ✓ 下注成功 (tx: ${betHash})`);

  const marketAfterBet = (await publicClient.readContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "getMarket",
    args: [marketId],
  })) as unknown[];
  console.log(`  totalPool : ${Number(marketAfterBet[5] as bigint) / 1e6} USDC.e`);

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
  // STEP 4：Oracle HTTP settle（MPP 402 → 付款 → 結算）
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("STEP 4：Oracle HTTP settle（MPP 流程）");
  console.log("─".repeat(60));

  // 4a. 第一次呼叫 → 預期 402 付款挑戰
  console.log("  4a. POST /oracle/settle（取得付款挑戰）...");
  const resp1 = await fetch(`${ORACLE_URL}/oracle/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ marketId: Number(marketId) }),
  });
  const body1 = await resp1.json() as Record<string, unknown>;
  console.log(`  HTTP ${resp1.status}:`, JSON.stringify(body1, null, 2).split("\n").map(l => "  " + l).join("\n"));

  if (resp1.status === 200) {
    // oracleFee 已被設為 0，直接結算完成
    console.log("\n  ✓ 結算完成（oracleFee=0，直接結算）");
    await printSettlementResult(publicClient, contractAddr, artifact, marketId);
    await step5ClaimWinnings(walletClient, publicClient, contractAddr, usdcAddr, artifact, account, marketId);
    return;
  }

  if (resp1.status !== 402) {
    throw new Error(`Oracle 回傳非預期 HTTP ${resp1.status}: ${JSON.stringify(body1)}`);
  }

  // 4b. 解析付款挑戰
  const payment = body1.payment as {
    token: string;
    amount: string;
    recipient: string;
    chainId: number;
    nonce: string;
    expiresAt: number;
  };
  console.log(`\n  付款資訊:`);
  console.log(`    token     : ${payment.token}`);
  console.log(`    amount    : ${payment.amount} raw = ${Number(payment.amount) / 1e6} USDC.e`);
  console.log(`    recipient : ${payment.recipient}`);
  console.log(`    nonce     : ${payment.nonce}`);
  console.log(`    expiresAt : ${new Date(payment.expiresAt * 1000).toISOString()}`);

  // 4c. 付款：轉帳 oracleFee 到 Oracle 地址
  console.log(`\n  4b. 付款 ${payment.amount} raw USDC.e 給 Oracle...`);
  const payHash = await walletClient.writeContract({
    address: payment.token as Hex,
    abi: erc20Abi,
    functionName: "transfer",
    args: [payment.recipient as Hex, BigInt(payment.amount)],
  });
  const payReceipt = await publicClient.waitForTransactionReceipt({ hash: payHash });
  assertSuccess(payReceipt, "oracle fee payment");
  console.log(`  ✓ 付款完成 (tx: ${payHash})`);

  // 4d. 第二次呼叫 → 帶 paymentTxHash + nonce → 結算
  console.log("\n  4c. POST /oracle/settle（帶付款憑證，觸發結算）...");
  const resp2 = await fetch(`${ORACLE_URL}/oracle/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      marketId: Number(marketId),
      paymentTxHash: payHash,
      nonce: payment.nonce,
    }),
  });
  const body2 = await resp2.json() as Record<string, unknown>;
  console.log(`  HTTP ${resp2.status}`);

  if (resp2.status !== 200) {
    throw new Error(`Oracle 結算失敗 ${resp2.status}: ${JSON.stringify(body2)}`);
  }

  const receipt = body2.receipt as Record<string, unknown>;
  console.log(`\n  ✓ Oracle 結算完成！`);
  console.log(`  marketId      : ${receipt.marketId}`);
  console.log(`  city          : ${receipt.city}`);
  console.log(`  finalTemp     : ${receipt.finalTemp}°C`);
  console.log(`  winningBucket : ${receipt.winningBucket}`);
  console.log(`  noWinner      : ${receipt.noWinner}`);
  console.log(`  memo          : ${receipt.memo}`);
  console.log(`  settleTxHash  : ${receipt.settleTxHash}`);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 5：claimWinnings
  // ─────────────────────────────────────────────────────────────────────────────
  await step5ClaimWinnings(walletClient, publicClient, contractAddr, usdcAddr, artifact, account, marketId);
}

// ─── 輔助：印出市場結算結果 ────────────────────────────────────────────────────
async function printSettlementResult(
  publicClient: ReturnType<typeof createPublicClient>,
  contractAddr: Hex,
  artifact: { abi: unknown[] },
  marketId: bigint,
) {
  const market = (await publicClient.readContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "getMarket",
    args: [marketId],
  })) as unknown[];
  const STATUS_LABEL = ["OPEN", "LOCKED", "SETTLED"] as const;
  console.log(`  status        : ${STATUS_LABEL[market[4] as number] ?? market[4]}`);
  console.log(`  finalTemp     : ${market[6]}°C`);
  console.log(`  winningBucket : ${market[7]}`);
  console.log(`  totalPool     : ${Number(market[5] as bigint) / 1e6} USDC.e`);
}

// ─── 輔助：STEP 5 claimWinnings ───────────────────────────────────────────────
async function step5ClaimWinnings(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  contractAddr: Hex,
  usdcAddr: Hex,
  artifact: { abi: unknown[] },
  account: { address: Hex },
  marketId: bigint,
) {
  const erc20BalAbi = [
    {
      name: "balanceOf",
      type: "function" as const,
      stateMutability: "view" as const,
      inputs: [{ name: "account", type: "address" as const }],
      outputs: [{ type: "uint256" as const }],
    },
  ] as const;

  console.log("\n" + "─".repeat(60));
  console.log("STEP 5：claimWinnings（領獎）");
  console.log("─".repeat(60));

  const market = (await publicClient.readContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "getMarket",
    args: [marketId],
  })) as unknown[];

  const statusNow = market[4] as number;
  if (statusNow !== 2) {
    console.warn(`  ⚠️  市場狀態 ${statusNow}（非 SETTLED），跳過領獎`);
    return;
  }

  const balBefore = (await publicClient.readContract({
    address: usdcAddr,
    abi: erc20BalAbi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;

  const claimHash = await (walletClient as ReturnType<typeof createWalletClient>).writeContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "claimWinnings",
    args: [marketId],
  } as Parameters<ReturnType<typeof createWalletClient>["writeContract"]>[0]);

  const claimReceipt = await publicClient.waitForTransactionReceipt({ hash: claimHash as Hex });
  if (claimReceipt.status !== "success") {
    throw new Error(`claimWinnings tx 失敗，hash: ${claimHash}`);
  }

  const balAfter = (await publicClient.readContract({
    address: usdcAddr,
    abi: erc20BalAbi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;

  const earned = balAfter - balBefore;
  console.log(`  ✓ 領獎成功 (tx: ${claimHash})`);
  console.log(`  領到金額 : ${Number(earned) / 1e6} USDC.e`);
  console.log(`  USDC.e 餘額: ${Number(balAfter) / 1e6} USDC.e`);

  console.log("\n" + "=".repeat(60));
  console.log("  ✅  Mainnet e2e 全部完成！");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("\n❌ 錯誤:", err.shortMessage ?? err.message);
  if (err.details) console.error("詳情:", err.details);
  if (err.cause) console.error("原因:", err.cause?.shortMessage ?? err.cause?.message);
  process.exit(1);
});

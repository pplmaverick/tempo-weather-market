/**
 * Tempo Mainnet 完整 e2e 測試腳本（多城市版）
 *
 * 流程：4 個城市依序各走完：
 *   建市場 → 下注 → lockMarket → Oracle HTTP settle（MPP）→ claimWinnings
 *
 * 城市：Taipei → Tokyo → New York → Seoul
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
const LOCK_DELAY = 90;
const TARGET_DELAY = 180;

// ─── 城市設定 ──────────────────────────────────────────────────────────────────
// buckets 為溫度門檻 °C × 10，形成 5 個區間
// betBucket 為下注的區間索引（0-based）
// W6 e2e: 單城市 Taipei，betBucket=1 對應 25-28°C 區間（當前約 25-26°C）
const CITIES = [
  { name: "Taipei",   buckets: [250n, 280n, 310n, 340n] as bigint[], betBucket: 1 }, // 25.0-28.0°C
] as const;

// ─── 型別 ──────────────────────────────────────────────────────────────────────
type WalletClient = ReturnType<typeof createWalletClient>;
type PublicClient = ReturnType<typeof createPublicClient>;
type Artifact = { abi: unknown[] };

interface CityResult {
  city: string;
  marketId: bigint;
  txHashes: {
    createMarket: Hex;
    placeBet: Hex;
    lockMarket: Hex;
    oraclePayment: Hex | null;
    settleTxHash: string | null;
    claimWinnings: Hex | null;
  };
}

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

// 最小 ERC-20 ABI
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

const erc20BalAbi = [
  {
    name: "balanceOf",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "account", type: "address" as const }],
    outputs: [{ type: "uint256" as const }],
  },
] as const;

// ─── 單一城市 e2e ──────────────────────────────────────────────────────────────
async function runOneCityE2E(
  cityConfig: { name: string; buckets: readonly bigint[]; betBucket: number },
  walletClient: WalletClient,
  publicClient: PublicClient,
  contractAddr: Hex,
  usdcAddr: Hex,
  artifact: Artifact,
  account: { address: Hex },
): Promise<CityResult> {
  const { name: city, buckets, betBucket } = cityConfig;
  const txHashes: CityResult["txHashes"] = {
    createMarket: "0x" as Hex,
    placeBet: "0x" as Hex,
    lockMarket: "0x" as Hex,
    oraclePayment: null,
    settleTxHash: null,
    claimWinnings: null,
  };

  const now = Math.floor(Date.now() / 1000);
  const lockTime = now + LOCK_DELAY;
  const targetDate = now + TARGET_DELAY;
  const predictionType = "HIGH_TEMP";

  // ── STEP 1：建立市場 ─────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`STEP 1 [${city}]：建立市場`);
  console.log("─".repeat(60));
  console.log(`  city          : ${city}`);
  console.log(`  predictionType: ${predictionType}`);
  console.log(`  buckets       : [${buckets.join(", ")}] → 5 個區間`);
  console.log(`  betBucket     : ${betBucket}`);
  console.log(`  lockTime      : ${new Date(lockTime * 1000).toISOString()} (+${LOCK_DELAY}s)`);
  console.log(`  targetDate    : ${new Date(targetDate * 1000).toISOString()} (+${TARGET_DELAY}s)`);

  const createHash = await walletClient.writeContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "createMarket",
    args: [city, predictionType, BigInt(targetDate), [...buckets], BigInt(lockTime)],
  });
  txHashes.createMarket = createHash;
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
  console.log(`  ✓ 市場建立成功！marketId = ${marketId}`);

  // ── STEP 2：下注 ─────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`STEP 2 [${city}]：下注 1 USDC.e`);
  console.log("─".repeat(60));

  const betAmount = e6(1);
  console.log(`  下注 1 USDC.e 在 bucket ${betBucket}...`);
  const betHash = await walletClient.writeContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "placeBet",
    args: [marketId, betBucket, betAmount],
  });
  txHashes.placeBet = betHash;
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

  // ── STEP 3：等待鎖倉 → lockMarket ────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`STEP 3 [${city}]：等待鎖倉時間 → lockMarket`);
  console.log("─".repeat(60));

  await waitUntil(lockTime + 2, "lockTime");

  console.log("  呼叫 lockMarket...");
  const lockHash = await walletClient.writeContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "lockMarket",
    args: [marketId],
  });
  txHashes.lockMarket = lockHash;
  const lockReceipt = await publicClient.waitForTransactionReceipt({ hash: lockHash });
  assertSuccess(lockReceipt, "lockMarket");
  console.log(`  ✓ 市場已鎖盤 (tx: ${lockHash})`);

  // ── STEP 4：Oracle HTTP settle ───────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`STEP 4 [${city}]：Oracle HTTP settle（MPP 流程）`);
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
    console.log("\n  ✓ 結算完成（oracleFee=0，直接結算）");
    const receipt = body1.receipt as Record<string, unknown> | undefined;
    if (receipt) {
      txHashes.settleTxHash = receipt.settleTxHash as string ?? null;
    }
  } else {
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

    // 4c. 付款
    console.log(`\n  4b. 付款 ${payment.amount} raw USDC.e 給 Oracle...`);
    const payHash = await walletClient.writeContract({
      address: payment.token as Hex,
      abi: erc20Abi,
      functionName: "transfer",
      args: [payment.recipient as Hex, BigInt(payment.amount)],
    });
    txHashes.oraclePayment = payHash;
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

    const oracleReceipt = body2.receipt as Record<string, unknown>;
    console.log(`\n  ✓ Oracle 結算完成！`);
    console.log(`  marketId      : ${oracleReceipt.marketId}`);
    console.log(`  city          : ${oracleReceipt.city}`);
    console.log(`  finalTemp     : ${oracleReceipt.finalTemp}°C`);
    console.log(`  winningBucket : ${oracleReceipt.winningBucket}`);
    console.log(`  noWinner      : ${oracleReceipt.noWinner}`);
    console.log(`  memo          : ${oracleReceipt.memo}`);
    console.log(`  settleTxHash  : ${oracleReceipt.settleTxHash}`);
    txHashes.settleTxHash = oracleReceipt.settleTxHash as string ?? null;
  }

  // ── STEP 5：claimWinnings ────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`STEP 5 [${city}]：claimWinnings（領獎）`);
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
  } else {
    const balBefore = (await publicClient.readContract({
      address: usdcAddr,
      abi: erc20BalAbi,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;

    const claimHash = await (walletClient as WalletClient).writeContract({
      address: contractAddr,
      abi: artifact.abi,
      functionName: "claimWinnings",
      args: [marketId],
    } as Parameters<WalletClient["writeContract"]>[0]);

    const claimReceipt = await publicClient.waitForTransactionReceipt({ hash: claimHash as Hex });
    if (claimReceipt.status !== "success") {
      throw new Error(`claimWinnings tx 失敗，hash: ${claimHash}`);
    }
    txHashes.claimWinnings = claimHash as Hex;

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
  }

  console.log(`\n  ✅  [${city}] 全部完成！`);

  return { city, marketId, txHashes };
}

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

  // ── Tempo mainnet chain ─────────────────────────────────────────────────────
  const mainnetChain = { ...tempo, feeToken: usdcAddr };
  const rpcUrl = process.env.TEMPO_RPC_URL ?? "https://rpc.tempo.xyz";

  // ── viem clients ────────────────────────────────────────────────────────────
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
  console.log("  Tempo WeatherMarket Mainnet e2e — 多城市版");
  console.log(`  城市：${CITIES.map(c => c.name).join(" → ")}`);
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
  console.log(`  預計市場     : #${nextMarketId} ~ #${nextMarketId + 3n}`);

  // 單城市 Taipei：1 USDC.e 下注 + oracle fee（約 0.2）+ 手續費
  const minRequired = e6(2);
  if (usdcBal < minRequired) {
    throw new Error(`USDC.e 不足，目前 ${Number(usdcBal) / 1e6}，需要至少 2 USDC.e`);
  }

  // ── 一次性 Approve（maxUint256，後續城市共用）──────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("PRE：Approve USDC.e（一次性，4 城市共用）");
  console.log("─".repeat(60));
  const approveHash = await walletClient.writeContract({
    address: usdcAddr,
    abi: erc20Abi,
    functionName: "approve",
    args: [contractAddr, maxUint256],
  });
  const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
  assertSuccess(approveReceipt, "approve");
  console.log(`  ✓ Approve 完成 (tx: ${approveHash})`);

  // ── 依序跑 4 個城市 ────────────────────────────────────────────────────────
  const results: CityResult[] = [];

  for (let i = 0; i < CITIES.length; i++) {
    const cityConfig = CITIES[i];

    console.log("\n" + "=".repeat(60));
    console.log(`城市 ${i + 1}/${CITIES.length}：${cityConfig.name}`);
    console.log("=".repeat(60));

    const result = await runOneCityE2E(
      cityConfig,
      walletClient,
      publicClient,
      contractAddr,
      usdcAddr,
      artifact,
      account,
    );
    results.push(result);

    // 城市間等待 5 秒（最後一個城市不需等）
    if (i < CITIES.length - 1) {
      console.log("\n  ⏸  等待 5 秒後繼續下一個城市...");
      await sleep(5000);
    }
  }

  // ── 最終摘要 ────────────────────────────────────────────────────────────────
  const finalBal = (await publicClient.readContract({
    address: usdcAddr,
    abi: erc20BalAbi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;

  console.log("\n" + "=".repeat(60));
  console.log("  ✅  Mainnet e2e 多城市全部完成！");
  console.log("=".repeat(60));
  console.log(`\n  最終 USDC.e 餘額 : ${(Number(finalBal) / 1e6).toFixed(4)} USDC.e`);
  console.log(`  總消費           : ${((Number(usdcBal) - Number(finalBal)) / 1e6).toFixed(4)} USDC.e`);
  console.log("\n  城市 tx 摘要：");

  let totalTx = 1; // approve
  for (const r of results) {
    const t = r.txHashes;
    const cityTxCount = [
      t.createMarket, t.placeBet, t.lockMarket,
      t.oraclePayment, t.claimWinnings,
    ].filter(Boolean).length;
    totalTx += cityTxCount;

    console.log(`\n  【${r.city}】 marketId=${r.marketId}`);
    console.log(`    createMarket  : ${t.createMarket}`);
    console.log(`    placeBet      : ${t.placeBet}`);
    console.log(`    lockMarket    : ${t.lockMarket}`);
    if (t.oraclePayment) console.log(`    oraclePayment : ${t.oraclePayment}`);
    if (t.settleTxHash)  console.log(`    settleTxHash  : ${t.settleTxHash}`);
    if (t.claimWinnings) console.log(`    claimWinnings : ${t.claimWinnings}`);
  }

  console.log(`\n  ─────────────────────────────────────────`);
  console.log(`  總 tx 數（含 approve）: ${totalTx}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("\n❌ 錯誤:", err.shortMessage ?? err.message);
  if (err.details) console.error("詳情:", err.details);
  if (err.cause) console.error("原因:", err.cause?.shortMessage ?? err.cause?.message);
  process.exit(1);
});

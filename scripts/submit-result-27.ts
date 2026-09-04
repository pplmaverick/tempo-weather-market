/**
 * Market #27 (Taipei) submitResult 專用腳本
 *
 * finalTemp = 340 (34.0°C)，雙源(2-source) median（WeatherAPI 33.8 / Open-Meteo 34.1）
 * bucket 邊界 [290,320,350,380] → 340 落在 bucket 2 (32.0–35.0°C)
 * 事前查詢 bucketTotals[27][2] = 2000000 = totalPool 全部 → 預期 noWinner = false
 *
 * Tempo 主網沒有 native gas token，gas 用 stablecoin（USDC.e）支付，
 * 必須在 viem chain 上帶 feeToken 才會走 Tempo 的 0x76 交易類型（跟
 * scripts/submit-result-28.ts 相同模式）。
 *
 * 執行方式：npx hardhat run scripts/submit-result-27.ts --network tempo
 */
import { createWalletClient, createPublicClient, http, type Hex } from "viem";
import { tempo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import hre from "hardhat";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const MARKET_ID = 27;
const FINAL_TEMP = 340n;
const CITY = "Taipei";
const PREDICTION_TYPE = "HIGH_TEMP";
const STATUS_NAMES = ["OPEN", "LOCKED", "SETTLED"];

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const deploy = JSON.parse(readFileSync(resolve(__dirname, "../deployments/tempo.json"), "utf-8"));
  const contractAddr = deploy.contractAddress as Hex;
  const usdcAddr = deploy.stablecoin.address as Hex;

  const artifact = await hre.artifacts.readArtifact("WeatherMarket");

  const mainnetChain = { ...tempo, feeToken: usdcAddr };
  const rpcUrl = process.env.TEMPO_RPC_URL ?? "https://rpc.tempo.xyz";

  const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY}` as Hex);
  const walletClient = createWalletClient({ account, chain: mainnetChain, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain: mainnetChain, transport: http(rpcUrl) });

  console.log(`錢包: ${account.address}`);
  console.log(`合約: ${contractAddr}`);
  console.log(`feeToken (USDC.e): ${usdcAddr}\n`);

  const winningBucketGuess = (await publicClient.readContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "bucketTotals",
    args: [BigInt(MARKET_ID), 2],
  })) as bigint;
  const outcomeGuess = winningBucketGuess === 0n ? "NO_WINNER" : "WIN";
  const memo = `${CITY}/${PREDICTION_TYPE}/${FINAL_TEMP}/${outcomeGuess}`;
  console.log(`bucketTotals[27][2] = ${winningBucketGuess} → memo 預估: "${memo}"`);

  console.log("\n模擬 submitResult（eth_call）...");
  await publicClient.simulateContract({
    account,
    address: contractAddr,
    abi: artifact.abi,
    functionName: "submitResult",
    args: [BigInt(MARKET_ID), FINAL_TEMP, memo],
  });
  console.log("模擬成功，不會 revert。送出實際交易...");

  const txHash = await walletClient.writeContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "submitResult",
    args: [BigInt(MARKET_ID), FINAL_TEMP, memo],
  });
  console.log(`tx hash: ${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`submitResult #${MARKET_ID} 失敗（revert），tx: ${txHash}`);
  }
  console.log(`確認成功 (block ${receipt.blockNumber})`);

  const m = (await publicClient.readContract({
    address: contractAddr,
    abi: artifact.abi,
    functionName: "getMarket",
    args: [BigInt(MARKET_ID)],
  })) as unknown[];

  console.log("\n=== Market #27 結算後狀態 ===");
  console.log(`city: ${m[0]}`);
  console.log(`predictionType: ${m[1]}`);
  console.log(`status: ${m[4]} (${STATUS_NAMES[m[4] as number]})`);
  console.log(`totalPool: ${m[5]}`);
  console.log(`finalTemp: ${m[6]}`);
  console.log(`winningBucket: ${m[7]}`);
  console.log(`noWinner: ${m[9]}`);
  console.log(`settleMemo: ${m[10]}`);
  console.log(`\ntx hash: ${txHash}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

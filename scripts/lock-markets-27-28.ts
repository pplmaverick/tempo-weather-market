/**
 * Market #27, #28 lockMarket 專用腳本（不呼叫 submitResult）
 *
 * lockTime 已於 2026-08-28 過期，但鏈上 status 仍為 OPEN（自動排程未觸發）。
 * 這裡手動呼叫 lockMarket，讓兩個市場進入 LOCKED，等待後續指令再結算。
 *
 * Tempo 主網沒有 native gas token，gas 用 stablecoin（USDC.e）支付，
 * 必須在 viem chain 上帶 feeToken 才會走 Tempo 的 0x76 交易類型（跟
 * scripts/settle-markets.ts / scripts/createFourMarkets.ts 相同模式）。
 *
 * 執行方式：npx hardhat run scripts/lock-markets-27-28.ts --network tempo
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

const MARKET_IDS = [27, 28];
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

  const results: { marketId: number; txHash: string; statusAfter: string }[] = [];

  for (const marketId of MARKET_IDS) {
    console.log(`\n=== Market #${marketId} ===`);

    // 1) 先 eth_call 模擬，確認不會 revert
    console.log("模擬 lockMarket（eth_call）...");
    await publicClient.simulateContract({
      account,
      address: contractAddr,
      abi: artifact.abi,
      functionName: "lockMarket",
      args: [BigInt(marketId)],
    });
    console.log("模擬成功，不會 revert。送出實際交易...");

    // 2) 送出真正的交易
    const txHash = await walletClient.writeContract({
      address: contractAddr,
      abi: artifact.abi,
      functionName: "lockMarket",
      args: [BigInt(marketId)],
    });
    console.log(`tx hash: ${txHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`lockMarket #${marketId} 失敗（revert），tx: ${txHash}`);
    }
    console.log(`確認成功 (block ${receipt.blockNumber})`);

    // 3) 重新查詢 status
    const m = (await publicClient.readContract({
      address: contractAddr,
      abi: artifact.abi,
      functionName: "getMarket",
      args: [BigInt(marketId)],
    })) as unknown[];
    const statusAfter = STATUS_NAMES[m[4] as number];
    console.log(`重新查詢 status: ${statusAfter}`);

    results.push({ marketId, txHash, statusAfter });
  }

  console.log("\n=== 總結 ===");
  for (const r of results) {
    console.log(`Market #${r.marketId}: tx=${r.txHash} status=${r.statusAfter}`);
  }
  console.log("\n未呼叫 submitResult，等待下一步指令。");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

/**
 * Market #8-11 lockMarket → submitResult
 *
 * Tempo 主網沒有 native gas token，gas 用 stablecoin（USDC.e）支付，
 * 必須在 viem chain 上帶 feeToken 才會走 Tempo 的 0x76 交易類型（跟
 * scripts/createFourMarkets.ts / scripts/deploy.ts 相同模式）。
 *
 * 執行方式：npx hardhat run scripts/settle-markets.ts --network tempo
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

const SETTLEMENTS = [
  // #8 已在單獨測試中呼叫過 lockMarket（tx 0x5b8b982e...），此處跳過該步驟
  { marketId: 8, city: "Taipei", predictionType: "HIGH_TEMP", tempX10: 319n, winningBucket: 3, outcome: "NO_WINNER", skipLock: true },
  { marketId: 9, city: "Tokyo", predictionType: "HIGH_TEMP", tempX10: 261n, winningBucket: 2, outcome: "NO_WINNER", skipLock: false },
  { marketId: 10, city: "New York", predictionType: "HIGH_TEMP", tempX10: 314n, winningBucket: 4, outcome: "NO_WINNER", skipLock: false },
  { marketId: 11, city: "Seoul", predictionType: "HIGH_TEMP", tempX10: 289n, winningBucket: 3, outcome: "NO_WINNER", skipLock: false },
];

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

  for (const s of SETTLEMENTS) {
    console.log(`\n=== Market #${s.marketId} ${s.city} ===`);

    if (s.skipLock) {
      console.log("lockMarket 已於先前執行過，跳過");
    } else {
      console.log("Calling lockMarket...");
      const lockHash = await walletClient.writeContract({
        address: contractAddr,
        abi: artifact.abi,
        functionName: "lockMarket",
        args: [BigInt(s.marketId)],
      });
      const lockReceipt = await publicClient.waitForTransactionReceipt({ hash: lockHash });
      if (lockReceipt.status !== "success") {
        throw new Error(`lockMarket #${s.marketId} 失敗（revert），tx: ${lockHash}`);
      }
      console.log(`lockMarket tx: ${lockHash}`);
    }

    const memo = `${s.city}/${s.predictionType}/${s.tempX10}/${s.outcome}`;
    console.log(`Calling submitResult... memo="${memo}"`);
    const settleHash = await walletClient.writeContract({
      address: contractAddr,
      abi: artifact.abi,
      functionName: "submitResult",
      args: [BigInt(s.marketId), s.tempX10, memo],
    });
    const settleReceipt = await publicClient.waitForTransactionReceipt({ hash: settleHash });
    if (settleReceipt.status !== "success") {
      throw new Error(`submitResult #${s.marketId} 失敗（revert），tx: ${settleHash}`);
    }
    console.log(`submitResult tx: ${settleHash}`);
  }

  console.log("\nAll markets settled.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

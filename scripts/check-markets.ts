/**
 * 查詢市場 #13-16 的 bucket 邊界與狀態
 * 執行方式：npx hardhat run scripts/check-markets.ts --network tempo
 */
import hre from "hardhat";
import { formatUnits } from "viem";

const CONTRACT_ADDRESS = "0x072a3a0c04cf8cdcaf5b4a73a4ed4ff5a841531f";
const STATUS_LABEL = ["OPEN", "LOCKED", "SETTLED"] as const;

async function main() {
  const connection = await hre.network.connect();
  const publicClient = await connection.viem.getPublicClient();
  const artifact = await hre.artifacts.readArtifact("WeatherMarket");

  for (const id of [13, 14, 15, 16]) {
    const m = (await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: artifact.abi,
      functionName: "getMarket",
      args: [BigInt(id)],
    })) as unknown[];

    const city = m[0] as string;
    const status = m[4] as number;
    const buckets = m[8] as bigint[];
    const totalPool = m[5] as bigint;

    const bucketLabels = buckets.map((b) => `${Number(b) / 10}°C`).join(" | ");

    console.log(
      `#${id} ${city}: status=${STATUS_LABEL[status]}, buckets(上界)=${bucketLabels}, totalPool=${formatUnits(
        totalPool,
        6
      )} USDC.e`
    );
  }
}

main();

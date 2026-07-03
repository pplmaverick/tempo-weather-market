import hre from "hardhat";

const CONTRACT_ADDRESS = "0x072a3a0c04cf8cdcaf5b4a73a4ed4ff5a841531f";
const MARKET_IDS = [8, 9, 10, 11];

async function main() {
  const connection = await hre.network.connect();
  const publicClient = await connection.viem.getPublicClient();
  const [wallet] = await connection.viem.getWalletClients();
  const artifact = await hre.artifacts.readArtifact("WeatherMarket");

  const onChainOracle = (await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: artifact.abi,
    functionName: "oracle",
  })) as string;

  console.log(`簽名錢包地址 (PRIVATE_KEY): ${wallet.account.address}`);
  console.log(`合約上的 oracle 地址        : ${onChainOracle}`);
  console.log(
    `是否相符（submitResult 需要）: ${
      wallet.account.address.toLowerCase() === onChainOracle.toLowerCase() ? "✓ 相符" : "✗ 不相符！submitResult 會 revert"
    }`
  );

  const now = Math.floor(Date.now() / 1000);
  console.log(`\n目前時間 (unix): ${now}`);

  for (const id of MARKET_IDS) {
    const m = (await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: artifact.abi,
      functionName: "getMarket",
      args: [BigInt(id)],
    })) as unknown[];

    const city = m[0] as string;
    const predictionType = m[1] as string;
    const lockTime = m[3] as bigint;
    const status = m[4] as number;

    console.log(`\n#${id} ${city} (${predictionType})`);
    console.log(`  status: ${["OPEN", "LOCKED", "SETTLED"][status]}`);
    console.log(`  lockTime: ${lockTime} (${new Date(Number(lockTime) * 1000).toISOString()})`);
    console.log(
      `  lockTime 是否已到: ${now >= Number(lockTime) ? "✓ 可以 lockMarket" : `✗ 還要等 ${Number(lockTime) - now} 秒`}`
    );
  }
}

main();

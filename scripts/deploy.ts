/**
 * WeatherMarket 部署腳本
 *
 * testnet:  npx hardhat run scripts/deploy.ts --network moderato
 * mainnet:  npx hardhat run scripts/deploy.ts --network tempo
 * 本地測試: npx hardhat run scripts/deploy.ts --network hardhat
 *
 * 必填 .env：
 *   PRIVATE_KEY        部署者錢包私鑰（不含 0x）
 *   ORACLE_ADDRESS     oracle 服務錢包地址
 *   PATHUSD_ADDRESS    pathUSD 合約地址（moderato / hardhat 用）
 *   USDCE_ADDRESS      USDC.e 合約地址（tempo mainnet 用）
 *
 * 選填 .env：
 *   SCHEDULER_ADDRESS  Tempo Scheduler 預編譯地址；未設定 = 停用自動排程
 *   ORACLE_FEE_AMOUNT  MPP oracle 費用，單位為 stablecoin（預設 "0"）
 */

import hre from "hardhat";
import { parseUnits, zeroAddress, isAddress } from "viem";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// ─── 各網路靜態設定 ────────────────────────────────────────────────────────────

const NETWORK_CONFIG = {
  moderato: {
    label: "Tempo Moderato Testnet (Chain ID: 42431)",
    stablecoinEnvKey: "PATHUSD_ADDRESS",
    stablecoinSymbol: "pathUSD",
    decimals: 18,
    explorerTx: "https://explorer.moderato.tempo.xyz/tx",
  },
  tempo: {
    label: "Tempo Mainnet (Chain ID: 4217)",
    stablecoinEnvKey: "USDCE_ADDRESS",
    stablecoinSymbol: "USDC.e",
    decimals: 6,
    explorerTx: "https://explorer.tempo.xyz/tx",
  },
  hardhat: {
    label: "Hardhat Local",
    stablecoinEnvKey: "PATHUSD_ADDRESS",
    stablecoinSymbol: "MockUSD",
    decimals: 18,
    explorerTx: "",
  },
} as const;

type SupportedNetwork = keyof typeof NETWORK_CONFIG;

// ─── 輔助函式 ─────────────────────────────────────────────────────────────────

function requireEnvAddress(key: string): `0x${string}` {
  const val = process.env[key];
  if (!val) throw new Error(`.env 缺少 ${key}`);
  if (!isAddress(val)) throw new Error(`${key} 不是合法地址：${val}`);
  return val as `0x${string}`;
}

function optionalEnvAddress(key: string): `0x${string}` {
  const val = process.env[key];
  if (!val) return zeroAddress;
  if (!isAddress(val)) throw new Error(`${key} 不是合法地址：${val}`);
  return val as `0x${string}`;
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

async function main() {
  // Hardhat 3: viem 掛在 NetworkConnection 上，不是 hre 上
  const connection = await hre.network.connect();
  const networkName = connection.networkName;

  if (!(networkName in NETWORK_CONFIG)) {
    throw new Error(
      `不支援的網路：${networkName}\n請用 --network moderato 或 --network tempo`
    );
  }

  const cfg = NETWORK_CONFIG[networkName as SupportedNetwork];
  const publicClient = await connection.viem.getPublicClient();
  const [deployer] = await connection.viem.getWalletClients();
  const deployerAddr = deployer.account.address;

  // ── 讀取並驗證參數 ──────────────────────────────────────────────────────────

  const stablecoinAddress = requireEnvAddress(cfg.stablecoinEnvKey);
  const oracleAddress = requireEnvAddress("ORACLE_ADDRESS");
  const schedulerAddress = optionalEnvAddress("SCHEDULER_ADDRESS");

  // MPP oracle 費用（預設 0，之後可用 setOracleFee() 調整）
  const oracleFeeAmount = process.env.ORACLE_FEE_AMOUNT ?? "0";
  const oracleFee = parseUnits(oracleFeeAmount, cfg.decimals);

  // ── 印出部署摘要 ────────────────────────────────────────────────────────────

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log(`║  WeatherMarket 部署 — ${cfg.label}`);
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`\n部署者:     ${deployerAddr}`);
  console.log(`\n合約建構參數：`);
  console.log(`  [0] stablecoin  (${cfg.stablecoinSymbol}): ${stablecoinAddress}`);
  console.log(`  [1] oracle:                  ${oracleAddress}`);
  console.log(
    `  [2] scheduler:               ${
      schedulerAddress === zeroAddress
        ? "address(0) — 停用自動排程"
        : schedulerAddress
    }`
  );
  console.log(
    `  [3] oracleFee:               ${oracleFeeAmount} ${cfg.stablecoinSymbol}` +
      (oracleFee === 0n ? " (MPP 免費模式)" : "")
  );

  // ── 送出部署交易 ────────────────────────────────────────────────────────────

  console.log("\n送出部署交易...");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let weatherMarket: any;
  let txHash: `0x${string}`;
  let contractAddress: `0x${string}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let receipt: any;

  if (networkName === "tempo") {
    // Tempo 主網：沒有 native gas token，必須用 Tempo transaction type (0x76)
    // 在 chain 設定 feeToken，prepareTransactionRequest hook 自動帶入交易
    // Tempo 的自訂 serializer 會產生 0x76 前綴的交易，Fee AMM 再用 USDCE 付 gas
    const { tempo: tempoViemChain } = await import("viem/chains");
    const {
      createWalletClient,
      createPublicClient: viemPublicClient,
      http: viemHttp,
      encodeDeployData,
    } = await import("viem");
    const { privateKeyToAccount: pkToAccount } = await import("viem/accounts");

    const rawKey = process.env.PRIVATE_KEY!;
    if (!rawKey) throw new Error(".env 缺少 PRIVATE_KEY");
    const tempoAccount = pkToAccount(
      (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`
    );

    const rpcUrl = process.env.TEMPO_RPC_URL ?? "https://rpc.tempo.xyz";

    // feeToken 設在 chain → prepareTransactionRequest hook 會寫入 request，
    // 進而觸發 Tempo serializer（類似 Celo 的 feeCurrency 機制）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tempoChain = { ...tempoViemChain, feeToken: stablecoinAddress as any };

    const tempoWallet = createWalletClient({
      account: tempoAccount,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chain: tempoChain as any,
      transport: viemHttp(rpcUrl),
    });

    const tempoPublic = viemPublicClient({
      chain: tempoViemChain,
      transport: viemHttp(rpcUrl),
    });

    const artifact = await hre.artifacts.readArtifact("WeatherMarket");
    const deployData = encodeDeployData({
      abi: artifact.abi,
      bytecode: artifact.bytecode as `0x${string}`,
      args: [stablecoinAddress, oracleAddress, schedulerAddress, oracleFee],
    });

    console.log(`  Tempo tx type 0x76, feeToken: ${stablecoinAddress}`);

    // gas 明確帶入 → 跳過 eth_estimateGas；feeToken 由 chain hook 注入
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    txHash = await (tempoWallet as any).sendTransaction({
      data: deployData,
      gas: 15_000_000n,
    });

    console.log(`Tx hash: ${txHash}`);
    console.log("等待上鏈確認...");

    receipt = await tempoPublic.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== "success") {
      throw new Error(`部署交易 revert，hash: ${txHash}`);
    }

    contractAddress = receipt.contractAddress as `0x${string}`;
    if (!contractAddress) throw new Error("receipt 缺少 contractAddress，部署可能失敗");

    weatherMarket = await connection.viem.getContractAt("WeatherMarket", contractAddress);

  } else {
    // hardhat / moderato：pathUSD 是 native token，可直接用 sendDeploymentTransaction
    const gasLimit = networkName === "hardhat" ? undefined : 15_000_000n;

    const { contract, deploymentTransaction } =
      await connection.viem.sendDeploymentTransaction("WeatherMarket", [
        stablecoinAddress,
        oracleAddress,
        schedulerAddress,
        oracleFee,
      ], gasLimit !== undefined ? { gas: gasLimit } : {});

    txHash = deploymentTransaction.hash;

    console.log(`Tx hash: ${txHash}`);
    console.log("等待上鏈確認...");

    receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== "success") {
      throw new Error(`部署交易 revert，hash: ${txHash}`);
    }

    contractAddress = contract.address;
    weatherMarket = contract;
  }

  console.log(`\n✓ 部署成功`);
  console.log(`  合約地址:  ${contractAddress}`);
  console.log(`  區塊高度:  ${receipt.blockNumber}`);
  console.log(`  Gas 使用:  ${receipt.gasUsed.toLocaleString()}`);
  if (cfg.explorerTx) {
    console.log(`  Explorer:  ${cfg.explorerTx}/${txHash}`);
  }

  // ── 驗證鏈上讀取 ────────────────────────────────────────────────────────────

  console.log("\n驗證鏈上狀態...");

  const [
    onchainStablecoin,
    onchainOracle,
    onchainScheduler,
    onchainFeeBps,
    onchainOracleFee,
  ] = (await Promise.all([
    weatherMarket.read.stablecoin(),
    weatherMarket.read.oracle(),
    weatherMarket.read.scheduler(),
    weatherMarket.read.FEE_BPS(),
    weatherMarket.read.oracleFee(),
  ])) as [`0x${string}`, `0x${string}`, `0x${string}`, bigint, bigint];

  const checks = [
    {
      label: "stablecoin()",
      ok: onchainStablecoin.toLowerCase() === stablecoinAddress.toLowerCase(),
      value: onchainStablecoin,
    },
    {
      label: "oracle()",
      ok: onchainOracle.toLowerCase() === oracleAddress.toLowerCase(),
      value: onchainOracle,
    },
    {
      label: "scheduler()",
      ok: onchainScheduler.toLowerCase() === schedulerAddress.toLowerCase(),
      value:
        onchainScheduler === zeroAddress ? "address(0) — 停用" : onchainScheduler,
    },
    {
      label: "FEE_BPS()",
      ok: onchainFeeBps === 200n,
      value: `${onchainFeeBps} (= ${Number(onchainFeeBps) / 100}%)`,
    },
    {
      label: "oracleFee()",
      ok: onchainOracleFee === oracleFee,
      value: `${onchainOracleFee} (${oracleFeeAmount} ${cfg.stablecoinSymbol})`,
    },
  ];

  for (const c of checks) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.label.padEnd(16)} ${c.value}`);
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    throw new Error(`驗證失敗：${failed.map((c) => c.label).join(", ")}`);
  }

  // ── 儲存部署記錄 ────────────────────────────────────────────────────────────

  const record = {
    network: networkName,
    chainId: await publicClient.getChainId(),
    contractAddress,
    txHash,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: Number(receipt.gasUsed),
    stablecoin: {
      symbol: cfg.stablecoinSymbol,
      address: stablecoinAddress,
      decimals: cfg.decimals,
    },
    oracle: oracleAddress,
    scheduler: schedulerAddress === zeroAddress ? null : schedulerAddress,
    oracleFee: oracleFeeAmount,
    feeBps: Number(onchainFeeBps),
    deployedAt: new Date().toISOString(),
    deployedBy: deployerAddr,
  };

  const outDir = join(process.cwd(), "deployments");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const outPath = join(outDir, `${networkName}.json`);
  writeFileSync(outPath, JSON.stringify(record, null, 2));

  // ── 最終摘要 ────────────────────────────────────────────────────────────────

  console.log(`\n部署記錄已儲存：deployments/${networkName}.json`);
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log(`║  ✓ 部署完成！請將以下行加入 .env：`);

  if (networkName === "moderato") {
    console.log(`║  WEATHER_MARKET_ADDRESS=${contractAddress}`);
  } else if (networkName === "tempo") {
    console.log(`║  WEATHER_MARKET_MAINNET_ADDRESS=${contractAddress}`);
  } else {
    console.log(`║  CONTRACT_ADDRESS=${contractAddress}`);
  }

  console.log("╚══════════════════════════════════════════════════════╝\n");

  await connection.close();
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n✗ 部署失敗：${message}\n`);
  process.exitCode = 1;
});

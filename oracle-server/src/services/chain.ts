import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { MarketData, SettlementReceipt } from "../types.js";

// ─── Tempo Moderato 鏈定義 ────────────────────────────────────────────────────

const tempoModerato = defineChain({
  id: 42431,
  name: "Tempo Moderato",
  nativeCurrency: { name: "pathUSD", symbol: "pathUSD", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.RPC_URL ?? "https://rpc.moderato.tempo.xyz"] },
  },
});

// ─── ABI（只含用到的函式）────────────────────────────────────────────────────

const MARKET_ABI = parseAbi([
  "function getMarket(uint256 marketId) view returns (string city, string predictionType, uint256 targetDate, uint256 lockTime, uint8 status, uint256 totalPool, int256 finalTemp, uint8 winningBucket, int256[] buckets, bool noWinner, string settleMemo)",
  "function submitResult(uint256 marketId, int256 finalTemp, string memo) returns (tuple(uint256 marketId, int256 finalTemp, uint8 winningBucket, bool noWinner, string memo, uint256 timestamp, address submittedBy) receipt)",
  "function getReceipt(uint256 marketId) view returns (tuple(uint256 marketId, int256 finalTemp, uint8 winningBucket, bool noWinner, string memo, uint256 timestamp, address submittedBy) receipt)",
  "function oracleFee() view returns (uint256)",
]);

const ERC20_TRANSFER_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

// ─── Clients ──────────────────────────────────────────────────────────────────

const privateKey = process.env.ORACLE_PRIVATE_KEY!;
if (!privateKey) throw new Error("ORACLE_PRIVATE_KEY 未設定");

export const account = privateKeyToAccount(
  (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`
);

export const publicClient = createPublicClient({
  chain: tempoModerato,
  transport: http(process.env.RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: tempoModerato,
  transport: http(process.env.RPC_URL),
});

const contractAddress = process.env.CONTRACT_ADDRESS as `0x${string}`;

// ─── 公開函式 ─────────────────────────────────────────────────────────────────

export async function getMarket(marketId: number): Promise<MarketData> {
  const result = (await publicClient.readContract({
    address: contractAddress,
    abi: MARKET_ABI,
    functionName: "getMarket",
    args: [BigInt(marketId)],
  })) as [string, string, bigint, bigint, number, bigint, bigint, number, bigint[], boolean, string];

  return {
    city: result[0],
    predictionType: result[1],
    targetDate: result[2],
    lockTime: result[3],
    status: result[4],
    totalPool: result[5],
    buckets: result[8],
    noWinner: result[9],
  };
}

export async function getOracleFee(): Promise<bigint> {
  return (await publicClient.readContract({
    address: contractAddress,
    abi: MARKET_ABI,
    functionName: "oracleFee",
  })) as bigint;
}

export async function submitResult(
  marketId: number,
  finalTemp: number,
  memo: string
): Promise<SettlementReceipt> {
  // Tempo 部署 gas 高，submitResult 也設高一點
  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: MARKET_ABI,
    functionName: "submitResult",
    args: [BigInt(marketId), BigInt(finalTemp), memo],
    gas: 500_000n,
  });

  const txReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (txReceipt.status !== "success") {
    throw new Error(`submitResult tx revert: ${txHash}`);
  }

  // 從鏈上讀取結算回執
  const onchainReceipt = (await publicClient.readContract({
    address: contractAddress,
    abi: MARKET_ABI,
    functionName: "getReceipt",
    args: [BigInt(marketId)],
  })) as { finalTemp: bigint; winningBucket: number; noWinner: boolean; memo: string; timestamp: bigint };

  // 取得市場資料（city/predictionType）
  const market = await getMarket(marketId);

  return {
    marketId,
    city: market.city,
    predictionType: market.predictionType,
    finalTemp: Number(onchainReceipt.finalTemp),
    winningBucket: onchainReceipt.winningBucket,
    noWinner: onchainReceipt.noWinner,
    memo: onchainReceipt.memo,
    settleTxHash: txHash,
    timestamp: Number(onchainReceipt.timestamp),
  };
}

// pathUSD Transfer event log 驗證（MPP fee > 0 時使用）
export async function verifyPathUSDTransfer(
  txHash: string,
  expectedAmount: bigint,
  toAddress: string
): Promise<boolean> {
  const receipt = await publicClient.getTransactionReceipt({
    hash: txHash as `0x${string}`,
  });
  if (!receipt || receipt.status !== "success") return false;

  const PATHUSD = (process.env.PATHUSD_ADDRESS ?? "").toLowerCase();
  const TO = toAddress.toLowerCase();

  // 找 pathUSD Transfer(from, to=oracle, amount>=oracleFee) log
  const transferTopic =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

  const matched = receipt.logs.find((log) => {
    if (log.address.toLowerCase() !== PATHUSD) return false;
    if (log.topics[0] !== transferTopic) return false;
    const toInLog = `0x${log.topics[2]?.slice(26)}`.toLowerCase();
    if (toInLog !== TO) return false;
    const amount = BigInt(log.data);
    return amount >= expectedAmount;
  });

  return !!matched;
}

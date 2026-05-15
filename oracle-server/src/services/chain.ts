import {
  createPublicClient,
  createWalletClient,
  http,
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

// ─── ABI（JSON 格式，避免 abitype 不支援 human-readable tuple 回傳）────────────

const RECEIPT_COMPONENTS = [
  { name: "marketId",      type: "uint256"  },
  { name: "finalTemp",     type: "int256"   },
  { name: "winningBucket", type: "uint8"    },
  { name: "noWinner",      type: "bool"     },
  { name: "memo",          type: "string"   },
  { name: "timestamp",     type: "uint256"  },
  { name: "submittedBy",   type: "address"  },
] as const;

const MARKET_ABI = [
  {
    name: "getMarket",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      { name: "city",           type: "string"   },
      { name: "predictionType", type: "string"   },
      { name: "targetDate",     type: "uint256"  },
      { name: "lockTime",       type: "uint256"  },
      { name: "status",         type: "uint8"    },
      { name: "totalPool",      type: "uint256"  },
      { name: "finalTemp",      type: "int256"   },
      { name: "winningBucket",  type: "uint8"    },
      { name: "buckets",        type: "int256[]" },
      { name: "noWinner",       type: "bool"     },
      { name: "settleMemo",     type: "string"   },
    ],
  },
  {
    name: "submitResult",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId",  type: "uint256" },
      { name: "finalTemp", type: "int256"  },
      { name: "memo",      type: "string"  },
    ],
    outputs: [
      { name: "receipt", type: "tuple", components: RECEIPT_COMPONENTS },
    ],
  },
  {
    name: "getReceipt",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      { name: "receipt", type: "tuple", components: RECEIPT_COMPONENTS },
    ],
  },
  {
    name: "oracleFee",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

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

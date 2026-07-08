import {
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { withRetry } from "../utils.js";
import { tempo as tempoMainnetChain, tempoModerato as tempoTestnetChain } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { MarketData, SettlementReceipt } from "../types.js";

// ─── 網路選擇 ─────────────────────────────────────────────────────────────────

const TEMPO_NETWORK = (process.env.TEMPO_NETWORK ?? "testnet") as "testnet" | "mainnet";
const isMainnet = TEMPO_NETWORK === "mainnet";

const activeRpcUrl = isMainnet
  ? (process.env.RPC_MAINNET ?? "https://rpc.tempo.xyz")
  : (process.env.RPC_URL ?? "https://rpc.moderato.tempo.xyz");

const activeContractAddress = (
  isMainnet ? process.env.CONTRACT_ADDRESS_MAINNET : process.env.CONTRACT_ADDRESS
) as `0x${string}`;

const activeStablecoinAddress = (
  isMainnet ? process.env.USDCE_ADDRESS : process.env.PATHUSD_ADDRESS
) as `0x${string}`;

// ─── Chain 定義 ───────────────────────────────────────────────────────────────
//
// testnet（moderato, chainId 42431）：pathUSD 是 native token，標準 EIP-1559 即可
// mainnet（tempo, chainId 4217）：無 native gas token，需設 feeToken 讓 Fee AMM
//   用 USDCE 付 gas，viem 的 tempo chain 內建 0x76 serializer 和 hook 自動注入

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const activeChain: any = isMainnet
  ? { ...tempoMainnetChain, feeToken: activeStablecoinAddress }
  : tempoTestnetChain;

export const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(activeRpcUrl),
});

// stablecoin 的 decimals 直接向鏈上查詢（pathUSD precompile 實際是 6，不是常見 ERC20 的 18）
const ERC20_DECIMALS_ABI = [
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

const stablecoinDecimals = await publicClient.readContract({
  address: activeStablecoinAddress,
  abi: ERC20_DECIMALS_ABI,
  functionName: "decimals",
});

// networkInfo 供其他模組讀取（payment.ts, routes/oracle.ts, index.ts）
export const networkInfo = {
  network: TEMPO_NETWORK,
  chainId: isMainnet ? 4217 : 42431,
  rpcUrl: activeRpcUrl,
  contractAddress: activeContractAddress,
  stablecoinAddress: activeStablecoinAddress,
  stablecoinSymbol: isMainnet ? "USDCE" : "pathUSD",
  stablecoinDecimals,
} as const;

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

const walletClient = createWalletClient({
  account,
  chain: activeChain,
  transport: http(activeRpcUrl),
});

// ─── 公開函式 ─────────────────────────────────────────────────────────────────

export async function getMarket(marketId: number): Promise<MarketData> {
  const result = (await publicClient.readContract({
    address: activeContractAddress,
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
    address: activeContractAddress,
    abi: MARKET_ABI,
    functionName: "oracleFee",
  })) as bigint;
}

export async function submitResult(
  marketId: number,
  finalTemp: number,
  memo: string
): Promise<SettlementReceipt> {
  // marketId 存在性檢查：未曾 createMarket() 過的 ID，lockTime 預設為 0
  const market = await getMarket(marketId);
  if (market.lockTime === 0n) {
    throw new Error(`Market ${marketId} does not exist`);
  }

  // mainnet 的 writeContract 會透過 feeToken chain hook 產生 Tempo 0x76 交易
  // testnet 的 writeContract 用標準 EIP-1559（pathUSD 是 native token）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txHash = await withRetry<`0x${string}`>(
    () => (walletClient as any).writeContract({
      address: activeContractAddress,
      abi: MARKET_ABI,
      functionName: "submitResult",
      args: [BigInt(marketId), BigInt(finalTemp), memo],
      gas: 3_000_000n, // mainnet submitResult 需要 ~2.35M gas
    }),
    `submitResult marketId=${marketId}`
  );

  const txReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (txReceipt.status !== "success") {
    throw new Error(`submitResult tx revert: ${txHash}`);
  }

  const onchainReceipt = (await publicClient.readContract({
    address: activeContractAddress,
    abi: MARKET_ABI,
    functionName: "getReceipt",
    args: [BigInt(marketId)],
  })) as { finalTemp: bigint; winningBucket: number; noWinner: boolean; memo: string; timestamp: bigint };

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

// stablecoin Transfer event log 驗證（MPP fee > 0 時使用）
export async function verifyPathUSDTransfer(
  txHash: string,
  expectedAmount: bigint,
  toAddress: string
): Promise<boolean> {
  const receipt = await publicClient.getTransactionReceipt({
    hash: txHash as `0x${string}`,
  });
  if (!receipt || receipt.status !== "success") return false;

  const STABLECOIN = activeStablecoinAddress.toLowerCase();
  const TO = toAddress.toLowerCase();

  const transferTopic =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

  const matched = receipt.logs.find((log: { address: string; topics: (`0x${string}` | undefined)[]; data: `0x${string}` }) => {
    if (log.address.toLowerCase() !== STABLECOIN) return false;
    if (log.topics[0] !== transferTopic) return false;
    const toInLog = `0x${log.topics[2]?.slice(26)}`.toLowerCase();
    if (toInLog !== TO) return false;
    const amount = BigInt(log.data);
    return amount >= expectedAmount;
  });

  return !!matched;
}

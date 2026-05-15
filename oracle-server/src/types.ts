export interface MarketData {
  city: string;
  predictionType: string;
  targetDate: bigint;
  lockTime: bigint;
  status: number; // 0=OPEN 1=LOCKED 2=SETTLED
  totalPool: bigint;
  buckets: bigint[];
  noWinner: boolean;
}

export interface PaymentChallenge {
  token: string;       // pathUSD 合約地址
  amount: string;      // wei 字串（"0" 代表免費）
  recipient: string;   // oracle 錢包地址
  chainId: number;
  nonce: string;       // HMAC timestamp.hash，有效 10 分鐘
  expiresAt: number;
}

export interface SettlementReceipt {
  marketId: number;
  city: string;
  predictionType: string;
  finalTemp: number;     // °C × 10，e.g. 315 = 31.5°C
  winningBucket: number;
  noWinner: boolean;
  memo: string;
  settleTxHash: string;
  timestamp: number;
}

import crypto from "crypto";
import type { PaymentChallenge } from "../types.js";
import { networkInfo } from "./chain.js";

const ORACLE_SECRET = process.env.ORACLE_SECRET!;
const NONCE_TTL_SECS = 600; // 10 分鐘

// 已使用的 payment tx hash（防 replay；重啟後重置，正式環境改用 Redis）
const usedTxHashes = new Set<string>();

// ─── Nonce 產生與驗證 ─────────────────────────────────────────────────────────

export function generateNonce(marketId: number): string {
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${marketId}:${ts}`;
  const sig = crypto
    .createHmac("sha256", ORACLE_SECRET)
    .update(payload)
    .digest("hex");
  return `${ts}.${sig}`;
}

export function verifyNonce(nonce: string, marketId: number): boolean {
  const parts = nonce.split(".");
  if (parts.length !== 2) return false;

  const [tsStr, sig] = parts;
  const ts = parseInt(tsStr, 10);
  if (isNaN(ts)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (now - ts > NONCE_TTL_SECS) return false; // 過期

  const expected = crypto
    .createHmac("sha256", ORACLE_SECRET)
    .update(`${marketId}:${ts}`)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
}

// ─── Payment Challenge 產生 ───────────────────────────────────────────────────

export function buildChallenge(
  marketId: number,
  oracleFee: bigint
): PaymentChallenge {
  const nonce = generateNonce(marketId);
  const ts = parseInt(nonce.split(".")[0], 10);

  return {
    token: networkInfo.stablecoinAddress,
    amount: oracleFee.toString(),
    recipient: process.env.ORACLE_ADDRESS!,
    chainId: networkInfo.chainId,
    nonce,
    expiresAt: ts + NONCE_TTL_SECS,
  };
}

// ─── Payment Tx 驗證 ─────────────────────────────────────────────────────────

export function markTxUsed(txHash: string): void {
  usedTxHashes.add(txHash.toLowerCase());
}

export function isTxUsed(txHash: string): boolean {
  return usedTxHashes.has(txHash.toLowerCase());
}

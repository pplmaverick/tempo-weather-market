import { Router, type Request, type Response } from "express";
import { getMarket, getOracleFee, submitResult, verifyPathUSDTransfer, account, networkInfo } from "../services/chain.js";
import { getMaxTemp } from "../services/weather.js";
import { buildChallenge, verifyNonce, isTxUsed, markTxUsed } from "../services/payment.js";

export const oracleRouter = Router();

// ─── POST /oracle/settle ──────────────────────────────────────────────────────
//
// MPP 結算端點
//
// 第一次呼叫（無 paymentTxHash）：
//   → 如果 oracleFee = 0，直接結算
//   → 如果 oracleFee > 0，回傳 402 + 付款挑戰
//
// 第二次呼叫（帶 paymentTxHash + nonce）：
//   → 驗證付款 → 取得氣溫 → submitResult → 回傳 receipt

oracleRouter.post("/settle", async (req: Request, res: Response) => {
  const { marketId, paymentTxHash, nonce } = req.body as {
    marketId?: number;
    paymentTxHash?: string;
    nonce?: string;
  };

  if (marketId === undefined || marketId === null) {
    return res.status(400).json({ error: "marketId 必填" });
  }

  // 1. 讀取市場狀態
  let market;
  try {
    market = await getMarket(Number(marketId));
  } catch (err) {
    return res.status(400).json({ error: `無法讀取市場 ${marketId}`, detail: String(err) });
  }

  if (market.status !== 1) {
    const statusLabel = ["OPEN", "LOCKED", "SETTLED"][market.status] ?? market.status;
    return res.status(409).json({
      error: `市場狀態必須為 LOCKED，目前為 ${statusLabel}`,
      status: market.status,
    });
  }

  // 2. 讀取 oracle fee
  const oracleFee = await getOracleFee();

  // 3. MPP：fee > 0 時需要付款驗證
  if (oracleFee > 0n) {
    if (!paymentTxHash || !nonce) {
      // 回傳 402 付款挑戰
      const challenge = buildChallenge(Number(marketId), oracleFee);
      return res.status(402).json({
        status: 402,
        message: `請先付款 ${oracleFee} ${networkInfo.stablecoinSymbol} 到 ${account.address}，再帶 paymentTxHash 重試`,
        payment: challenge,
      });
    }

    // 驗證 nonce 未過期
    if (!verifyNonce(nonce, Number(marketId))) {
      return res.status(402).json({
        error: "nonce 無效或已過期，請重新取得付款挑戰",
      });
    }

    // 防 replay
    if (isTxUsed(paymentTxHash)) {
      return res.status(402).json({ error: "此 paymentTxHash 已被使用" });
    }

    // 確認鏈上 pathUSD transfer
    const paid = await verifyPathUSDTransfer(
      paymentTxHash,
      oracleFee,
      account.address
    );
    if (!paid) {
      return res.status(402).json({
        error: "鏈上付款未確認，請確認 tx 已成功且金額正確",
        required: { amount: oracleFee.toString(), to: account.address },
      });
    }

    markTxUsed(paymentTxHash);
  }

  // 4. 取得實際氣溫（OpenWeather API）
  let finalTemp: number;
  try {
    const targetDate = new Date(Number(market.targetDate) * 1000);
    finalTemp = await getMaxTemp(market.city, targetDate);
  } catch (err) {
    return res.status(502).json({
      error: "OpenWeather API 呼叫失敗",
      detail: String(err),
    });
  }

  // 5. 產生 Payment Memo
  const outcome = determineOutcome(market.buckets, BigInt(finalTemp), market.noWinner);
  const memo = `${market.city}/${market.predictionType}/${finalTemp}/${outcome}`;

  // 6. 呼叫合約 submitResult()
  let receipt;
  try {
    receipt = await submitResult(Number(marketId), finalTemp, memo);
  } catch (err) {
    return res.status(500).json({
      error: "submitResult 失敗",
      detail: String(err),
    });
  }

  // 7. 回傳結算回執
  return res.status(200).json({
    status: "settled",
    receipt,
  });
});

// ─── GET /oracle/market/:marketId ─────────────────────────────────────────────
// 查詢市場狀態（供 n8n 定時觸發判斷用）

oracleRouter.get("/market/:marketId", async (req: Request, res: Response) => {
  const marketId = parseInt(req.params.marketId, 10);
  if (isNaN(marketId)) return res.status(400).json({ error: "無效的 marketId" });

  try {
    const market = await getMarket(marketId);
    const statusLabel = ["OPEN", "LOCKED", "SETTLED"][market.status] ?? "UNKNOWN";
    return res.json({
      marketId,
      city: market.city,
      predictionType: market.predictionType,
      status: market.status,
      statusLabel,
      lockTime: Number(market.lockTime),
      targetDate: Number(market.targetDate),
      totalPool: market.totalPool.toString(),
    });
  } catch (err) {
    return res.status(400).json({ error: String(err) });
  }
});

// ─── GET /oracle/health ───────────────────────────────────────────────────────

oracleRouter.get("/health", (_req: Request, res: Response) => {
  return res.json({
    status: "ok",
    network: networkInfo.network,
    chainId: networkInfo.chainId,
    oracle: account.address,
    contract: networkInfo.contractAddress,
    stablecoin: networkInfo.stablecoinSymbol,
    rpc: networkInfo.rpcUrl,
    timestamp: Math.floor(Date.now() / 1000),
  });
});

// ─── 內部：判斷 bucket 結果 ───────────────────────────────────────────────────

function determineOutcome(buckets: bigint[], finalTemp: bigint, noWinner: boolean): string {
  if (noWinner) return "NO_WINNER";

  // 找出獲勝 bucket（同合約邏輯）
  for (let i = 0; i < buckets.length; i++) {
    if (finalTemp <= buckets[i]) return "WIN";
  }
  return "WIN";
}

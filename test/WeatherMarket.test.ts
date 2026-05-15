import { expect } from "chai";
import hre from "hardhat";
import { parseUnits, zeroAddress, maxUint256 } from "viem";
import type { NetworkConnection } from "hardhat/types/network";

// ─── 常數 ─────────────────────────────────────────────────────────────────────

const D18 = 18;
const e18 = (n: number | bigint) => parseUnits(String(n), D18);

// 溫度區間上界 [25, 28, 31, 34] → 5 個區間
// 區間 0: ≤25, 1: 26-28, 2: 29-31, 3: 32-34, 4: ≥35
const BUCKETS = [25n, 28n, 31n, 34n];
const TEMP = {
  b0: 20n, // 落在 bucket 0（≤25）
  b1: 26n, // 落在 bucket 1（25-28]
  b2: 30n, // 落在 bucket 2（28-31]
  b3: 33n, // 落在 bucket 3（31-34]
  b4: 35n, // 落在 bucket 4（>34）
};
const ONE_DAY = 86_400n;

// ─── 輔助：測試 revert ────────────────────────────────────────────────────────

async function expectRevert(p: Promise<unknown>, substr: string) {
  let reverted = false;
  try {
    await p;
  } catch (e: unknown) {
    reverted = true;
    const msg = e instanceof Error ? e.message : String(e);
    expect(msg).to.include(substr, `Expected revert message to contain "${substr}"`);
  }
  if (!reverted) throw new Error(`Expected revert with "${substr}" but tx succeeded`);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// 基礎 fixture：部署 MockERC20 + WeatherMarket，發幣，設 relayer
async function baseFixture(conn: NetworkConnection) {
  const pub = await conn.viem.getPublicClient();
  const wallets = await conn.viem.getWalletClients();
  const [owner, oracle, user1, user2, relayer] = wallets;

  const mockUSD = await conn.viem.deployContract("MockERC20", [
    "pathUSD",
    "pathUSD",
    D18,
  ]);

  // 每個測試帳戶各 1000 pathUSD
  for (const w of [user1, user2, oracle]) {
    await mockUSD.write.mint([w.account.address, e18(1000)]);
  }

  // oracleFee = 0（預設），可在個別測試覆寫
  const market = await conn.viem.deployContract("WeatherMarket", [
    mockUSD.address,
    oracle.account.address,
    zeroAddress,
    0n,
  ]);

  // user1, user2 對市場 approve 最大金額
  for (const w of [user1, user2]) {
    await mockUSD.write.approve([market.address, maxUint256], {
      account: w.account,
    });
  }

  // 設定 relayer 白名單
  await market.write.setRelayer([relayer.account.address, true]);

  return { pub, mockUSD, market, owner, oracle, user1, user2, relayer };
}

// 附帶一個「剛建立的」市場（OPEN 狀態）
async function marketFixture(conn: NetworkConnection) {
  const base = await baseFixture(conn);
  const { market } = base;

  const now = BigInt(await conn.networkHelpers.time.latest());
  const lockTime = now + ONE_DAY;
  const targetDate = now + ONE_DAY * 2n;

  const marketId = (await market.read.nextMarketId()) as bigint;
  await market.write.createMarket([
    "Tokyo",
    "HIGH_TEMP",
    targetDate,
    BUCKETS,
    lockTime,
  ]);

  return { ...base, marketId, lockTime, targetDate };
}

// 附帶一個「已鎖定」的市場（LOCKED 狀態）
async function lockedMarketFixture(conn: NetworkConnection) {
  const base = await marketFixture(conn);
  const { market, marketId, lockTime } = base;

  await conn.networkHelpers.time.increaseTo(lockTime);
  await market.write.lockMarket([marketId]);

  return base;
}

// 附帶一個「已結算」的市場（SETTLED，user1 押 bucket 2，winning = bucket 2）
async function settledMarketFixture(conn: NetworkConnection) {
  const base = await marketFixture(conn);
  const { market, mockUSD, marketId, oracle, user1, lockTime } = base;

  // user1 先押 100 在 bucket 2，確保結算後有得獎者
  await market.write.placeBet([marketId, 2n, e18(100)], { account: user1.account });

  await conn.networkHelpers.time.increaseTo(lockTime);
  await market.write.lockMarket([marketId]);

  await mockUSD.write.approve([market.address, maxUint256], {
    account: oracle.account,
  });

  const memo = "Tokyo/HIGH_TEMP/30/WIN";
  await market.write.submitResult([marketId, TEMP.b2, memo], {
    account: oracle.account,
  });

  return { ...base, winningBucket: 2n, memo };
}

// ─── 測試套件 ─────────────────────────────────────────────────────────────────

describe("WeatherMarket", function () {
  let conn: NetworkConnection;

  before(async function () {
    conn = await hre.network.getOrCreate();
  });

  after(async function () {
    await conn.close();
  });

  // ── 1. Deployment ──────────────────────────────────────────────────────────

  describe("deployment", function () {
    it("stores constructor params correctly", async function () {
      const { market, mockUSD, oracle } = await conn.networkHelpers.loadFixture(baseFixture);

      expect(((await market.read.stablecoin()) as string).toLowerCase()).to.equal(
        mockUSD.address.toLowerCase()
      );
      expect(((await market.read.oracle()) as string).toLowerCase()).to.equal(
        oracle.account.address.toLowerCase()
      );
      expect((await market.read.scheduler()) as string).to.equal(zeroAddress);
      expect((await market.read.oracleFee()) as bigint).to.equal(0n);
    });

    it("initial accounting state is zero", async function () {
      const { market } = await conn.networkHelpers.loadFixture(baseFixture);

      expect((await market.read.nextMarketId()) as bigint).to.equal(0n);
      expect((await market.read.collectedFees()) as bigint).to.equal(0n);
      expect((await market.read.gasTankBalance()) as bigint).to.equal(0n);
    });

    it("FEE_BPS is 200 (2%)", async function () {
      const { market } = await conn.networkHelpers.loadFixture(baseFixture);
      expect((await market.read.FEE_BPS()) as bigint).to.equal(200n);
    });
  });

  // ── 2. createMarket ────────────────────────────────────────────────────────

  describe("createMarket", function () {
    it("creates market and emits MarketCreated", async function () {
      const { market } = await conn.networkHelpers.loadFixture(baseFixture);
      const pub = await conn.viem.getPublicClient();

      const now = BigInt(await conn.networkHelpers.time.latest());
      const hash = await market.write.createMarket([
        "Tokyo",
        "HIGH_TEMP",
        now + ONE_DAY * 2n,
        BUCKETS,
        now + ONE_DAY,
      ]);

      const receipt = await pub.waitForTransactionReceipt({ hash });
      expect(receipt.status).to.equal("success");

      expect((await market.read.nextMarketId()) as bigint).to.equal(1n);
    });

    it("stores city and predictionType in getMarket()", async function () {
      const { market, marketId } = await conn.networkHelpers.loadFixture(marketFixture);

      const result = (await market.read.getMarket([marketId])) as [
        string, string, ...unknown[]
      ];
      expect(result[0]).to.equal("Tokyo");
      expect(result[1]).to.equal("HIGH_TEMP");
    });

    it("reverts if called by non-owner", async function () {
      const { market, user1 } = await conn.networkHelpers.loadFixture(baseFixture);
      const now = BigInt(await conn.networkHelpers.time.latest());

      await expectRevert(
        market.write.createMarket(
          ["Tokyo", "HIGH_TEMP", now + ONE_DAY * 2n, BUCKETS, now + ONE_DAY],
          { account: user1.account }
        ),
        "OwnableUnauthorizedAccount"
      );
    });

    it("reverts if lockTime is in the past", async function () {
      const { market } = await conn.networkHelpers.loadFixture(baseFixture);
      const now = BigInt(await conn.networkHelpers.time.latest());

      await expectRevert(
        market.write.createMarket([
          "Tokyo", "HIGH_TEMP", now + ONE_DAY, BUCKETS, now - 1n,
        ]),
        "lockTime in past"
      );
    });

    it("reverts if targetDate <= lockTime", async function () {
      const { market } = await conn.networkHelpers.loadFixture(baseFixture);
      const now = BigInt(await conn.networkHelpers.time.latest());

      await expectRevert(
        market.write.createMarket([
          "Tokyo", "HIGH_TEMP", now + ONE_DAY, BUCKETS, now + ONE_DAY * 2n,
        ]),
        "targetDate before lockTime"
      );
    });

    it("reverts if buckets are not strictly ascending", async function () {
      const { market } = await conn.networkHelpers.loadFixture(baseFixture);
      const now = BigInt(await conn.networkHelpers.time.latest());

      await expectRevert(
        market.write.createMarket([
          "Tokyo", "HIGH_TEMP", now + ONE_DAY * 2n, [28n, 25n, 31n], now + ONE_DAY,
        ]),
        "buckets not sorted"
      );
    });
  });

  // ── 3. placeBet ────────────────────────────────────────────────────────────

  describe("placeBet", function () {
    it("records bet correctly", async function () {
      const { market, user1, marketId } = await conn.networkHelpers.loadFixture(marketFixture);

      await market.write.placeBet([marketId, 2n, e18(10)], {
        account: user1.account,
      });

      const userBet = (await market.read.bets([marketId, 2n, user1.account.address])) as bigint;
      expect(userBet).to.equal(e18(10));

      const bucketTotal = (await market.read.bucketTotals([marketId, 2n])) as bigint;
      expect(bucketTotal).to.equal(e18(10));

      const marketData = (await market.read.getMarket([marketId])) as [
        ...unknown[], bigint, ...unknown[]
      ];
      // totalPool is index 5
      const totalPool = (marketData as bigint[])[5];
      expect(totalPool).to.equal(e18(10));
    });

    it("multiple users bet on different buckets", async function () {
      const { market, user1, user2, marketId } = await conn.networkHelpers.loadFixture(marketFixture);

      await market.write.placeBet([marketId, 1n, e18(20)], { account: user1.account });
      await market.write.placeBet([marketId, 3n, e18(30)], { account: user2.account });

      const u1Bet = (await market.read.bets([marketId, 1n, user1.account.address])) as bigint;
      const u2Bet = (await market.read.bets([marketId, 3n, user2.account.address])) as bigint;
      expect(u1Bet).to.equal(e18(20));
      expect(u2Bet).to.equal(e18(30));
    });

    it("reverts past lock time", async function () {
      const { market, user1, marketId, lockTime } = await conn.networkHelpers.loadFixture(marketFixture);

      await conn.networkHelpers.time.increaseTo(lockTime);

      await expectRevert(
        market.write.placeBet([marketId, 2n, e18(10)], { account: user1.account }),
        "past lock time"
      );
    });

    it("reverts with zero amount", async function () {
      const { market, user1, marketId } = await conn.networkHelpers.loadFixture(marketFixture);

      await expectRevert(
        market.write.placeBet([marketId, 2n, 0n], { account: user1.account }),
        "zero amount"
      );
    });

    it("reverts with invalid bucket index", async function () {
      const { market, user1, marketId } = await conn.networkHelpers.loadFixture(marketFixture);

      // buckets.length = 4，最大合法 bucket = 4（index 0-4）
      await expectRevert(
        market.write.placeBet([marketId, 5n, e18(10)], { account: user1.account }),
        "invalid bucket"
      );
    });
  });

  // ── 4. lockMarket ──────────────────────────────────────────────────────────

  describe("lockMarket", function () {
    it("locks market at lockTime, emits MarketLocked", async function () {
      const { market, marketId, lockTime } = await conn.networkHelpers.loadFixture(marketFixture);
      const pub = await conn.viem.getPublicClient();

      await conn.networkHelpers.time.increaseTo(lockTime);
      const hash = await market.write.lockMarket([marketId]);
      const receipt = await pub.waitForTransactionReceipt({ hash });
      expect(receipt.status).to.equal("success");

      const mkt = (await market.read.getMarket([marketId])) as unknown[];
      // status (index 4): 0=OPEN, 1=LOCKED, 2=SETTLED
      expect(mkt[4]).to.equal(1);
    });

    it("reverts before lock time", async function () {
      const { market, marketId } = await conn.networkHelpers.loadFixture(marketFixture);

      await expectRevert(
        market.write.lockMarket([marketId]),
        "lock time not reached"
      );
    });

    it("reverts if already locked", async function () {
      const { market, marketId } = await conn.networkHelpers.loadFixture(lockedMarketFixture);

      await expectRevert(
        market.write.lockMarket([marketId]),
        "not open"
      );
    });
  });

  // ── 5. submitResult (MPP) ──────────────────────────────────────────────────

  describe("submitResult (MPP)", function () {
    it("oracle submits with memo, market becomes SETTLED", async function () {
      const { market, mockUSD, marketId, oracle } =
        await conn.networkHelpers.loadFixture(lockedMarketFixture);

      await mockUSD.write.approve([market.address, maxUint256], {
        account: oracle.account,
      });

      const memo = "Tokyo/HIGH_TEMP/30/WIN";
      await market.write.submitResult([marketId, TEMP.b2, memo], {
        account: oracle.account,
      });

      const mkt = (await market.read.getMarket([marketId])) as unknown[];
      expect(mkt[4]).to.equal(2); // status = SETTLED
      expect(mkt[10]).to.equal(memo); // settleMemo
    });

    it("getReceipt returns correct receipt data", async function () {
      const { market, marketId, memo, winningBucket } =
        await conn.networkHelpers.loadFixture(settledMarketFixture);

      const receipt = (await market.read.getReceipt([marketId])) as {
        marketId: bigint;
        finalTemp: bigint;
        winningBucket: number;
        noWinner: boolean;
        memo: string;
      };

      expect(receipt.marketId).to.equal(marketId);
      expect(receipt.finalTemp).to.equal(TEMP.b2);
      expect(BigInt(receipt.winningBucket)).to.equal(winningBucket);
      expect(receipt.noWinner).to.equal(false);
      expect(receipt.memo).to.equal(memo);
    });

    it("correctly determines all 5 winning buckets", async function () {
      // 各溫度對應的預期 bucket
      const cases: [bigint, bigint][] = [
        [TEMP.b0, 0n],
        [TEMP.b1, 1n],
        [TEMP.b2, 2n],
        [TEMP.b3, 3n],
        [TEMP.b4, 4n],
      ];

      for (const [temp, expectedBucket] of cases) {
        // 每個 case 需要獨立的 locked market，用 loadFixture 隔離
        const { market, mockUSD, user1, user2, marketId, oracle } =
          await conn.networkHelpers.loadFixture(lockedMarketFixture);

        await mockUSD.write.approve([market.address, maxUint256], {
          account: oracle.account,
        });

        await market.write.submitResult([marketId, temp, "test"], {
          account: oracle.account,
        });

        const mkt = (await market.read.getMarket([marketId])) as unknown[];
        expect(BigInt(mkt[7] as number)).to.equal(
          expectedBucket,
          `temp ${temp} should be in bucket ${expectedBucket}`
        );
      }
    });

    it("noWinner = true when winning bucket has no bets", async function () {
      // 只有 user1 押 bucket 0，oracle 回報 bucket 4 中獎 → noWinner
      const { market, mockUSD, marketId, oracle, user1, lockTime } =
        await conn.networkHelpers.loadFixture(marketFixture);

      await market.write.placeBet([marketId, 0n, e18(10)], { account: user1.account });

      await conn.networkHelpers.time.increaseTo(lockTime);
      await market.write.lockMarket([marketId]);

      await mockUSD.write.approve([market.address, maxUint256], { account: oracle.account });
      await market.write.submitResult([marketId, TEMP.b4, "no winner case"], {
        account: oracle.account,
      });

      const mkt = (await market.read.getMarket([marketId])) as unknown[];
      expect(mkt[9]).to.equal(true); // noWinner
    });

    it("collects 2% fee on totalPool when there is a winner", async function () {
      const { market, mockUSD, marketId, oracle, user1, lockTime } =
        await conn.networkHelpers.loadFixture(marketFixture);

      await market.write.placeBet([marketId, 2n, e18(100)], { account: user1.account });
      await conn.networkHelpers.time.increaseTo(lockTime);
      await market.write.lockMarket([marketId]);
      await mockUSD.write.approve([market.address, maxUint256], { account: oracle.account });
      await market.write.submitResult([marketId, TEMP.b2, "fee test"], {
        account: oracle.account,
      });

      // 2% of 100 = 2 pathUSD
      const fees = (await market.read.collectedFees()) as bigint;
      expect(fees).to.equal(e18(2));
    });

    it("MPP oracle fee: deducted from oracle and added to collectedFees", async function () {
      // 重新部署一個 oracleFee = 5 pathUSD 的 market
      const { market: baseMarket, mockUSD, oracle, user1, relayer } =
        await conn.networkHelpers.loadFixture(baseFixture);

      // 建新合約，oracle fee = 5
      const feeMarket = await conn.viem.deployContract("WeatherMarket", [
        mockUSD.address,
        oracle.account.address,
        zeroAddress,
        e18(5),
      ]);

      const now = BigInt(await conn.networkHelpers.time.latest());
      const lockTime = now + ONE_DAY;
      const targetDate = now + ONE_DAY * 2n;

      await mockUSD.write.approve([feeMarket.address, maxUint256], { account: user1.account });
      await mockUSD.write.approve([feeMarket.address, maxUint256], { account: oracle.account });

      const marketId = (await feeMarket.read.nextMarketId()) as bigint;
      await feeMarket.write.createMarket(["Seoul", "HIGH_TEMP", targetDate, BUCKETS, lockTime]);
      await feeMarket.write.placeBet([marketId, 2n, e18(50)], { account: user1.account });

      await conn.networkHelpers.time.increaseTo(lockTime);
      await feeMarket.write.lockMarket([marketId]);

      const oracleBefore = (await mockUSD.read.balanceOf([oracle.account.address])) as bigint;
      await feeMarket.write.submitResult([marketId, TEMP.b2, "fee test"], {
        account: oracle.account,
      });
      const oracleAfter = (await mockUSD.read.balanceOf([oracle.account.address])) as bigint;

      // oracle 支付了 5 pathUSD oracle fee
      expect(oracleBefore - oracleAfter).to.equal(e18(5));

      // collectedFees = 5 (oracle fee) + 1 (2% of 50) = 6
      const fees = (await feeMarket.read.collectedFees()) as bigint;
      expect(fees).to.equal(e18(6));
    });

    it("reverts if called by non-oracle", async function () {
      const { market, marketId, user1 } =
        await conn.networkHelpers.loadFixture(lockedMarketFixture);

      await expectRevert(
        market.write.submitResult([marketId, TEMP.b2, "hack"], { account: user1.account }),
        "not oracle"
      );
    });

    it("reverts if market is not locked", async function () {
      const { market, mockUSD, marketId, oracle } =
        await conn.networkHelpers.loadFixture(marketFixture);

      await mockUSD.write.approve([market.address, maxUint256], { account: oracle.account });

      await expectRevert(
        market.write.submitResult([marketId, TEMP.b2, "too early"], { account: oracle.account }),
        "not locked"
      );
    });
  });

  // ── 6. claimWinnings ───────────────────────────────────────────────────────

  describe("claimWinnings", function () {
    it("single winner gets net pool (98%) back", async function () {
      const { market, mockUSD, user1, marketId, lockTime, oracle } =
        await conn.networkHelpers.loadFixture(marketFixture);

      await market.write.placeBet([marketId, 2n, e18(100)], { account: user1.account });
      await conn.networkHelpers.time.increaseTo(lockTime);
      await market.write.lockMarket([marketId]);
      await mockUSD.write.approve([market.address, maxUint256], { account: oracle.account });
      await market.write.submitResult([marketId, TEMP.b2, "single winner"], {
        account: oracle.account,
      });

      const before = (await mockUSD.read.balanceOf([user1.account.address])) as bigint;
      await market.write.claimWinnings([marketId], { account: user1.account });
      const after = (await mockUSD.read.balanceOf([user1.account.address])) as bigint;

      // 押 100，拿回 98（扣 2% 手續費）
      expect(after - before).to.equal(e18(98));
    });

    it("two winners split payout proportionally", async function () {
      const { market, mockUSD, user1, user2, marketId, lockTime, oracle } =
        await conn.networkHelpers.loadFixture(marketFixture);

      // user1 押 30，user2 押 70，都押 bucket 2
      await market.write.placeBet([marketId, 2n, e18(30)], { account: user1.account });
      await market.write.placeBet([marketId, 2n, e18(70)], { account: user2.account });

      await conn.networkHelpers.time.increaseTo(lockTime);
      await market.write.lockMarket([marketId]);
      await mockUSD.write.approve([market.address, maxUint256], { account: oracle.account });
      await market.write.submitResult([marketId, TEMP.b2, "split payout"], {
        account: oracle.account,
      });

      // netPool = 100 * 98% = 98
      // user1 應得: 98 * 30/100 = 29.4
      // user2 應得: 98 * 70/100 = 68.6
      const b1Before = (await mockUSD.read.balanceOf([user1.account.address])) as bigint;
      const b2Before = (await mockUSD.read.balanceOf([user2.account.address])) as bigint;

      await market.write.claimWinnings([marketId], { account: user1.account });
      await market.write.claimWinnings([marketId], { account: user2.account });

      const b1After = (await mockUSD.read.balanceOf([user1.account.address])) as bigint;
      const b2After = (await mockUSD.read.balanceOf([user2.account.address])) as bigint;

      expect(b1After - b1Before).to.equal(parseUnits("29.4", D18));
      expect(b2After - b2Before).to.equal(parseUnits("68.6", D18));
    });

    it("noWinner: user gets full refund", async function () {
      const { market, mockUSD, user1, marketId, lockTime, oracle } =
        await conn.networkHelpers.loadFixture(marketFixture);

      await market.write.placeBet([marketId, 0n, e18(50)], { account: user1.account });

      await conn.networkHelpers.time.increaseTo(lockTime);
      await market.write.lockMarket([marketId]);
      await mockUSD.write.approve([market.address, maxUint256], { account: oracle.account });
      // oracle 回報 bucket 4 中獎，但沒人押 bucket 4 → noWinner
      await market.write.submitResult([marketId, TEMP.b4, "no winner refund"], {
        account: oracle.account,
      });

      const before = (await mockUSD.read.balanceOf([user1.account.address])) as bigint;
      await market.write.claimWinnings([marketId], { account: user1.account });
      const after = (await mockUSD.read.balanceOf([user1.account.address])) as bigint;

      expect(after - before).to.equal(e18(50)); // 全額退款
    });

    it("reverts if already claimed", async function () {
      const { market, user1, marketId } =
        await conn.networkHelpers.loadFixture(settledMarketFixture);

      await market.write.claimWinnings([marketId], { account: user1.account });

      await expectRevert(
        market.write.claimWinnings([marketId], { account: user1.account }),
        "already claimed"
      );
    });

    it("reverts if no winning bet", async function () {
      const { market, user2, marketId } =
        await conn.networkHelpers.loadFixture(settledMarketFixture);

      // user2 沒有下注 → 無法 claim
      await expectRevert(
        market.write.claimWinnings([marketId], { account: user2.account }),
        "no winning bet"
      );
    });

    it("reverts if market not settled", async function () {
      const { market, user1, marketId } =
        await conn.networkHelpers.loadFixture(lockedMarketFixture);

      await expectRevert(
        market.write.claimWinnings([marketId], { account: user1.account }),
        "not settled"
      );
    });
  });

  // ── 7. Fee Sponsorship (placeBetFor) ───────────────────────────────────────

  describe("Fee Sponsorship — placeBetFor", function () {
    it("approved relayer bets for user, tokens deducted from bettor", async function () {
      const { market, mockUSD, user1, relayer, marketId } =
        await conn.networkHelpers.loadFixture(marketFixture);

      const before = (await mockUSD.read.balanceOf([user1.account.address])) as bigint;

      await market.write.placeBetFor(
        [marketId, 2n, e18(10), user1.account.address],
        { account: relayer.account }
      );

      const after = (await mockUSD.read.balanceOf([user1.account.address])) as bigint;
      expect(before - after).to.equal(e18(10)); // user1 付款，不是 relayer

      const bet = (await market.read.bets([marketId, 2n, user1.account.address])) as bigint;
      expect(bet).to.equal(e18(10));
    });

    it("reverts if caller is not an approved relayer", async function () {
      const { market, user1, user2, marketId } =
        await conn.networkHelpers.loadFixture(marketFixture);

      await expectRevert(
        market.write.placeBetFor(
          [marketId, 2n, e18(10), user1.account.address],
          { account: user2.account } // user2 不是 relayer
        ),
        "not relayer"
      );
    });
  });

  // ── 8. Gas Tank ────────────────────────────────────────────────────────────

  describe("Gas Tank", function () {
    it("owner deposits and gasTankBalance increases", async function () {
      const { market, mockUSD, owner } = await conn.networkHelpers.loadFixture(baseFixture);

      await mockUSD.write.mint([owner.account.address, e18(100)]);
      await mockUSD.write.approve([market.address, e18(100)], { account: owner.account });

      await market.write.depositGasTank([e18(100)], { account: owner.account });

      expect((await market.read.gasTankBalance()) as bigint).to.equal(e18(100));
    });

    it("owner withdraws and gasTankBalance decreases", async function () {
      const { market, mockUSD, owner } = await conn.networkHelpers.loadFixture(baseFixture);

      await mockUSD.write.mint([owner.account.address, e18(100)]);
      await mockUSD.write.approve([market.address, e18(100)], { account: owner.account });
      await market.write.depositGasTank([e18(100)], { account: owner.account });

      const before = (await mockUSD.read.balanceOf([owner.account.address])) as bigint;
      await market.write.withdrawGasTank([e18(40)], { account: owner.account });
      const after = (await mockUSD.read.balanceOf([owner.account.address])) as bigint;

      expect((await market.read.gasTankBalance()) as bigint).to.equal(e18(60));
      expect(after - before).to.equal(e18(40));
    });

    it("reverts if withdraw exceeds gasTankBalance", async function () {
      const { market } = await conn.networkHelpers.loadFixture(baseFixture);

      await expectRevert(
        market.write.withdrawGasTank([e18(1)]),
        "insufficient gas tank"
      );
    });
  });

  // ── 9. Admin functions ────────────────────────────────────────────────────

  describe("admin", function () {
    it("setOracle updates oracle address", async function () {
      const { market, user1 } = await conn.networkHelpers.loadFixture(baseFixture);

      await market.write.setOracle([user1.account.address]);
      expect(((await market.read.oracle()) as string).toLowerCase()).to.equal(
        user1.account.address.toLowerCase()
      );
    });

    it("withdrawFees transfers collected fees to owner", async function () {
      const { market, mockUSD, owner, user1, marketId, lockTime, oracle } =
        await conn.networkHelpers.loadFixture(marketFixture);

      await market.write.placeBet([marketId, 2n, e18(100)], { account: user1.account });
      await conn.networkHelpers.time.increaseTo(lockTime);
      await market.write.lockMarket([marketId]);
      await mockUSD.write.approve([market.address, maxUint256], { account: oracle.account });
      await market.write.submitResult([marketId, TEMP.b2, "fee withdraw test"], {
        account: oracle.account,
      });

      const before = (await mockUSD.read.balanceOf([owner.account.address])) as bigint;
      await market.write.withdrawFees({ account: owner.account });
      const after = (await mockUSD.read.balanceOf([owner.account.address])) as bigint;

      expect(after - before).to.equal(e18(2)); // 2% of 100
    });

    it("reverts withdrawFees if no fees collected", async function () {
      const { market } = await conn.networkHelpers.loadFixture(baseFixture);

      await expectRevert(market.write.withdrawFees(), "no fees");
    });

    it("non-owner cannot call admin functions", async function () {
      const { market, user1 } = await conn.networkHelpers.loadFixture(baseFixture);

      await expectRevert(
        market.write.setOracle([user1.account.address], { account: user1.account }),
        "OwnableUnauthorizedAccount"
      );
      await expectRevert(
        market.write.setRelayer([user1.account.address, true], { account: user1.account }),
        "OwnableUnauthorizedAccount"
      );
    });
  });
});

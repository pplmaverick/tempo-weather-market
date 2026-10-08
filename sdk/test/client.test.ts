import { describe, expect, it } from "vitest";
import { tempoMainnet } from "../src/chains";
import { createWeatherMarketClient } from "../src/client";
import { bucketLabels } from "../src/encoding";
// contracts.ts has no imports, so the real frontend implementation can be compared directly.
import { formatBucketLabels } from "../../frontend/src/config/contracts";

// Read-only tests against Tempo mainnet (https://rpc.tempo.xyz).
const client = createWeatherMarketClient({ chain: tempoMainnet });

describe("mainnet read-only", () => {
  it("getMarket(29) returns a well-formed market", async () => {
    const m = await client.getMarket(29);
    expect(m.id).toBe(29);
    expect(m.city.length).toBeGreaterThan(0);
    expect(["OPEN", "LOCKED", "SETTLED"]).toContain(m.status);
    expect(m.bucketsC.length).toBeGreaterThan(0);
    expect(m.bucketsC).toEqual([...m.bucketsC].sort((a, b) => a - b));
    expect(m.bucketLabels).toHaveLength(m.bucketsC.length + 1);
    expect(m.lockTime).toBeGreaterThan(0);
    if (m.status !== "SETTLED") expect(m.finalTempC).toBeNull();
  }, 30_000);

  it("listMarkets returns at least 30 markets with sequential ids", async () => {
    const markets = await client.listMarkets();
    expect(markets.length).toBeGreaterThanOrEqual(30);
    expect(markets.map((m) => m.id)).toEqual(markets.map((_, i) => i));
  }, 60_000);
});

describe("bucketLabels parity with frontend formatBucketLabels", () => {
  // Source: frontend/src/config/contracts.ts:46-50
  it.each([
    [[250n, 280n, 310n, 340n]],
    [[100n, 150n, 200n, 250n]],
    [[-25n, 0n, 100n]],
    [[315n]],
  ])("matches for case #%#", (boundaries) => {
    expect(bucketLabels(boundaries)).toEqual(formatBucketLabels(boundaries));
  });

  it("matches hardcoded expected output", () => {
    expect(bucketLabels([250n, 280n, 310n, 340n])).toEqual([
      "< 25°C",
      "25–28°C",
      "28–31°C",
      "31–34°C",
      "> 34°C",
    ]);
  });
});

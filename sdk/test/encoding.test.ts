import { describe, expect, it } from "vitest";
import { bucketLabels, fromX10, toX10 } from "../src/encoding";

describe("toX10", () => {
  it("encodes known values", () => {
    expect(toX10(25.0)).toBe(250n);
    expect(toX10(-3.4)).toBe(-34n);
    expect(toX10(27.1)).toBe(271n);
    expect(toX10(0)).toBe(0n);
    expect(toX10(-0)).toBe(0n);
  });

  it("rounds half away from zero", () => {
    expect(toX10(25.04)).toBe(250n);
    expect(toX10(25.06)).toBe(251n);
    expect(toX10(-25.06)).toBe(-251n);
    expect(toX10(-0.04)).toBe(0n);
  });

  it("throws on non-finite input", () => {
    expect(() => toX10(NaN)).toThrow();
    expect(() => toX10(Infinity)).toThrow();
    expect(() => toX10(-Infinity)).toThrow();
  });
});

describe("fromX10", () => {
  it("decodes", () => {
    expect(fromX10(250n)).toBe(25);
    expect(fromX10(-34n)).toBe(-3.4);
  });

  it("round-trips one-decimal values", () => {
    for (let v = -500n; v <= 600n; v++) {
      expect(toX10(fromX10(v))).toBe(v);
    }
    for (const c of [25.0, -3.4, 27.1, 0.1, -0.1, 39.9]) {
      expect(fromX10(toX10(c))).toBe(c);
    }
  });
});

describe("bucketLabels", () => {
  // Expected strings are what formatBucketLabels in frontend/src/config/contracts.ts:46-50
  // yields for the same input (BUCKET_BOUNDARIES = [250n, 280n, 310n, 340n]).
  it("matches the frontend formatBucketLabels output", () => {
    expect(bucketLabels([250n, 280n, 310n, 340n])).toEqual([
      "< 25°C",
      "25–28°C",
      "28–31°C",
      "31–34°C",
      "> 34°C",
    ]);
  });

  it("handles decimals and negatives", () => {
    expect(bucketLabels([-25n, 100n])).toEqual(["< -2.5°C", "-2.5–10°C", "> 10°C"]);
  });

  it("throws on empty input", () => {
    expect(() => bucketLabels([])).toThrow();
  });
});

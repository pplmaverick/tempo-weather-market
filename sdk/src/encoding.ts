// x10 encoding, matching WeatherMarket.sol: celsius * 10 as int256 (e.g. 25.0°C <-> 250n, -3.4°C <-> -34n).

/**
 * Celsius -> x10 bigint. Rounds half away from zero. Throws on NaN/±Infinity.
 *
 * Note: rounding away from zero can differ by 1 from the oracle's `Math.round` at negative .5
 * boundaries (e.g. -2.55 -> -26n here, -25 from Math.round). Settlement uses the value the oracle submits.
 */
export function toX10(celsius: number): bigint {
  if (!Number.isFinite(celsius)) {
    throw new RangeError(`toX10: celsius must be a finite number, got ${celsius}`);
  }
  const scaled = Math.round(Math.abs(celsius) * 10);
  return BigInt(celsius < 0 ? -scaled : scaled);
}

/** x10 bigint -> Celsius number. */
export function fromX10(v: bigint): number {
  return Number(v) / 10;
}

/**
 * Display labels for market buckets from on-chain upper boundaries (x10, ascending).
 * Produces boundaries.length + 1 labels; mirrors frontend/src/config/contracts.ts formatBucketLabels.
 */
export function bucketLabels(boundariesX10: bigint[]): string[] {
  if (boundariesX10.length === 0) {
    throw new RangeError("bucketLabels: at least one boundary is required");
  }
  const last = fromX10(boundariesX10[boundariesX10.length - 1]);
  return boundariesX10
    .map((upper, i) => {
      const upperC = fromX10(upper);
      if (i === 0) return `< ${upperC}°C`;
      return `${fromX10(boundariesX10[i - 1])}–${upperC}°C`;
    })
    .concat(`> ${last}°C`);
}

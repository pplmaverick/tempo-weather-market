import type { Address } from "viem";

/** WeatherMarket deployments, keyed by chainId. Source of truth: deployments/tempo.json and deployments/moderato.json. */
export const weatherMarketAddresses = {
  4217: "0x072a3a0c04cf8cdcaf5b4a73a4ed4ff5a841531f",
  42431: "0xcAC5B9d2817325E78090E3Ce4b9C299C819cF953",
} as const satisfies Record<number, Address>;

export function getWeatherMarketAddress(chainId: number): Address {
  const address = (weatherMarketAddresses as Record<number, Address>)[chainId];
  if (!address) throw new Error(`No WeatherMarket deployment for chainId ${chainId}`);
  return address;
}

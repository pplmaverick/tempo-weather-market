import { createPublicClient, http, type Address, type Chain } from "viem";
import { weatherMarketAbi } from "./abi";
import { getWeatherMarketAddress } from "./addresses";
import { bucketLabels, fromX10 } from "./encoding";

export type MarketStatus = "OPEN" | "LOCKED" | "SETTLED";

const STATUS_BY_INDEX: readonly MarketStatus[] = ["OPEN", "LOCKED", "SETTLED"];

export interface Market {
  id: number;
  city: string;
  predictionType: string;
  /** Unix seconds. */
  targetDate: number;
  /** Unix seconds. */
  lockTime: number;
  status: MarketStatus;
  /** Raw stablecoin units (6 decimals on mainnet). */
  totalPool: bigint;
  /** Settled temperature in °C; null until the market is SETTLED. */
  finalTempC: number | null;
  winningBucket: number;
  /** Bucket upper boundaries in °C, strictly ascending. */
  bucketsC: number[];
  /** Display labels, bucketsC.length + 1 entries. */
  bucketLabels: string[];
  noWinner: boolean;
  settleMemo: string;
}

export interface WeatherMarketClientOptions {
  chain: Chain;
  /** Defaults to the chain's default RPC URL. */
  rpcUrl?: string;
}

export interface WeatherMarketClient {
  address: Address;
  getMarketCount(): Promise<number>;
  getMarket(id: number): Promise<Market>;
  /** Reads every market 0..nextMarketId-1. */
  listMarkets(): Promise<Market[]>;
}

export function createWeatherMarketClient({ chain, rpcUrl }: WeatherMarketClientOptions): WeatherMarketClient {
  const address: Address = getWeatherMarketAddress(chain.id);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { batch: true }) });

  async function getMarketCount(): Promise<number> {
    const next = await publicClient.readContract({
      address,
      abi: weatherMarketAbi,
      functionName: "nextMarketId",
    });
    return Number(next);
  }

  async function getMarket(id: number): Promise<Market> {
    const [
      city,
      predictionType,
      targetDate,
      lockTime,
      statusIndex,
      totalPool,
      finalTemp,
      winningBucket,
      buckets,
      noWinner,
      settleMemo,
    ] = await publicClient.readContract({
      address,
      abi: weatherMarketAbi,
      functionName: "getMarket",
      args: [BigInt(id)],
    });

    const status = STATUS_BY_INDEX[statusIndex];
    if (!status) throw new Error(`Market ${id}: unknown status ${statusIndex}`);

    const boundaries = [...buckets];
    return {
      id,
      city,
      predictionType,
      targetDate: Number(targetDate),
      lockTime: Number(lockTime),
      status,
      totalPool,
      finalTempC: status === "SETTLED" ? fromX10(finalTemp) : null,
      winningBucket,
      bucketsC: boundaries.map(fromX10),
      bucketLabels: boundaries.length > 0 ? bucketLabels(boundaries) : [],
      noWinner,
      settleMemo,
    };
  }

  async function listMarkets(): Promise<Market[]> {
    const count = await getMarketCount();
    return Promise.all(Array.from({ length: count }, (_, id) => getMarket(id)));
  }

  return { address, getMarketCount, getMarket, listMarkets };
}

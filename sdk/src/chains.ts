import type { Address, Chain } from "viem";
import { tempo, tempoModerato } from "viem/chains";

/** Tempo mainnet (chainId 4217). No native gas token — pass through withFeeToken() before sending txs. */
export const tempoMainnet = {
  ...tempo,
  rpcUrls: { default: { http: ["https://rpc.tempo.xyz"] } },
} as const satisfies Chain;

/** Tempo Moderato testnet (chainId 42431). pathUSD is the native token, standard EIP-1559 works. */
export const moderato = {
  ...tempoModerato,
  rpcUrls: { default: { http: ["https://rpc.moderato.tempo.xyz"] } },
} as const satisfies Chain;

/** Mainnet settlement stablecoin (USDC.e, 6 decimals). */
export const USDCE: Address = "0x20C000000000000000000000b9537d11c60E8b50";

/** Testnet settlement stablecoin (pathUSD precompile, 6 decimals). */
export const pathUSD: Address = "0x20c0000000000000000000000000000000000000";

/**
 * Returns a copy of `chain` with `feeToken` set. viem's tempo chain then serializes
 * Tempo 0x76 transactions and injects feeToken via its prepareTransactionRequest hook,
 * so the Fee AMM pays gas in that token.
 */
export function withFeeToken<const T extends Chain>(
  chain: T,
  tokenAddress: Address,
): T & { feeToken: Address } {
  return { ...chain, feeToken: tokenAddress };
}

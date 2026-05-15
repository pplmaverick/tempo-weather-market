import { defineConfig } from "hardhat/config";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatIgnitionViem from "@nomicfoundation/hardhat-ignition-viem";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import dotenv from "dotenv";

dotenv.config();

// Tempo 網路沒有 native gas token，gas 費用用 stablecoin 支付
// testnet 結算幣: pathUSD (Tempo Moderato)
// mainnet 結算幣: USDC.e (Tempo)

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";

export default defineConfig({
  plugins: [hardhatViem, hardhatIgnitionViem, hardhatNetworkHelpers, hardhatMocha],

  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris",
    },
  },

  networks: {
    // Tempo Moderato Testnet
    moderato: {
      type: "http",
      url: process.env.MODERATO_RPC_URL ?? "https://rpc.moderato.tempo.xyz",
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY}`] : [],
      chainId: 42431,
    },

    // Tempo Mainnet
    tempo: {
      type: "http",
      url: process.env.TEMPO_RPC_URL ?? "https://rpc.tempo.xyz",
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY}`] : [],
      chainId: 4217,
    },
  },

  // Hardhat 本機測試用 (預設)
  // `hardhat` 網路由 Hardhat 3 自動提供，不需要手動定義
});

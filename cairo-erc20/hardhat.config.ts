import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],

  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
  },

  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },

  networks: {
    // Local simulation
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },

    // Testnet
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [
        configVariable("DEPLOYER_PRIVATE_KEY"),  // index 0 — deploys contracts
        configVariable("USER_PRIVATE_KEY"),       // index 1 — deposits / withdraws
        configVariable("VAULT_PRIVATE_KEY"),      // index 2 — vault, pre-approves contract
      ],
    },

    // Mainnet
    mainnet: {
      type: "http",
      chainType: "l1",
      url: configVariable("MAINNET_RPC_URL"),
      accounts: [
        configVariable("DEPLOYER_PRIVATE_KEY"),
        configVariable("USER_PRIVATE_KEY"),
        configVariable("VAULT_PRIVATE_KEY"),
      ],
    },
  },
});
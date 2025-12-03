import type { HardhatUserConfig } from "hardhat/types";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-web3";
import "@nomiclabs/hardhat-truffle5";
import "hardhat-abi-exporter";
import "hardhat-contract-sizer";
import "solidity-coverage";
import "dotenv/config";

const adminPk = process.env.ADMIN_PRIVATE_KEY;
const operatorPk = process.env.OPERATOR_PRIVATE_KEY;
const testerPks = process.env.TESTER_PRIVATE_KEYS?.split(",") ?? [];

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
    },
    bsc_mainnet: {
      url:
        process.env.BINANCE_MAINNET_RPC_URL ||
        "https://bsc-dataseed.bnbchain.org",
      chainId: 56,
      accounts: [adminPk, operatorPk].filter(Boolean) as string[],
    },
    bsc_testnet: {
      url:
        process.env.BINANCE_TESTNET_RPC_URL ||
        "https://bsc-testnet.bnbchain.org",
      chainId: 97,
      accounts: [adminPk, operatorPk, ...testerPks].filter(Boolean) as string[],
    },
  },
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 99999,
      },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  abiExporter: {
    path: "./data/abi",
    clear: true,
    flat: false,
  },
};

export default config;

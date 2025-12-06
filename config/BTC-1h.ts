import "dotenv/config";

export default {
  TokenPair: "BTC/USD",
  Pyth: {
    bsc_mainnet: "0x4D7E825f80bDf85e913E0DD2A2D54927e9dE1594",
    bsc_testnet: "0x5744Cbf430D99456a0A8771208b674F27f8EF0Fb",
  },
  priceId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  Operator: {
    bsc_mainnet: "0x0000000000000000000000000000000000000000",
    bsc_testnet: "0x3f33c81342cba6dfa8e3ad6e92ef75f0a23bad0f",
  },
  HyperPredictV1Pair: {
    bsc_mainnet: "",
    bsc_testnet: "0x961b38169d32b9356177537077f2812ed2504c3e",
  },
  Interval: 3600, // 1 hour
};

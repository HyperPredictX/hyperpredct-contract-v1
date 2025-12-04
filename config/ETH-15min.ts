import "dotenv/config";

export default {
  TokenPair: "ETH/USD",
  Pyth: {
    bsc_mainnet: "0x4D7E825f80bDf85e913E0DD2A2D54927e9dE1594",
    bsc_testnet: "0x5744Cbf430D99456a0A8771208b674F27f8EF0Fb",
  },
  priceId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  Operator: {
    bsc_mainnet: "0x0000000000000000000000000000000000000000",
    bsc_testnet: "0x90cf17ac6de56f8f70c4d5066044852dcc580ca2",
  },
  HyperPredictV1Pair: {
    bsc_mainnet: "",
    bsc_testnet: "0x015b7bbe20de7e2e09d64fd618c7f3f6b9538b9b",
  },
  Interval: 900, // 1 day
};

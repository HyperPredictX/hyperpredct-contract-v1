import "dotenv/config";

export default {
  TokenPair: "BNB/USD",
  Pyth: {
    bsc_mainnet: "0x4D7E825f80bDf85e913E0DD2A2D54927e9dE1594",
    bsc_testnet: "0x5744Cbf430D99456a0A8771208b674F27f8EF0Fb",
  },
  priceId: "0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f",
  Operator: {
    bsc_mainnet: "0xc893924df6a2b89914c8eb225ab4f9490e2f7c1f",
    bsc_testnet: "0x0a96f66d237a6225a38c009fe294b469f1f5e504",
  },
  HyperPredictV1Pair: {
    bsc_mainnet: "0x7082d3b5f441d2011d5577e72fe77d34eec346ec",
    bsc_testnet: "0xa39e6d3c64f7ce60a8d7961e98f16bccb7fef153",
  },
  Interval: 86400, // 1 day
};

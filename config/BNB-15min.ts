import "dotenv/config";

export default {
  TokenPair: "BNB/USD",
  Pyth: {
    bsc_mainnet: "0x4D7E825f80bDf85e913E0DD2A2D54927e9dE1594",
    bsc_testnet: "0x5744Cbf430D99456a0A8771208b674F27f8EF0Fb",
  },
  priceId: "0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f",
  Operator: {
    bsc_mainnet: "0x2d527ac591a1cfbd28025edfdccbbb838abba3bf",
    bsc_testnet: "0x095a19224e35a71d2a5df2f8380764d798909419",
  },
  HyperPredictV1Pair: {
    bsc_mainnet: "0xca365f71ec318fd299f2dcaf5bbf99489445e150",
    bsc_testnet: "0xb2718ced5af813a4753aded9199145d7ece8cac4", // 15 min
  },
  Interval: 900,
};

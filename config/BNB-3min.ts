import "dotenv/config";

export default {
  TokenPair: "BNB/USD",
  Pyth: {
    bsc_mainnet: "0x4D7E825f80bDf85e913E0DD2A2D54927e9dE1594",
    bsc_testnet: "0x5744Cbf430D99456a0A8771208b674F27f8EF0Fb",
  },
  priceId: "0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f",
  Operator: {
    bsc_mainnet: "0xce521ff365b0c3a26214f8183544f30bba8fe6ef",
    bsc_testnet: "0x11647ed18c27340b541ce9af2f68c72395e1b02e",
  },
  HyperPredictV1Pair: {
    bsc_mainnet: "0x5c862106c3f5ab2a91450aa1e6731c3e4b31e405",
    bsc_testnet: "0xdf5e4e84cd122bd77bc4f22fe5d314db83f68a7a", // 3 min
  },
  Interval: 180,
};

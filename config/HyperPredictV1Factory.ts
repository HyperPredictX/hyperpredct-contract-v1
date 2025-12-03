import "dotenv/config";

export default {
  Address: {
    Factory: {
      bsc_mainnet: "0x32e6c523b3fb3700133b9363c7288b8a919628ee",
      bsc_testnet: "0x0692f3803c76b2680c063fdbd130e91597a91b16",
    },
    ReferralRegistry: {
      bsc_mainnet: "0x162e6c250BDdDbff8c35c56274a56E6386b1963B",
      bsc_testnet: "0x7b14e42F8c9b2A63519b76D2935b6a2DC48F4c61",
    },
    Admin: {
      bsc_mainnet: "0x22a0c5126414dd422e2476e53ef0738d9cc52ae2",
      bsc_testnet: "0x22a0c5126414dd422e2476e53ef0738d9cc52ae2",
    },
    ERC20Token: {
      bsc_mainnet: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // USDC
      bsc_testnet: "0x78867bbeef44f2326bf8ddd1941a4439382ef2a7", // BUSD
    },
  },
  BufferSeconds: {
    bsc_mainnet: 30,
    bsc_testnet: 30,
  },
  Treasury: {
    bsc_mainnet: 0.01 * 10000, // 1%
    bsc_testnet: 0.01 * 10000, // 1%
  },
  ReferralFee: {
    bsc_mainnet: 0.01 * 10000, // 1%
    bsc_testnet: 0.01 * 10000, // 1%
  },
  BetAmount: {
    bsc_mainnet: 1,
    bsc_testnet: 1,
  },
};

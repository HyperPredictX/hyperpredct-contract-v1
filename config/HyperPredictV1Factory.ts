import "dotenv/config";

export default {
  Address: {
    Factory: {
      bsc_mainnet: "0x32e6c523b3fb3700133b9363c7288b8a919628ee",
      bsc_testnet: "0x844042a3ec6e3c3a6a14966cdf1e7832d71c55d6",
    },
    ReferralRegistry: {
      bsc_mainnet: "0x162e6c250BDdDbff8c35c56274a56E6386b1963B",
      bsc_testnet: "0x49CA334F03741100Edb81d9145624d04F6DF4a44",
    },
    Admin: {
      bsc_mainnet: "0x22a0c5126414dd422e2476e53ef0738d9cc52ae2",
      bsc_testnet: "0x302c4827528530f8bb7b66b18fea42a32faafebc",
    },
    ERC20Token: {
      bsc_mainnet: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // USDC
      bsc_testnet: "0xce5033f0c4ebfe032404b7b0b0e74d4a84e8c1de", // mUSDC
    },
  },
  BufferSeconds: {
    bsc_mainnet: 30,
    bsc_testnet: 30,
  },
  Treasury: {
    bsc_mainnet: 0.03 * 10000, // 3%
    bsc_testnet: 0.03 * 10000, // 3%
  },
  TreasuryWithReferral: {
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

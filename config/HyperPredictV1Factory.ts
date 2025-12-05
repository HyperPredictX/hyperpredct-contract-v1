import "dotenv/config";

export default {
  Address: {
    Factory: {
      bsc_mainnet: "0x62862089f56dd6e44db90117b5928057bf521a1d",
      bsc_testnet: "0x12c8327efdb6856f8769de26f146ab42460c978f",
    },
    ReferralRegistry: {
      bsc_mainnet: "0x672B4B944AAdf2ed2b210D40cA611B28517a2698",
      bsc_testnet: "0xDcb4b940AdfA66eD218c58371B39102d0da3Dd5a",
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

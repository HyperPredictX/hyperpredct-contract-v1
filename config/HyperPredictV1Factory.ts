import "dotenv/config";

export default {
  Address: {
    Factory: {
      hyperevm_mainnet: "",
      hyperevm_testnet: "0x0692f3803c76b2680c063fdbd130e91597a91b16",
    },
    ReferralRegistry: {
      hyperevm_mainnet: "0x0000000000000000000000000000000000000000",
      hyperevm_testnet: "0x7b14e42F8c9b2A63519b76D2935b6a2DC48F4c61",
    },
    Admin: {
      hyperevm_mainnet: "0x0000000000000000000000000000000000000000",
      hyperevm_testnet: "0x302c4827528530f8bb7b66b18fea42a32faafebc",
    },
  },
  BufferSeconds: {
    hyperevm_mainnet: 30,
    hyperevm_testnet: 30,
  },
  Treasury: {
    hyperevm_mainnet: 0.003 * 10000, // 0.3%
    hyperevm_testnet: 0.003 * 10000, // 0.3%
  },
  ReferralFee: {
    hyperevm_mainnet: 0.001 * 10000, // 0.1%
    hyperevm_testnet: 0.001 * 10000, // 0.1%
  },
  BetAmount: {
    hyperevm_mainnet: 0.01,
    hyperevm_testnet: 0.01,
  },
};

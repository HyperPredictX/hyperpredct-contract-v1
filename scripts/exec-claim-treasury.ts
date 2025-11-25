import { ethers, network } from "hardhat";
import { claimTreasury } from "./claim-treasury";
import { loadConfig } from "./lib/loadConfig";

async function main() {
  const config = await loadConfig();
  const networkName = network.name;

  const pairAddress =
    config.HyperPredictV1Pair?.[networkName] ??
    config.PairAddress?.[networkName];

  if (!pairAddress || pairAddress === ethers.constants.AddressZero) {
    throw new Error(`Pair address not set for network: ${networkName}`);
  }

  const HyperPredictV1PairContract = await ethers.getContractAt(
    "HyperPredictV1Pair",
    pairAddress
  );

  console.log(`Claiming treasury from pair at address: ${pairAddress}`);
  await claimTreasury(HyperPredictV1PairContract);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

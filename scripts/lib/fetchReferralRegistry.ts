import { ethers, artifacts } from "hardhat";
import { loadConfig } from "./loadConfig";
import { network } from "hardhat";

export async function fetchReferralRegistry() {
  const config = await loadConfig("./config/HyperPredictV1Factory.ts");
  const networkName = network.name;
  const referralContractAddress = config.Address.ReferralRegistry[networkName];
  const artifact = await artifacts.readArtifact("ReferralRegistry");
  const ReferralRegistry = new ethers.Contract(
    referralContractAddress,
    artifact.abi
  );
  return { ReferralRegistry };
}

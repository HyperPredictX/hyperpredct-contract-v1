import { ethers, artifacts, network } from "hardhat";
import { loadConfig } from "../lib/loadConfig";

type CallerType = "operator" | "admin";

export async function fetchOracle(callerType: CallerType = "operator") {
  const config = await loadConfig();
  const networkName = network.name;
  const contractAddress = config.Pyth[networkName];
  const [admin, operator] = await ethers.getSigners();
  console.log(`Pyth Contract: ${contractAddress}`);
  console.log(`admin   : ${admin.address}`);
  console.log(`operator: ${operator.address}`);

  // Attach ABI
  const artifact = await artifacts.readArtifact("IPyth");
  const caller = callerType === "admin" ? admin : operator;
  const Oracle = new ethers.Contract(contractAddress, artifact.abi, caller);

  return { Oracle };
}

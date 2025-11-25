import { ethers, artifacts, network } from "hardhat";
import { loadConfig } from "./lib/loadConfig";

async function main() {
  const config = await loadConfig();
  const networkName = network.name;
  const contract = config.Address.HyperPredictV1Pair[networkName];
  console.log("==== Genesis Round Runner ====");
  console.log(`Network: ${network.name}`);
  const signers = await ethers.getSigners();
  const signer = signers[1];

  console.log(`Predict Contract: ${contract}`);
  console.log(`Signer: ${signer.address}`);

  // Attach ABI
  const artifact = await artifacts.readArtifact("HyperPredictV1Pair");
  const HyperPredictV1PairContract = new ethers.Contract(
    contract,
    artifact.abi,
    signer
  );

  // Quick sanity check: operator & params
  const operatorAddress = await HyperPredictV1PairContract.operatorAddress();
  const adminAddress = await HyperPredictV1PairContract.adminAddress?.().catch(
    () => undefined
  );
  const intervalSeconds =
    await HyperPredictV1PairContract.intervalSeconds?.().catch(() => undefined);

  console.log(`operatorAddress: ${operatorAddress}`);
  if (adminAddress) console.log(`adminAddress   : ${adminAddress}`);
  if (intervalSeconds)
    console.log(`intervalSeconds: ${intervalSeconds.toString()}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { ethers, network, run } from "hardhat";
import * as path from "path";
import { loadConfig } from "./lib/loadConfig";
import { updateHyperPredictV1PairAddress } from "./lib/updatePairAddress";

const configFileInput = process.env.CONFIG_FILE || "config/hype.ts";
const configFilePath = path.isAbsolute(configFileInput)
  ? configFileInput
  : path.resolve(process.cwd(), configFileInput);

const main = async () => {
  const factoryConfig = await loadConfig("./config/HyperPredictV1Factory.ts");
  const config = await loadConfig();
  // Get network data from Hardhat config (see hardhat.config.ts).
  const networkName = network.name;

  // Check if the network is supported.
  if (
    networkName === "hyperevm_testnet" ||
    networkName === "hyperevm_mainnet"
  ) {
    console.log(`Deploying to ${networkName} network...`);

    // Check if the addresses in the config are set.
    if (
      config.Pyth[networkName] === ethers.constants.AddressZero ||
      config.priceId === ethers.constants.HashZero ||
      config.Operator[networkName] === ethers.constants.AddressZero
    ) {
      throw new Error(
        "Missing addresses (Chainlink Oracle and/or Admin/Operator)"
      );
    }

    // Compile contracts.
    await run("compile");
    console.log("Compiled contracts...");

    const admin = (await ethers.getSigners())[0]; // signer

    const HyperPredictV1Factory = await ethers.getContractAt(
      "HyperPredictV1Factory",
      factoryConfig.Address.Factory[networkName],
      admin
    );

    await HyperPredictV1Factory.connect(admin);

    await HyperPredictV1Factory.createPair(
      config.Pyth[networkName],
      config.priceId,
      config.Operator[networkName],
      config.Interval
    );

    const allPairsLength = await HyperPredictV1Factory.allPairsLength();
    const length = allPairsLength.toNumber();
    const contractAddress = await HyperPredictV1Factory.allPairs(length - 1);
    const contract = await ethers.getContractAt(
      "HyperPredictV1Pair",
      contractAddress,
      admin
    );
    const operatorAddress = await contract.operatorAddress();
    const intervalSeconds = await contract.intervalSeconds();
    const deployedAddress = contract.address.toLowerCase();
    console.log(
      `Deployed to ${deployedAddress}` +
        `  (interval: ${intervalSeconds}s, operator: ${operatorAddress})`
    );
    await updateHyperPredictV1PairAddress(
      configFilePath,
      deployedAddress,
      networkName,
      configFileInput
    );
  } else {
    console.log(`Deploying to ${networkName} network is not supported...`);
  }
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

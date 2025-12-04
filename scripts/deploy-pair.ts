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
  if (networkName === "bsc_testnet" || networkName === "bsc_mainnet") {
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

    const tx = await HyperPredictV1Factory.createPair(
      config.Pyth[networkName],
      config.priceId,
      config.Operator[networkName],
      config.Interval,
      config.TokenPair
    );
    const receipt = await tx.wait();

    let contractAddress: string | undefined;
    const pairCreatedTopic =
      HyperPredictV1Factory.interface.getEventTopic("PairCreated");
    const pairCreatedEvent = receipt.events?.find(
      (event) => event.topics?.[0] === pairCreatedTopic
    );
    if (pairCreatedEvent && pairCreatedEvent.args) {
      const args = pairCreatedEvent.args;
      contractAddress =
        (args.pair as string | undefined) ?? (args[0] as string | undefined);
    } else {
      const allPairsLength = await HyperPredictV1Factory.allPairsLength();
      if (allPairsLength.isZero()) {
        throw new Error("No pairs available after deployment");
      }
      contractAddress = await HyperPredictV1Factory.allPairs(
        allPairsLength.sub(1)
      );
    }

    if (!contractAddress) {
      throw new Error("Unable to determine deployed pair address");
    }

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

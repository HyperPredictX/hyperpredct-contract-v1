import { parseEther } from "ethers/lib/utils";
import { ethers, network, run } from "hardhat";
import { loadConfig } from "./lib/loadConfig";

const main = async () => {
  const config = await loadConfig("./config/HyperPredictV1Factory.ts");
  // Get network data from Hardhat config (see hardhat.config.ts).
  const networkName = network.name;

  // Check if the network is supported.
  if (networkName === "bsc_testnet" || networkName === "bsc_mainnet") {
    console.log(`Deploying to ${networkName} network...`);

    // Check if the addresses in the config are set.
    if (config.Address.Admin[networkName] === ethers.constants.AddressZero) {
      throw new Error(
        "Missing addresses (Chainlink Oracle and/or Admin/Operator)"
      );
    }

    // Compile contracts.
    await run("compile");
    console.log("Compiled contracts...");

    // Deploy library dependency first.
    const PythUtils = await ethers.getContractFactory("PythUtils");
    const pythUtils = await PythUtils.deploy();
    await pythUtils.deployed();
    console.log(`PythUtils deployed to ${pythUtils.address.toLowerCase()}`);

    const referralRegistryAddress =
      config.Address.ReferralRegistry?.[networkName];
    if (
      !referralRegistryAddress ||
      referralRegistryAddress === ethers.constants.AddressZero
    ) {
      throw new Error(
        `Missing ReferralRegistry address for ${networkName}. Deploy it first and update the config.`
      );
    }

    const tokenAddress = config.Address?.ERC20Token?.[networkName];
    if (!tokenAddress || tokenAddress === ethers.constants.AddressZero) {
      throw new Error(`Missing Token address for ${networkName}`);
    }

    // Deploy contracts.
    const HyperPredictV1Factory = await ethers.getContractFactory(
      "HyperPredictV1Factory"
    );
    const bufferSeconds = config.BufferSeconds?.[networkName];
    if (!bufferSeconds) {
      throw new Error(`Missing BufferSeconds config for ${networkName}`);
    }

    const treasuryFee = config.Treasury?.[networkName];
    if (treasuryFee === undefined) {
      throw new Error(`Missing Treasury config for ${networkName}`);
    }
    const treasuryFeeWithReferral =
      config.TreasuryWithReferral?.[networkName];
    if (treasuryFeeWithReferral === undefined) {
      throw new Error(
        `Missing TreasuryWithReferral config for ${networkName}`
      );
    }

    const contract = await HyperPredictV1Factory.deploy(
      tokenAddress,
      referralRegistryAddress,
      config.Address.Admin[networkName],
      parseEther(config.BetAmount[networkName].toString()).toString(),
      bufferSeconds,
      config.ReferralFee[networkName],
      treasuryFee,
      treasuryFeeWithReferral
    );

    // Wait for the contract to be deployed before exiting the script.
    await contract.deployed();

    console.log(
      `Referral Registry set to ${referralRegistryAddress.toLocaleLowerCase()}`
    );
    console.log(`Factory deployed to ${contract.address.toLocaleLowerCase()}`);

    const HyperPredictV1PairDeployer = await ethers.getContractFactory(
      "HyperPredictV1PairDeployer",
      {
        libraries: {
          PythUtils: pythUtils.address,
        },
      }
    );

    const pairDeployer = await HyperPredictV1PairDeployer.deploy(
      contract.address
    );
    await pairDeployer.deployed();
    console.log(
      `Pair Deployer deployed to ${pairDeployer.address.toLocaleLowerCase()}`
    );

    const tx = await contract.setPairDeployer(pairDeployer.address);
    await tx.wait();
    console.log(
      `Pair deployer set to ${pairDeployer.address.toLocaleLowerCase()}`
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

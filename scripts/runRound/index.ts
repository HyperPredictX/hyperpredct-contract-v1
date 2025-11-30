import { ethers, network } from "hardhat";
import { sleep } from "../lib/sleep";
import { executeRound } from "./executeRound";
import { fetchHyperPredictV1PairContract } from "./fetchHyperPredictV1PairContract";
import { updatePriceData } from "./getUpdatePriceData";

const MAX_GAS_PRICE = 20_000_000_000n; // 20 gwei
const GENESIS_START_GAS_LIMIT = 300_000n;
const GENESIS_LOCK_GAS_LIMIT = 400_000n;
const GENESIS_START_TX_OVERRIDES = {
  gasLimit: GENESIS_START_GAS_LIMIT,
};
const GENESIS_LOCK_TX_OVERRIDES = {
  gasLimit: GENESIS_LOCK_GAS_LIMIT,
};

async function checkGasPrice() {
  const provider = ethers.provider;
  var gasPrice = await provider.getGasPrice();
  if (gasPrice.toBigInt() > MAX_GAS_PRICE) {
    // raise error to retry
    throw new Error(
      `Gas price too high: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`
    );
  } else {
    console.log(
      `Current gas price: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`
    );
  }
}

async function runOneContract(HyperPredictV1PairContract: any) {
  const label = `[${await HyperPredictV1PairContract.address}]`;
  const provider = ethers.provider;
  var gasPrice = await provider.getGasPrice();
  console.log(
    `${label} Current gas price: ${ethers.utils.formatUnits(
      gasPrice,
      "gwei"
    )} gwei`
  );
  await updatePriceData();

  while (true) {
    try {
      console.log(`\n==== runRound ${label} ====`);
      console.log(`Network: ${network.name}`);

      const operatorAddress =
        await HyperPredictV1PairContract.operatorAddress();
      const intervalSeconds =
        await HyperPredictV1PairContract.intervalSeconds?.().catch(
          () => undefined
        );

      console.log(`${label} operatorAddress: ${operatorAddress}`);
      if (intervalSeconds)
        console.log(`${label} intervalSeconds: ${intervalSeconds.toString()}s`);

      const beforeCurrentEpoch =
        await HyperPredictV1PairContract.currentEpoch?.().catch(
          () => undefined
        );

      if (beforeCurrentEpoch && beforeCurrentEpoch.gt?.(0)) {
        const paused = Boolean(await HyperPredictV1PairContract.paused());
        console.log(
          `${label} currentEpoch: ${beforeCurrentEpoch.toString()}, paused: ${paused}`
        );
        if (!paused) {
          await HyperPredictV1PairContract.pause();
        } else {
          console.log(`${label} already paused`);
        }
        await HyperPredictV1PairContract.unpause();
      }

      await checkGasPrice();

      // 1) startGenesisRound()
      console.log(`${label} Starting genesis round...`);
      await HyperPredictV1PairContract.genesisStartRound(
        GENESIS_START_TX_OVERRIDES
      );

      console.log(
        `${label} ...waiting ${intervalSeconds.toString()}s before lockGenesisRound`
      );
      await sleep(1000 * intervalSeconds.toNumber());

      await checkGasPrice();
      // 2) lockGenesisRound()
      console.log(`${label} Locking genesis round...`);
      await updatePriceData();
      await HyperPredictV1PairContract.genesisLockRound(
        GENESIS_LOCK_TX_OVERRIDES
      );

      // 3) executeRound() in a loop
      while (true) {
        console.log(
          `${label} ...waiting ${intervalSeconds.toString()}s before executeRound`
        );
        await sleep(1000 * intervalSeconds.toNumber());

        await checkGasPrice();
        await executeRound(label, HyperPredictV1PairContract);
      }
    } catch (err) {
      console.error(`\n❌ ${label} failed:`, err);
      console.log(`${label} Retrying in 10 seconds...\n`);
      await sleep(10_000);
      continue;
    }
  }
}

async function main() {
  console.log("==== runRound ====");
  console.log(`Network: ${network.name}`);

  const { HyperPredictV1PairContract } =
    await fetchHyperPredictV1PairContract();

  await runOneContract(HyperPredictV1PairContract);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

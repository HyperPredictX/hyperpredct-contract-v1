import { ethers, network } from "hardhat";
import { sleep } from "../lib/sleep";
import { executeRound } from "./executeRound";
import { fetchHyperPredictV1PairContract } from "./fetchHyperPredictV1PairContract";
import { updatePriceData } from "./getUpdatePriceData";

const GENESIS_START_GAS_LIMIT = 300_000n;
const GENESIS_LOCK_GAS_LIMIT = 400_000n;
const GENESIS_START_TX_OVERRIDES = {
  gasLimit: GENESIS_START_GAS_LIMIT,
};
const GENESIS_LOCK_TX_OVERRIDES = {
  gasLimit: GENESIS_LOCK_GAS_LIMIT,
};

async function runOneContract(HyperPredictV1PairContract: any) {
  const label = `[${await HyperPredictV1PairContract.address}]`;

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
          const pauseTx = await HyperPredictV1PairContract.pause();
          await pauseTx.wait();
        } else {
          console.log(`${label} already paused`);
        }

        const unpauseTx = await HyperPredictV1PairContract.unpause();
        await unpauseTx.wait();
      }

      // 1) startGenesisRound()
      console.log(`${label} Starting genesis round...`);
      const startTx = await HyperPredictV1PairContract.genesisStartRound(
        GENESIS_START_TX_OVERRIDES
      );
      await startTx.wait();

      console.log(
        `${label} ...waiting ${intervalSeconds.toString()}s before lockGenesisRound`
      );
      await sleep(1000 * intervalSeconds.toNumber());

      // 2) lockGenesisRound()
      console.log(`${label} Locking genesis round...`);
      await updatePriceData();
      const lockTx = await HyperPredictV1PairContract.genesisLockRound(
        GENESIS_LOCK_TX_OVERRIDES
      );
      await lockTx.wait();

      // 3) executeRound() in a loop
      while (true) {
        console.log(
          `${label} ...waiting ${intervalSeconds.toString()}s before executeRound`
        );
        await sleep(1000 * intervalSeconds.toNumber());

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

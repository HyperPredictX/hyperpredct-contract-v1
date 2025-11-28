import { updatePriceData } from "./getUpdatePriceData";
import { ethers } from "hardhat";

const EXECUTE_ROUND_GAS_LIMIT = 600_000n;
const GAS_PRICE = 20_000_000_000n; // 20 gwei
const EXECUTE_ROUND_TX_OVERRIDES = {
  gasLimit: EXECUTE_ROUND_GAS_LIMIT,
  gasPrice: GAS_PRICE,
};

export async function executeRound(
  label: string,
  HyperPredictV1PairContract: any
) {
  const currentEpoch = await HyperPredictV1PairContract.currentEpoch?.().catch(
    () => undefined
  );
  if (currentEpoch) console.log(`\ncurrentEpoch: ${currentEpoch.toString()}`);

  console.log("\n==== executeRound ====");
  // Some variants require epoch, others don't. Try no-arg first, then fallback to currentEpoch.
  let tx;
  await updatePriceData();
  try {
    // If the function with no args exists, this will work.
    tx = await HyperPredictV1PairContract.executeRound?.(
      EXECUTE_ROUND_TX_OVERRIDES
    );
  } catch (e) {
    // Fallback to executeRound(uint256)
    const currentEpoch = await HyperPredictV1PairContract.currentEpoch();
    console.log(
      `executeRound requires epoch. currentEpoch = ${currentEpoch.toString()}`
    );
    tx = await HyperPredictV1PairContract.executeRound?.(
      EXECUTE_ROUND_TX_OVERRIDES
    );
  }
  console.log(`contract: ${label}, tx: ${tx.hash}`);

  const epoch = await HyperPredictV1PairContract.currentEpoch?.().catch(
    () => undefined
  );
  if (epoch) console.log(`\ncurrentEpoch: ${epoch.toString()}`);
}

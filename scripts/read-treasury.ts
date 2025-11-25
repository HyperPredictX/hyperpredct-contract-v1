import { fetchHyperPredictV1PairContract } from "./runRound/fetchHyperPredictV1PairContract";
import { ethers } from "hardhat";

async function readTreasury() {
  const { HyperPredictV1PairContract } = await fetchHyperPredictV1PairContract(
    "admin"
  );
  const treasuryAmount = await HyperPredictV1PairContract.treasuryAmount();
  console.log(`Treasury Amount: ${ethers.utils.formatEther(treasuryAmount)}`);
}

readTreasury();

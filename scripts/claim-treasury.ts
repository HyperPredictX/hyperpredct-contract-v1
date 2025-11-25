import { ethers } from "hardhat";

export async function claimTreasury(HyperPredictV1PairContract: any) {
  const treasuryAmount = await HyperPredictV1PairContract.treasuryAmount();
  const tx = await HyperPredictV1PairContract.claimTreasury();
  console.log(`tx: ${tx.hash}`);
  await tx.wait();
  console.log(
    `Claimed treasury amount: ${ethers.utils.formatEther(treasuryAmount)}`
  );
  return treasuryAmount;
}

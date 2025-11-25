import { ethers } from "hardhat";

export async function claimTreasury(
  HyperPredictV1PairContract: any,
  signer?: any
) {
  const contract = signer
    ? HyperPredictV1PairContract.connect(signer)
    : HyperPredictV1PairContract;
  const treasuryAmount = await contract.treasuryAmount();
  const tx = await contract.claimTreasury();
  console.log(`tx: ${tx.hash}`);
  await tx.wait();
  console.log(
    `Claimed treasury amount: ${ethers.utils.formatEther(treasuryAmount)}`
  );
  return treasuryAmount;
}

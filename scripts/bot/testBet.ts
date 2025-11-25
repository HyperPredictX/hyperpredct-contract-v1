import { fetchHyperPredictV1PairContract } from "../runRound/fetchHyperPredictV1PairContract";
import { ethers } from "hardhat";
import { sleep } from "../lib/sleep";
import { claimTreasury } from "../claim-treasury";

async function bet(
  HyperPredictV1PairContract: any,
  epoch: string,
  testers: any
) {
  console.log("\n==== Bets ====");
  let index = 0;

  const round = await HyperPredictV1PairContract.rounds(epoch);
  const lockedAt = new Date(round.lockTimestamp.toNumber() * 1000);
  console.log(`Round ${epoch} locked at ${lockedAt.toISOString()}\n`);

  for (const tester of testers) {
    if (new Date() >= lockedAt) {
      console.log(`Round ${epoch} already locked, stopping bets`);
      break;
    }

    const amount = [0.01, 0.02, 0.03][Math.floor(Math.random() * 3)];
    const need = ethers.utils.parseEther(amount.toString());
    const balance = await tester.getBalance();
    if (balance.lt(need)) {
      console.log(`tester ${tester.address} has low balance, skip`);
      continue;
    }

    const c = HyperPredictV1PairContract.connect(tester);

    const place = index % 2 === 0 ? "betBull" : "betBear";
    const tx = await c[place](epoch, { value: need });
    await tx.wait();
    // 2 times
    if (Math.random() < 0.7) {
      const tx2 = await c[place](epoch, { value: need });
      await tx2.wait();
    }
    console.log(
      `tester ${tester.address} bets ${amount} ETH on epoch ${epoch} (tx: ${tx.hash})`
    );

    const beforeEpoch = Number(epoch) - 2;
    const claimable = await c.claimable(beforeEpoch, await tester.getAddress());
    if (claimable) {
      const claimTx = await c.claim([beforeEpoch]);
      console.log(
        `tester ${tester.address} claimed rewards for ${beforeEpoch} (tx: ${claimTx.hash})`
      );
    }

    await sleep(1000);
    index++;
  }
}

async function sendToken(to: string, amount: string) {
  const [admin] = await ethers.getSigners();
  const value = ethers.utils.parseEther(amount);

  const tx = await admin.sendTransaction({ to, value });
  console.log(`Sent ${amount} ETH to ${to} (tx: ${tx.hash})`);
}

async function runListener() {
  const { HyperPredictV1PairContract } =
    await fetchHyperPredictV1PairContract();
  const signers = await ethers.getSigners();
  const admin = signers[0];
  const testers = signers.slice(2, 12);
  const testerCount = testers.length;

  HyperPredictV1PairContract.on("StartRound", async (epochBn, event) => {
    const epoch = epochBn.toNumber();
    console.log("=== StartRound emitted ===");
    console.log("epoch:", epoch.toString());
    console.log("tx:", event.transactionHash);
    console.log("block:", event.blockNumber);

    if (epoch % 8 === 0) {
      HyperPredictV1PairContract.connect(admin);
      const treasuryAmount = await claimTreasury(HyperPredictV1PairContract);
      if (!treasuryAmount.eq(0)) {
        const sendAmount = treasuryAmount.div(testerCount);
        for (const tester of testers) {
          await sleep(300);
          await sendToken(tester.address, ethers.utils.formatEther(sendAmount));
        }
      }
    } else {
      await bet(HyperPredictV1PairContract, epoch, testers);
    }

    const round = await HyperPredictV1PairContract.rounds(epoch);
    console.log(`totalAmount: ${ethers.utils.formatEther(round.totalAmount)}`);
    console.log(`bullAmount : ${ethers.utils.formatEther(round.bullAmount)}`);
    console.log(`bearAmount : ${ethers.utils.formatEther(round.bearAmount)}`);
  });
}

runListener().catch(console.error);

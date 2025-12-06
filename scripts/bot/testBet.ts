import { fetchHyperPredictV1PairContract } from "../runRound/fetchHyperPredictV1PairContract";
import { ethers } from "hardhat";
import { sleep } from "../lib/sleep";
import { claimTreasury } from "../claim-treasury";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
];

async function ensureAllowance(
  tokenContract: any,
  owner: any,
  spender: string,
  requiredAmount: any
) {
  const allowance = await tokenContract.allowance(owner.address, spender);
  if (allowance.gte(requiredAmount)) {
    return;
  }

  const tx = await tokenContract
    .connect(owner)
    .approve(spender, ethers.constants.MaxUint256);
  await tx.wait();
}

async function bet(
  HyperPredictV1PairContract: any,
  betToken: any,
  tokenDecimals: number,
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

    const amount = ["1", "2", "3"][Math.floor(Math.random() * 3)];
    const need = ethers.utils.parseUnits(amount, tokenDecimals);
    const balance = await betToken.balanceOf(tester.address);
    if (balance.lt(need)) {
      console.log(`tester ${tester.address} has low balance, skip`);
      continue;
    }

    await ensureAllowance(
      betToken,
      tester,
      HyperPredictV1PairContract.address,
      need.mul(2)
    );

    const c = HyperPredictV1PairContract.connect(tester);

    const place = index % 2 === 0 ? "betBull" : "betBear";
    const tx = await c[place](epoch, need);
    await tx.wait();
    if (Math.random() < 0.7) {
      const tx2 = await c[place](epoch, need);
      await tx2.wait();
    }
    console.log(
      `tester ${tester.address} bets ${amount} tokens on epoch ${epoch} (tx: ${tx.hash})`
    );

    const beforeEpoch = Number(epoch) - 2;
    const claimable = await c.claimable(beforeEpoch, tester.address);
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

async function sendToken(
  betToken: any,
  sender: any,
  to: string,
  amount: any,
  tokenDecimals: number
) {
  const tx = await betToken.connect(sender).transfer(to, amount);
  console.log(
    `Sent ${ethers.utils.formatUnits(amount, tokenDecimals)} tokens to ${to} (tx: ${tx.hash})`
  );
}

async function runListener() {
  const { HyperPredictV1PairContract } =
    await fetchHyperPredictV1PairContract();
  const betTokenAddress = await HyperPredictV1PairContract.betToken();
  const betToken = new ethers.Contract(
    betTokenAddress,
    ERC20_ABI,
    ethers.provider
  );
  const tokenDecimals = await betToken.decimals();
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
      const treasuryAmount = await claimTreasury(
        HyperPredictV1PairContract,
        admin
      );
      if (!treasuryAmount.eq(0)) {
        const sendAmount = treasuryAmount.div(testerCount);
        for (const tester of testers) {
          await sleep(300);
          await sendToken(
            betToken,
            admin,
            tester.address,
            sendAmount,
            tokenDecimals
          );
        }
      }
    } else {
      await bet(
        HyperPredictV1PairContract,
        betToken,
        tokenDecimals,
        epoch,
        testers
      );
    }

    const round = await HyperPredictV1PairContract.rounds(epoch);
    console.log(
      `totalAmount: ${ethers.utils.formatUnits(round.totalAmount, tokenDecimals)}`
    );
    console.log(
      `bullAmount : ${ethers.utils.formatUnits(round.bullAmount, tokenDecimals)}`
    );
    console.log(
      `bearAmount : ${ethers.utils.formatUnits(round.bearAmount, tokenDecimals)}`
    );
  });
}

runListener().catch(console.error);

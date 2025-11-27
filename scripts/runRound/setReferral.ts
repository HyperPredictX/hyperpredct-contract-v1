import { ethers } from "hardhat";
import { fetchReferralRegistry } from "../lib/fetchReferralRegistry";
import { network } from "hardhat";
import { sleep } from "../lib/sleep";

async function setReferral() {
  console.log("==== setReferral ====");
  console.log(`Network: ${network.name}`);

  const { ReferralRegistry } = await fetchReferralRegistry();
  console.log(`ReferralRegistry Address: ${ReferralRegistry.address}`);

  const testers = (await ethers.getSigners()).slice(2, 22);

  let index = 0;
  for (const tester of testers) {
    const referrer = testers[index + 1];

    const hasReferrer = await ReferralRegistry.connect(tester).referrerOf(
      tester.address
    );
    if (hasReferrer && hasReferrer !== ethers.constants.AddressZero) {
      console.log(
        `Tester ${tester.address} already has referrer ${hasReferrer}, skipping`
      );
      index++;
      continue;
    }

    const tx = await ReferralRegistry.connect(tester).setReferrer(
      referrer.address
    );
    await tx.wait();
    console.log(
      `Tester ${tester.address} set referrer to ${referrer.address} (tx: ${tx.hash})`
    );
    index++;
    await sleep(1000);
  }
}

setReferral()
  .then(() => {
    console.log("Done");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

import { artifacts, contract, ethers } from "hardhat";
import { assert } from "chai";
import {
  BN,
  constants,
  expectEvent,
  expectRevert,
  time,
  ether,
  balance,
} from "@openzeppelin/test-helpers";

const HyperPredictV1Factory = artifacts.require("HyperPredictV1Factory");
const HyperPredictV1Pair = artifacts.require("HyperPredictV1Pair");
const HyperPredictV1PairDeployer = artifacts.require(
  "HyperPredictV1PairDeployer"
);
const PythUtils = artifacts.require("PythUtils");
const ReferralRegistry = artifacts.require("ReferralRegistry");
const priceId =
  "0x4279e31cc369bbcc2faf022b382b080e32a8e689ff20fbc530d2a603eb6cd98b";

const GAS_PRICE = 8000000000; // hardhat default
const BLOCK_COUNT_MULTPLIER = 5;
const INITIAL_PRICE = 10000000000; // $100, 8 decimal places
const INTERVAL_SECONDS = 20 * BLOCK_COUNT_MULTPLIER; // 20 seconds * multiplier
const MIN_BET_AMOUNT = ethers.utils.parseEther("1");
const UPDATE_ALLOWANCE = 30 * BLOCK_COUNT_MULTPLIER; // 30s * multiplier
const INITIAL_REWARD_RATE = 0.99; // 99%
const INITIAL_REFERRAL_RATE = 0.0025; // 0.25%
const INITIAL_TREASURY_RATE = 0.005; // 0.5%

const INITIAL_REWARD_RATE_WITH_REFERRAL =
  INITIAL_REWARD_RATE + INITIAL_REFERRAL_RATE;

// Enum: 0 = Bull, 1 = Bear
const Position = {
  Bull: 0,
  Bear: 1,
};

const calcGasCost = (gasUsed: number) => new BN(GAS_PRICE * gasUsed);

before(async () => {
  const pythUtils = await PythUtils.new();
  HyperPredictV1Pair.link(pythUtils);
  HyperPredictV1PairDeployer.link(pythUtils);
});

const assertBNArray = (arr1: any[], arr2: any | any[]) => {
  assert.equal(arr1.length, arr2.length);
  arr1.forEach((n1, index) => {
    assert.equal(n1.toString(), new BN(arr2[index]).toString());
  });
};

contract(
  "HyperPredictV1Pair",
  ([
    operator,
    admin,
    owner,
    bullUser1,
    bullUser2,
    bullUser3,
    bearUser1,
    bearUser2,
    bearUser3,
  ]) => {
    let currentEpoch: any;
    let oracle: any;
    let hyperPredictionV1Pair: any;
    let priceUpdateData: any;
    let factory: any;
    let referralRegistry: any;

    async function nextEpoch() {
      await time.increaseTo(
        (await time.latest()).toNumber() + INTERVAL_SECONDS
      ); // Elapse 20 seconds
    }

    async function expectedClaimAmount(
      epoch: number,
      user: string,
      betAmountWei: BN
    ) {
      const round = await hyperPredictionV1Pair.rounds(epoch);
      const rewardAmount = new BN(round.rewardAmount.toString());
      const rewardBase = new BN(round.rewardBaseCalAmount.toString());
      if (rewardBase.isZero()) return new BN(0);

      let payout = betAmountWei.mul(rewardAmount).div(rewardBase);
      const referralPool = new BN(
        (await hyperPredictionV1Pair.referralAmountPerRound(epoch)).toString()
      );
      if (!referralPool.isZero()) {
        const referrer = await referralRegistry.referrerOf(user);
        if (referrer !== constants.ZERO_ADDRESS) {
          const referralAllocated = referralPool
            .mul(betAmountWei)
            .div(rewardBase);
          payout = payout.add(referralAllocated.div(new BN(2)));
        }
      }

      return payout;
    }

    async function expectedReferrerBonus(epoch: number, user: string) {
      const referrer = await referralRegistry.referrerOf(user);
      if (referrer === constants.ZERO_ADDRESS) {
        return new BN(0);
      }

      const round = await hyperPredictionV1Pair.rounds(epoch);
      const rewardBase = new BN(round.rewardBaseCalAmount.toString());
      if (rewardBase.isZero()) {
        return new BN(0);
      }

      const referralPool = new BN(
        (await hyperPredictionV1Pair.referralAmountPerRound(epoch)).toString()
      );
      if (referralPool.isZero()) {
        return new BN(0);
      }

      const betAmount = new BN(
        (await hyperPredictionV1Pair.ledger(epoch, user)).amount.toString()
      );
      if (betAmount.isZero()) {
        return new BN(0);
      }

      return referralPool.mul(betAmount).div(rewardBase).div(new BN(2));
    }

    beforeEach(async () => {
      const MockPyth = await ethers.getContractFactory(
        "contracts/test/MockPyth.sol:MockPyth"
      );
      oracle = await MockPyth.deploy(UPDATE_ALLOWANCE, 0);

      referralRegistry = await ReferralRegistry.new({ from: owner });

      factory = await HyperPredictV1Factory.new(
        referralRegistry.address,
        admin, // _adminAddress
        MIN_BET_AMOUNT.toString(), // uint256
        UPDATE_ALLOWANCE, // uint256
        String(INITIAL_REFERRAL_RATE * 10000),
        String(INITIAL_TREASURY_RATE * 10000),
        { from: owner } // deploy tx from
      );

      const pairDeployer = await HyperPredictV1PairDeployer.new(
        factory.address,
        { from: owner }
      );
      await factory.setPairDeployer(pairDeployer.address, { from: owner });

      // admin として createPair 呼ぶ
      await factory.createPair(
        oracle.address,
        priceId,
        operator,
        INTERVAL_SECONDS,
        { from: admin }
      );

      referralRegistry = await ReferralRegistry.at(
        await factory.referralRegistryAddress()
      );

      const pairAddress = await factory.allPairs(0);

      hyperPredictionV1Pair = await HyperPredictV1Pair.at(pairAddress);
      await updateOraclePrice(INITIAL_PRICE);
    });

    async function updateOraclePrice(newPrice: number, timestamp?: number) {
      if (!timestamp) {
        timestamp = (await time.latest()).toNumber();
      }
      const update = await oracle.createPriceFeedUpdateData(
        priceId,
        newPrice,
        0,
        -8,
        INITIAL_PRICE,
        0,
        timestamp,
        0
      );
      let priceUpdateData = [update];
      await oracle.updatePriceFeeds(priceUpdateData, { value: 0 });
      return priceUpdateData;
    }

    it("Initialize", async () => {
      assert.equal(await balance.current(hyperPredictionV1Pair.address), 0);
      assert.equal(await hyperPredictionV1Pair.currentEpoch(), 0);
      assert.equal(
        await hyperPredictionV1Pair.intervalSeconds(),
        INTERVAL_SECONDS
      );
      assert.equal(await factory.adminAddress(), admin);
      assert.equal(await hyperPredictionV1Pair.treasuryAmount(), 0);
      assert.equal(await factory.minBetAmount(), MIN_BET_AMOUNT.toString());
      assert.equal(await factory.bufferSeconds(), UPDATE_ALLOWANCE);
      assert.equal(await hyperPredictionV1Pair.genesisStartOnce(), false);
      assert.equal(await hyperPredictionV1Pair.genesisLockOnce(), false);
      assert.equal(await hyperPredictionV1Pair.paused(), false);
    });

    it("Should start genesis rounds (round 1, round 2, round 3)", async () => {
      // Manual block calculation
      let currentTimestamp = (await time.latest()).toNumber();

      // Epoch 0
      assert.equal((await time.latest()).toNumber(), currentTimestamp);
      assert.equal(await hyperPredictionV1Pair.currentEpoch(), 0);

      // Epoch 1: Start genesis round 1
      let tx = await hyperPredictionV1Pair.genesisStartRound();
      currentTimestamp++;
      expectEvent(tx, "StartRound", { epoch: new BN(1) });
      assert.equal(await hyperPredictionV1Pair.currentEpoch(), 1);

      // Start round 1
      assert.equal(await hyperPredictionV1Pair.genesisStartOnce(), true);
      assert.equal(await hyperPredictionV1Pair.genesisLockOnce(), false);
      assert.equal(
        (await hyperPredictionV1Pair.rounds(1)).startTimestamp,
        currentTimestamp
      );
      assert.equal(
        (await hyperPredictionV1Pair.rounds(1)).lockTimestamp,
        currentTimestamp + INTERVAL_SECONDS
      );
      assert.equal(
        (await hyperPredictionV1Pair.rounds(1)).closeTimestamp,
        currentTimestamp + INTERVAL_SECONDS * 2
      );
      assert.equal((await hyperPredictionV1Pair.rounds(1)).epoch, 1);
      assert.equal((await hyperPredictionV1Pair.rounds(1)).totalAmount, 0);

      // Elapse 20 blocks
      currentTimestamp += INTERVAL_SECONDS;
      await time.increaseTo(currentTimestamp);

      // Epoch 2: Lock genesis round 1 and starts round 2
      await updateOraclePrice(INITIAL_PRICE, currentTimestamp); // To update Oracle roundId
      tx = await hyperPredictionV1Pair.genesisLockRound();

      expectEvent(tx, "LockRound", {
        epoch: new BN(1),
        roundId: new BN(currentTimestamp),
        price: new BN(INITIAL_PRICE),
      });
      currentTimestamp = (await time.latest()).toNumber();

      expectEvent(tx, "StartRound", { epoch: new BN(2) });
      assert.equal(await hyperPredictionV1Pair.currentEpoch(), 2);

      // Lock round 1
      assert.equal(await hyperPredictionV1Pair.genesisStartOnce(), true);
      assert.equal(await hyperPredictionV1Pair.genesisLockOnce(), true);
      assert.equal(
        (await hyperPredictionV1Pair.rounds(1)).lockPrice,
        INITIAL_PRICE
      );

      // Start round 2
      assert.equal(
        (await hyperPredictionV1Pair.rounds(2)).startTimestamp,
        currentTimestamp
      );
      assert.equal(
        (await hyperPredictionV1Pair.rounds(2)).lockTimestamp,
        currentTimestamp + INTERVAL_SECONDS
      );
      assert.equal(
        (await hyperPredictionV1Pair.rounds(2)).closeTimestamp,
        currentTimestamp + 2 * INTERVAL_SECONDS
      );
      assert.equal((await hyperPredictionV1Pair.rounds(2)).epoch, 2);
      assert.equal((await hyperPredictionV1Pair.rounds(2)).totalAmount, 0);

      // Elapse 20 blocks
      currentTimestamp += INTERVAL_SECONDS;
      await time.increaseTo(currentTimestamp);

      // Epoch 3: End genesis round 1, locks round 2, starts round 3
      await updateOraclePrice(INITIAL_PRICE, currentTimestamp); // To update Oracle roundId
      tx = await hyperPredictionV1Pair.executeRound();

      expectEvent(tx, "EndRound", {
        epoch: new BN(1),
        roundId: new BN(currentTimestamp),
        price: new BN(INITIAL_PRICE),
      });

      expectEvent(tx, "LockRound", {
        epoch: new BN(2),
        roundId: new BN(currentTimestamp),
        price: new BN(INITIAL_PRICE),
      });
      currentTimestamp += 2; // Oracle update and execute round

      expectEvent(tx, "StartRound", { epoch: new BN(3) });
      assert.equal(await hyperPredictionV1Pair.currentEpoch(), 3);

      // End round 1
      assert.equal(
        (await hyperPredictionV1Pair.rounds(1)).closePrice,
        INITIAL_PRICE
      );

      // Lock round 2
      assert.equal(
        (await hyperPredictionV1Pair.rounds(2)).lockPrice,
        INITIAL_PRICE
      );
    });

    it("Should not start rounds before genesis start and lock round has triggered", async () => {
      await expectRevert(
        hyperPredictionV1Pair.genesisLockRound(),
        "Can only run after genesisStartRound is triggered"
      );
      await expectRevert(
        hyperPredictionV1Pair.executeRound(),
        "Can only run after genesisStartRound and genesisLockRound is triggered"
      );

      await hyperPredictionV1Pair.genesisStartRound();
      await expectRevert(
        hyperPredictionV1Pair.executeRound(),
        "Can only run after genesisStartRound and genesisLockRound is triggered"
      );

      await nextEpoch();
      await hyperPredictionV1Pair.genesisLockRound(); // Success

      await nextEpoch();
      await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
      await hyperPredictionV1Pair.executeRound(); // Success
    });

    it("Should not lock round before lockTimestamp and end round before closeTimestamp", async () => {
      await hyperPredictionV1Pair.genesisStartRound();
      await expectRevert(
        hyperPredictionV1Pair.genesisLockRound(),
        "Can only lock round after lockTimestamp"
      );
      await nextEpoch();
      await hyperPredictionV1Pair.genesisLockRound();
      await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
      await expectRevert(
        hyperPredictionV1Pair.executeRound(),
        "Can only lock round after lockTimestamp"
      );

      await nextEpoch();
      await hyperPredictionV1Pair.executeRound(); // Success
    });

    it("Should record oracle price", async () => {
      // Epoch 1
      await hyperPredictionV1Pair.genesisStartRound();
      assert.equal((await hyperPredictionV1Pair.rounds(1)).lockPrice, 0);
      assert.equal((await hyperPredictionV1Pair.rounds(1)).closePrice, 0);

      // Epoch 2
      await nextEpoch();
      const price120 = 12000000000; // $120
      await updateOraclePrice(price120);
      await hyperPredictionV1Pair.genesisLockRound(); // For round 1
      assert.equal((await hyperPredictionV1Pair.rounds(1)).lockPrice, price120);
      assert.equal((await hyperPredictionV1Pair.rounds(1)).closePrice, 0);
      assert.equal((await hyperPredictionV1Pair.rounds(2)).lockPrice, 0);
      assert.equal((await hyperPredictionV1Pair.rounds(2)).closePrice, 0);

      // Epoch 3
      await nextEpoch();
      const price130 = 13000000000; // $130
      await updateOraclePrice(price130);
      await hyperPredictionV1Pair.executeRound();
      assert.equal((await hyperPredictionV1Pair.rounds(1)).lockPrice, price120);
      assert.equal(
        (await hyperPredictionV1Pair.rounds(1)).closePrice,
        price130
      );
      assert.equal((await hyperPredictionV1Pair.rounds(2)).lockPrice, price130);
      assert.equal((await hyperPredictionV1Pair.rounds(2)).closePrice, 0);
      assert.equal((await hyperPredictionV1Pair.rounds(3)).lockPrice, 0);
      assert.equal((await hyperPredictionV1Pair.rounds(3)).closePrice, 0);

      // Epoch 4
      await nextEpoch();
      const price140 = 14000000000; // $140
      await updateOraclePrice(price140);
      await hyperPredictionV1Pair.executeRound();
      assert.equal((await hyperPredictionV1Pair.rounds(1)).lockPrice, price120);
      assert.equal(
        (await hyperPredictionV1Pair.rounds(1)).closePrice,
        price130
      );
      assert.equal((await hyperPredictionV1Pair.rounds(2)).lockPrice, price130);
      assert.equal(
        (await hyperPredictionV1Pair.rounds(2)).closePrice,
        price140
      );
      assert.equal((await hyperPredictionV1Pair.rounds(3)).lockPrice, price140);
      assert.equal((await hyperPredictionV1Pair.rounds(3)).closePrice, 0);
      assert.equal((await hyperPredictionV1Pair.rounds(4)).lockPrice, 0);
      assert.equal((await hyperPredictionV1Pair.rounds(4)).closePrice, 0);
    });

    it("Should record data and user bets", async () => {
      // Epoch 1
      await hyperPredictionV1Pair.genesisStartRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1.1"),
      }); // 1.1 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("1.2"),
      }); // 1.2 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("1.4"),
      }); // 1.4 ETH

      assert.equal(
        (await balance.current(hyperPredictionV1Pair.address)).toString(),
        ether("3.7").toString()
      ); // 3.7 ETH
      assert.equal(
        (await hyperPredictionV1Pair.rounds(1)).totalAmount,
        ether("3.7").toString()
      ); // 3.7 ETH
      assert.equal(
        (await hyperPredictionV1Pair.rounds(1)).bullAmount,
        ether("2.3").toString()
      ); // 2.3 ETH
      assert.equal(
        (await hyperPredictionV1Pair.rounds(1)).bearAmount,
        ether("1.4").toString()
      ); // 1.4 ETH
      assert.equal(
        (await hyperPredictionV1Pair.ledger(1, bullUser1)).position,
        Position.Bull
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(1, bullUser1)).amount,
        ether("1.1").toString()
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(1, bullUser2)).position,
        Position.Bull
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(1, bullUser2)).amount,
        ether("1.2").toString()
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(1, bearUser1)).position,
        Position.Bear
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(1, bearUser1)).amount,
        ether("1.4").toString()
      );
      assertBNArray(
        (await hyperPredictionV1Pair.getUserRounds(bullUser1, 0, 1))[0],
        [1]
      );
      assertBNArray(
        (await hyperPredictionV1Pair.getUserRounds(bullUser2, 0, 1))[0],
        [1]
      );
      assertBNArray(
        (await hyperPredictionV1Pair.getUserRounds(bearUser1, 0, 1))[0],
        [1]
      );
      assert.equal(
        await hyperPredictionV1Pair.getUserRoundsLength(bullUser1),
        1
      );

      // Epoch 2
      await nextEpoch();
      await hyperPredictionV1Pair.genesisLockRound(); // For round 1
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("2.1"),
      }); // 2.1 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("2.2"),
      }); // 2.2 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("2.4"),
      }); // 2.4 ETH

      assert.equal(
        (await balance.current(hyperPredictionV1Pair.address)).toString(),
        ether("10.4").toString()
      ); // 10.4 ETH (3.7+6.7)
      assert.equal(
        (await hyperPredictionV1Pair.rounds(2)).totalAmount,
        ether("6.7").toString()
      ); // 6.7 ETH
      assert.equal(
        (await hyperPredictionV1Pair.rounds(2)).bullAmount,
        ether("4.3").toString()
      ); // 4.3 ETH
      assert.equal(
        (await hyperPredictionV1Pair.rounds(2)).bearAmount,
        ether("2.4").toString()
      ); // 2.4 ETH
      assert.equal(
        (await hyperPredictionV1Pair.ledger(2, bullUser1)).position,
        Position.Bull
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(2, bullUser1)).amount,
        ether("2.1").toString()
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(2, bullUser2)).position,
        Position.Bull
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(2, bullUser2)).amount,
        ether("2.2").toString()
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(2, bearUser1)).position,
        Position.Bear
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(2, bearUser1)).amount,
        ether("2.4").toString()
      );
      assertBNArray(
        (await hyperPredictionV1Pair.getUserRounds(bullUser1, 0, 2))[0],
        [1, 2]
      );
      assertBNArray(
        (await hyperPredictionV1Pair.getUserRounds(bullUser2, 0, 2))[0],
        [1, 2]
      );
      assertBNArray(
        (await hyperPredictionV1Pair.getUserRounds(bearUser1, 0, 2))[0],
        [1, 2]
      );
      assert.equal(
        await hyperPredictionV1Pair.getUserRoundsLength(bullUser1),
        2
      );

      // Epoch 3
      await nextEpoch();
      await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
      await hyperPredictionV1Pair.executeRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("3.1").toString(),
      }); // 3.1 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("3.2").toString(),
      }); // 3.2 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("3.4").toString(),
      }); // 4.3 ETH

      assert.equal(
        (await balance.current(hyperPredictionV1Pair.address)).toString(),
        ether("20.1").toString()
      ); // 20.1 ETH (3.7+6.7+9.7)
      assert.equal(
        (await hyperPredictionV1Pair.rounds(3)).totalAmount,
        ether("9.7").toString()
      ); // 9.7 ETH
      assert.equal(
        (await hyperPredictionV1Pair.rounds(3)).bullAmount,
        ether("6.3").toString()
      ); // 6.3 ETH
      assert.equal(
        (await hyperPredictionV1Pair.rounds(3)).bearAmount,
        ether("3.4").toString()
      ); // 3.4 ETH
      assert.equal(
        (await hyperPredictionV1Pair.ledger(3, bullUser1)).position,
        Position.Bull
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(3, bullUser1)).amount,
        ether("3.1").toString()
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(3, bullUser2)).position,
        Position.Bull
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(3, bullUser2)).amount,
        ether("3.2").toString()
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(3, bearUser1)).position,
        Position.Bear
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(3, bearUser1)).amount,
        ether("3.4").toString()
      );
      assertBNArray(
        (await hyperPredictionV1Pair.getUserRounds(bullUser1, 0, 3))[0],
        [1, 2, 3]
      );
      assertBNArray(
        (await hyperPredictionV1Pair.getUserRounds(bullUser2, 0, 3))[0],
        [1, 2, 3]
      );
      assertBNArray(
        (await hyperPredictionV1Pair.getUserRounds(bearUser1, 0, 3))[0],
        [1, 2, 3]
      );
      assert.equal(
        await hyperPredictionV1Pair.getUserRoundsLength(bullUser1),
        3
      );

      // Epoch 4
      await nextEpoch();
      await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
      await hyperPredictionV1Pair.executeRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("4.1").toString(),
      }); // 4.1 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("4.2").toString(),
      }); // 4.2 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("4.4").toString(),
      }); // 4.4 ETH

      assert.equal(
        (await balance.current(hyperPredictionV1Pair.address)).toString(),
        ether("32.8").toString()
      ); // 32.8 ETH (3.7+6.7+9.7+12.7)
      assert.equal(
        (await hyperPredictionV1Pair.rounds(4)).totalAmount,
        ether("12.7").toString()
      ); // 12.7 ETH
      assert.equal(
        (await hyperPredictionV1Pair.rounds(4)).bullAmount,
        ether("8.3").toString()
      ); // 8.3 ETH
      assert.equal(
        (await hyperPredictionV1Pair.rounds(4)).bearAmount,
        ether("4.4").toString()
      ); // 4.4 ETH
      assert.equal(
        (await hyperPredictionV1Pair.ledger(4, bullUser1)).position,
        Position.Bull
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(4, bullUser1)).amount,
        ether("4.1").toString()
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(4, bullUser2)).position,
        Position.Bull
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(4, bullUser2)).amount,
        ether("4.2").toString()
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(4, bearUser1)).position,
        Position.Bear
      );
      assert.equal(
        (await hyperPredictionV1Pair.ledger(4, bearUser1)).amount,
        ether("4.4").toString()
      );
      assertBNArray(
        (await hyperPredictionV1Pair.getUserRounds(bullUser1, 0, 4))[0],
        [1, 2, 3, 4]
      );
      assertBNArray(
        (await hyperPredictionV1Pair.getUserRounds(bullUser2, 0, 4))[0],
        [1, 2, 3, 4]
      );
      assertBNArray(
        (await hyperPredictionV1Pair.getUserRounds(bearUser1, 0, 4))[0],
        [1, 2, 3, 4]
      );
      assert.equal(
        await hyperPredictionV1Pair.getUserRoundsLength(bullUser1),
        4
      );
    });

    it("Should only allow adding bets to the same position", async () => {
      // Epoch 1
      await hyperPredictionV1Pair.genesisStartRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      }); // Success
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("2"),
      }); // Additional bet on same side should succeed
      assert.equal(
        (await hyperPredictionV1Pair.ledger(currentEpoch, bullUser1)).amount,
        ether("3").toString()
      );
      assert.equal(
        (await hyperPredictionV1Pair.getUserRoundsLength(bullUser1)).toString(),
        "1"
      );
      await expectRevert(
        hyperPredictionV1Pair.betBear(currentEpoch, {
          from: bullUser1,
          value: ether("1"),
        }),
        "Can only add to existing position"
      );

      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("1"),
      }); // Success
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("1"),
      }); // Additional bet on same side should succeed
      assert.equal(
        (await hyperPredictionV1Pair.ledger(currentEpoch, bearUser1)).amount,
        ether("2").toString()
      );
      assert.equal(
        (await hyperPredictionV1Pair.getUserRoundsLength(bearUser1)).toString(),
        "1"
      );
      await expectRevert(
        hyperPredictionV1Pair.betBull(currentEpoch, {
          from: bearUser1,
          value: ether("1"),
        }),
        "Can only add to existing position"
      );

      // Epoch 2
      await nextEpoch();
      await hyperPredictionV1Pair.genesisLockRound(); // For round 1
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      }); // Able to choose new position in new round
      assert.equal(
        (await hyperPredictionV1Pair.getUserRoundsLength(bullUser1)).toString(),
        "2"
      );
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bullUser1,
        value: ether("2"),
      }); // Additional bet still allowed
      assert.equal(
        (await hyperPredictionV1Pair.ledger(currentEpoch, bullUser1)).amount,
        ether("3").toString()
      );
      await expectRevert(
        hyperPredictionV1Pair.betBull(currentEpoch, {
          from: bullUser1,
          value: ether("1"),
        }),
        "Can only add to existing position"
      );

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bearUser1,
        value: ether("1"),
      }); // Different user can still pick bull
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bearUser1,
        value: ether("2"),
      });
      assert.equal(
        (await hyperPredictionV1Pair.ledger(currentEpoch, bearUser1)).amount,
        ether("3").toString()
      );
      await expectRevert(
        hyperPredictionV1Pair.betBear(currentEpoch, {
          from: bearUser1,
          value: ether("1"),
        }),
        "Can only add to existing position"
      );
    });

    it("Should not allow bets lesser than minimum bet amount", async () => {
      // Epoch 1
      await hyperPredictionV1Pair.genesisStartRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await expectRevert(
        hyperPredictionV1Pair.betBull(currentEpoch, {
          from: bullUser1,
          value: ether("0.5"),
        }),
        "Bet amount must be greater than minBetAmount"
      ); // 0.5 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      }); // Success

      // Epoch 2
      await nextEpoch();
      await hyperPredictionV1Pair.genesisLockRound(); // For round 1
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await expectRevert(
        hyperPredictionV1Pair.betBull(currentEpoch, {
          from: bullUser1,
          value: ether("0.5"),
        }),
        "Bet amount must be greater than minBetAmount"
      ); // 0.5 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      }); // Success

      // Epoch 3
      await nextEpoch();
      await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
      await hyperPredictionV1Pair.executeRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await expectRevert(
        hyperPredictionV1Pair.betBull(currentEpoch, {
          from: bullUser1,
          value: ether("0.5"),
        }),
        "Bet amount must be greater than minBetAmount"
      ); // 0.5 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      }); // Success
    });

    it("Should record rewards", async () => {
      // Epoch 1
      const price110 = 11000000000; // $110
      await updateOraclePrice(price110);
      await hyperPredictionV1Pair.genesisStartRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1.1"),
      }); // 1.1 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("1.2"),
      }); // 1.2 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("1.4"),
      }); // 1.4 ETH

      assert.equal(
        (await hyperPredictionV1Pair.rounds(1)).rewardBaseCalAmount,
        0
      );
      assert.equal((await hyperPredictionV1Pair.rounds(1)).rewardAmount, 0);
      assert.equal(await hyperPredictionV1Pair.treasuryAmount(), 0);
      assert.equal(
        (await balance.current(hyperPredictionV1Pair.address)).toString(),
        ether("3.7").toString()
      );

      // Epoch 2
      await nextEpoch();
      const price120 = 12000000000; // $120
      await updateOraclePrice(price120);
      await hyperPredictionV1Pair.genesisLockRound(); // For round 1
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("2.1"),
      }); // 2.1 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("2.2"),
      }); // 2.2 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("2.4"),
      }); // 2.4 ETH

      assert.equal(
        (await hyperPredictionV1Pair.rounds(1)).rewardBaseCalAmount,
        0
      );
      assert.equal((await hyperPredictionV1Pair.rounds(1)).rewardAmount, 0);
      assert.equal(
        (await hyperPredictionV1Pair.rounds(2)).rewardBaseCalAmount,
        0
      );
      assert.equal((await hyperPredictionV1Pair.rounds(2)).rewardAmount, 0);
      assert.equal(await hyperPredictionV1Pair.treasuryAmount(), 0);
      assert.equal(
        (await balance.current(hyperPredictionV1Pair.address)).toString(),
        ether("3.7").add(ether("6.7")).toString()
      );

      // Epoch 3, Round 1 is Bull (130 > 120)
      await nextEpoch();
      const price130 = 13000000000; // $130
      await updateOraclePrice(price130);
      await hyperPredictionV1Pair.executeRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("3.1").toString(),
      }); // 3.1 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("3.2").toString(),
      }); // 3.2 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("3.4").toString(),
      }); // 3.4 ETH

      assert.equal(
        (await hyperPredictionV1Pair.rounds(1)).rewardBaseCalAmount,
        ether("2.3").toString()
      ); // 2.3 ETH, Bull total
      assert.equal(
        (await hyperPredictionV1Pair.rounds(1)).rewardAmount,
        ether("3.7") * INITIAL_REWARD_RATE
      ); // 3.33 ETH, Total * rewardRate
      assert.equal(
        (await hyperPredictionV1Pair.rounds(2)).rewardBaseCalAmount,
        0
      );
      assert.equal((await hyperPredictionV1Pair.rounds(2)).rewardAmount, 0);
      assert.equal(
        await hyperPredictionV1Pair.treasuryAmount(),
        ether("3.7") * INITIAL_TREASURY_RATE
      ); // 3.7 ETH, Total * treasuryRate
      assert.equal(
        (await balance.current(hyperPredictionV1Pair.address)).toString(),
        ether("3.7").add(ether("6.7")).add(ether("9.7")).toString()
      );

      // Epoch 4, Round 2 is Bear (100 < 130)
      await nextEpoch();
      const price100 = 10000000000; // $100
      await updateOraclePrice(price100);
      await hyperPredictionV1Pair.executeRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("4.1").toString(),
      }); // 4.1 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("4.2").toString(),
      }); // 4.2 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("4.4").toString(),
      }); // 4.4 ETH

      assert.equal(
        (await hyperPredictionV1Pair.rounds(1)).rewardBaseCalAmount,
        ether("2.3").toString()
      ); // 2.3 ETH, Bull total
      assert.equal(
        (await hyperPredictionV1Pair.rounds(1)).rewardAmount,
        ether("3.7") * INITIAL_REWARD_RATE
      ); // 3.33 ETH, Total * rewardRate
      assert.equal(
        (await hyperPredictionV1Pair.rounds(2)).rewardBaseCalAmount,
        ether("2.4").toString()
      ); // 2.4 ETH, Bear total
      assert.equal(
        (await hyperPredictionV1Pair.rounds(2)).rewardAmount,
        ether("6.7") * INITIAL_REWARD_RATE
      ); // 6.7 ETH, Total * rewardRate
      assert.equal(
        await hyperPredictionV1Pair.treasuryAmount(),
        ether("3.7").add(ether("6.7")) * INITIAL_TREASURY_RATE
      ); // 10.4, Accumulative treasury
      assert.equal(
        (await balance.current(hyperPredictionV1Pair.address)).toString(),
        ether("3.7")
          .add(ether("6.7"))
          .add(ether("9.7"))
          .add(ether("12.7"))
          .toString()
      );
    });

    it("Should not lock round before lockTimestamp", async () => {
      await hyperPredictionV1Pair.genesisStartRound();
      await nextEpoch();
      await hyperPredictionV1Pair.genesisLockRound();
      await nextEpoch();
      await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
      await hyperPredictionV1Pair.executeRound();

      await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
      await expectRevert(
        hyperPredictionV1Pair.executeRound(),
        "Can only lock round after lockTimestamp"
      );
      await nextEpoch();
      await hyperPredictionV1Pair.executeRound(); // Success
    });

    it("Should claim rewards with referral", async () => {
      referralRegistry.setReferrer(bullUser2, { from: bullUser1 });

      const bullUser1Tracker = await balance.tracker(bullUser1);
      const bullUser2Tracker = await balance.tracker(bullUser2);
      const bearUser1Tracker = await balance.tracker(bearUser1);

      // Epoch 1
      const price110 = 11000000000; // $110
      await updateOraclePrice(price110);
      await hyperPredictionV1Pair.genesisStartRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      }); // 1 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("2"),
      }); // 2 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("4"),
      }); // 4 ETH

      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser2), false);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bearUser1), false);
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bullUser1 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bullUser2 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bearUser1 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bullUser1 }),
        "Round has not started"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bullUser2 }),
        "Round has not started"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bearUser1 }),
        "Round has not started"
      );

      // Epoch 2
      await nextEpoch();
      const price120 = 12000000000; // $120
      await updateOraclePrice(price120);
      await hyperPredictionV1Pair.genesisLockRound(); // For round 1
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("21"),
      }); // 21 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("22"),
      }); // 22 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("24"),
      }); // 24 ETH

      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser2), false);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bearUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bullUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bullUser2), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bearUser1), false);
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bullUser1 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bullUser2 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bearUser1 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bullUser1 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bullUser2 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bearUser1 }),
        "Round has not ended"
      );

      // Epoch 3, Round 1 is Bull (130 > 120)
      await nextEpoch();
      const price130 = 13000000000; // $130
      await updateOraclePrice(price130);
      await hyperPredictionV1Pair.executeRound();

      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser1), true);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser2), true);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bearUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bullUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bullUser2), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bearUser1), false);

      // Claim for Round 1: Total rewards = 3.7, Bull = 2.3, Bear = 1.4
      await bullUser1Tracker.get();
      await bullUser2Tracker.get();
      const bull1BetInfo = await hyperPredictionV1Pair.ledger(1, bullUser1);
      const bull2BetInfo = await hyperPredictionV1Pair.ledger(1, bullUser2);
      const expectedBull1 = await expectedClaimAmount(
        1,
        bullUser1,
        new BN(bull1BetInfo.amount.toString())
      );
      const expectedBull2 = await expectedClaimAmount(
        1,
        bullUser2,
        new BN(bull2BetInfo.amount.toString())
      );

      let tx = await hyperPredictionV1Pair.claim([1], { from: bullUser1 }); // Success
      let gasUsed = tx.receipt.gasUsed;

      expectEvent(tx, "Claim", {
        sender: bullUser1,
        epoch: new BN("1"),
        amount: expectedBull1,
      });
      assert.equal(
        (await bullUser1Tracker.delta()).toString(),
        expectedBull1.sub(calcGasCost(gasUsed)).toString()
      );
      await bullUser2Tracker.get();

      tx = await hyperPredictionV1Pair.claim([1], { from: bullUser2 }); // Success
      gasUsed = tx.receipt.gasUsed;

      expectEvent(tx, "Claim", {
        sender: bullUser2,
        epoch: new BN("1"),
        amount: expectedBull2,
      });
      assert.equal(
        (await bullUser2Tracker.delta()).toString(),
        expectedBull2.sub(calcGasCost(gasUsed)).toString()
      );

      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bearUser1 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bullUser1 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bullUser2 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bearUser1 }),
        "Round has not ended"
      );

      // Epoch 4, Round 2 is Bear (100 < 130)
      await nextEpoch();
      const price100 = 10000000000; // $100
      await updateOraclePrice(price100);
      await hyperPredictionV1Pair.executeRound();

      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser1), false); // User has claimed
      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser2), false); // User has claimed
      assert.equal(await hyperPredictionV1Pair.claimable(1, bearUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bullUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bullUser2), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bearUser1), true);

      // Claim for Round 2: Total rewards = 67, Bull = 43, Bear = 24
      await bearUser1Tracker.get();

      tx = await hyperPredictionV1Pair.claim([2], { from: bearUser1 }); // Success
      gasUsed = tx.receipt.gasUsed;
      expectEvent(tx, "Claim", {
        sender: bearUser1,
        epoch: new BN("2"),
        amount: ether("66.33"),
      }); // 66.33 = 24/24 * (67*0.99)
      assert.equal(
        (await bearUser1Tracker.delta()).toString(),
        ether("66.33").sub(calcGasCost(gasUsed)).toString()
      );

      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bullUser1 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bullUser2 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bearUser1 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bullUser1 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bullUser2 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bearUser1 }),
        "Not eligible for claim"
      );
    });

    it("Should apply referral bonus with 0.3% treasury and 0.1% referral fee", async () => {
      await factory.setTreasuryFee("30", { from: admin });
      await factory.setReferralFee("10", { from: admin });

      const winner = bullUser1;
      const loser = bearUser1;
      const referrer = bullUser3;
      await referralRegistry.setReferrer(referrer, { from: winner });

      const price110 = 11000000000; // $110
      const price120 = 12000000000; // $120
      const price130 = 13000000000; // $130

      await updateOraclePrice(price110);
      await hyperPredictionV1Pair.genesisStartRound();
      const firstEpoch = (
        await hyperPredictionV1Pair.currentEpoch()
      ).toNumber();

      const betAmount = ether("100");

      await hyperPredictionV1Pair.betBull(firstEpoch, {
        from: winner,
        value: betAmount,
      });
      await hyperPredictionV1Pair.betBear(firstEpoch, {
        from: loser,
        value: betAmount,
      });

      await nextEpoch();
      await updateOraclePrice(price120);
      await hyperPredictionV1Pair.genesisLockRound();

      await nextEpoch();
      await updateOraclePrice(price130);
      await hyperPredictionV1Pair.executeRound();

      assert.equal(
        await hyperPredictionV1Pair.claimable(firstEpoch, winner),
        true
      );

      const basisPoints = new BN("10000");
      const treasuryBps = new BN(
        (await hyperPredictionV1Pair.treasuryFee()).toString()
      );
      const referralBps = new BN(
        (await hyperPredictionV1Pair.totalReferralFee()).toString()
      );
      const totalBet = betAmount.mul(new BN("2"));
      const expectedTreasury = totalBet.mul(treasuryBps).div(basisPoints);
      const expectedReferralPool = totalBet.mul(referralBps).div(basisPoints);
      const expectedRewardAmount = totalBet
        .sub(expectedTreasury)
        .sub(expectedReferralPool);
      const expectedReferrerBonus = expectedReferralPool.div(new BN("2"));
      const expectedWinnerReferral = expectedReferralPool.sub(
        expectedReferrerBonus
      );
      const expectedWinnerClaim = expectedRewardAmount.add(
        expectedWinnerReferral
      );

      // console.log("Expected Winner Claim:", expectedWinnerClaim.toString());

      const roundInfo = await hyperPredictionV1Pair.rounds(firstEpoch);
      assert.equal(
        roundInfo.rewardAmount.toString(),
        expectedRewardAmount.toString()
      );
      assert.equal(
        roundInfo.rewardBaseCalAmount.toString(),
        betAmount.toString()
      );
      assert.equal(
        (
          await hyperPredictionV1Pair.referralAmountPerRound(firstEpoch)
        ).toString(),
        expectedReferralPool.toString()
      );
      // console.log(
      //   "ReferralPool:",
      //   (
      //     await hyperPredictionV1Pair.referralAmountPerRound(firstEpoch)
      //   ).toString()
      // );
      assert.equal(
        (await hyperPredictionV1Pair.treasuryAmount()).toString(),
        expectedTreasury.toString()
      );
      // console.log(
      //   "Treasury Amount:",
      //   (await hyperPredictionV1Pair.treasuryAmount()).toString()
      // );

      const winnerTracker = await balance.tracker(winner);
      const referrerTracker = await balance.tracker(referrer);
      await winnerTracker.get();
      await referrerTracker.get();

      // console.log(
      //   "referrerTracker before claim:",
      //   (await referrerTracker.delta()).toString()
      // );

      const tx = await hyperPredictionV1Pair.claim([firstEpoch], {
        from: winner,
      });
      const rawGasUsed = tx.receipt.gasUsed;
      const gasUsed =
        typeof rawGasUsed === "number" ? rawGasUsed : rawGasUsed.toNumber();

      expectEvent(tx, "Claim", {
        sender: winner,
        epoch: new BN(firstEpoch.toString()),
        amount: expectedWinnerClaim,
      });
      expectEvent(tx, "ReferralPaid", {
        user: winner,
        referrer,
        referralRoundCount: new BN("1"),
        referrerBonus: expectedReferrerBonus,
      });

      assert.equal(
        (await winnerTracker.delta()).toString(),
        expectedWinnerClaim.sub(calcGasCost(gasUsed)).toString()
      );
      const referrerDelta = await referrerTracker.delta();
      // console.log("referrer delta", referrerDelta.toString());
      assert.equal(referrerDelta.toString(), expectedReferrerBonus.toString());
      assert.equal(
        (await hyperPredictionV1Pair.referralAmount()).toString(),
        expectedReferralPool.toString()
      );
      // console.log(
      //   "referralAmount:",
      //   (await hyperPredictionV1Pair.referralAmount()).toString()
      // );
    });

    it("Should aggregate referral payout across multiple epochs in one claim", async () => {
      await referralRegistry.setReferrer(bullUser2, { from: bullUser1 });

      const bullUser1Tracker = await balance.tracker(bullUser1);
      const bullUser2Tracker = await balance.tracker(bullUser2);

      // Round 1 setup
      const price110 = 11000000000; // $110
      await updateOraclePrice(price110);
      await hyperPredictionV1Pair.genesisStartRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      });
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("2"),
      });

      // Lock round 1 and start round 2
      await nextEpoch();
      const price120 = 12000000000; // $120
      await updateOraclePrice(price120);
      await hyperPredictionV1Pair.genesisLockRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("3"),
      });
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("4"),
      });

      // Resolve round 1 (bull) and lock round 2
      await nextEpoch();
      const price150 = 15000000000; // $150
      await updateOraclePrice(price150);
      await hyperPredictionV1Pair.executeRound();

      // Resolve round 2 (bull)
      await nextEpoch();
      const price200 = 20000000000; // $200
      await updateOraclePrice(price200);
      await hyperPredictionV1Pair.executeRound();

      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser1), true);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bullUser1), true);

      const bullRound1Info = await hyperPredictionV1Pair.ledger(1, bullUser1);
      const bullRound2Info = await hyperPredictionV1Pair.ledger(2, bullUser1);

      const expectedRound1 = await expectedClaimAmount(
        1,
        bullUser1,
        new BN(bullRound1Info.amount.toString())
      );
      const expectedRound2 = await expectedClaimAmount(
        2,
        bullUser1,
        new BN(bullRound2Info.amount.toString())
      );
      const expectedTotal = expectedRound1.add(expectedRound2);

      const referralBonus1 = await expectedReferrerBonus(1, bullUser1);
      const referralBonus2 = await expectedReferrerBonus(2, bullUser1);
      const totalReferralBonus = referralBonus1.add(referralBonus2);

      await bullUser1Tracker.get();
      await bullUser2Tracker.get();

      const tx = await hyperPredictionV1Pair.claim([1, 2], {
        from: bullUser1,
      });
      const gasUsed = tx.receipt.gasUsed;

      expectEvent(tx, "Claim", {
        sender: bullUser1,
        epoch: new BN("1"),
        amount: expectedRound1,
      });
      expectEvent(tx, "Claim", {
        sender: bullUser1,
        epoch: new BN("2"),
        amount: expectedRound2,
      });

      const referralPaidEvents = tx.logs.filter(
        (log: any) => log.event === "ReferralPaid"
      );
      assert.equal(referralPaidEvents.length, 1);
      const referralLog = referralPaidEvents[0];
      assert.equal(referralLog.args.user, bullUser1);
      assert.equal(referralLog.args.referrer, bullUser2);
      assert.equal(referralLog.args.referralRoundCount.toString(), "2");
      assert.equal(
        referralLog.args.referrerBonus.toString(),
        totalReferralBonus.toString()
      );

      assert.equal(
        (await bullUser1Tracker.delta()).toString(),
        expectedTotal.sub(calcGasCost(gasUsed)).toString()
      );
      assert.equal(
        (await bullUser2Tracker.delta()).toString(),
        totalReferralBonus.toString()
      );
    });

    it("Should claim rewards", async () => {
      const bullUser1Tracker = await balance.tracker(bullUser1);
      const bullUser2Tracker = await balance.tracker(bullUser2);
      const bearUser1Tracker = await balance.tracker(bearUser1);

      // Epoch 1
      const price110 = 11000000000; // $110
      await updateOraclePrice(price110);
      await hyperPredictionV1Pair.genesisStartRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      }); // 1 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("2"),
      }); // 2 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("4"),
      }); // 4 ETH

      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser2), false);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bearUser1), false);
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bullUser1 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bullUser2 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bearUser1 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bullUser1 }),
        "Round has not started"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bullUser2 }),
        "Round has not started"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bearUser1 }),
        "Round has not started"
      );

      // Epoch 2
      await nextEpoch();
      const price120 = 12000000000; // $120
      await updateOraclePrice(price120);
      await hyperPredictionV1Pair.genesisLockRound(); // For round 1
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("21"),
      }); // 21 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("22"),
      }); // 22 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("24"),
      }); // 24 ETH

      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser2), false);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bearUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bullUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bullUser2), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bearUser1), false);
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bullUser1 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bullUser2 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bearUser1 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bullUser1 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bullUser2 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bearUser1 }),
        "Round has not ended"
      );

      // Epoch 3, Round 1 is Bull (130 > 120)
      await nextEpoch();
      const price130 = 13000000000; // $130
      await updateOraclePrice(price130);
      await hyperPredictionV1Pair.executeRound();

      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser1), true);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser2), true);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bearUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bullUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bullUser2), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bearUser1), false);

      // Claim for Round 1: Total rewards = 3.7, Bull = 2.3, Bear = 1.4
      await bullUser1Tracker.get();
      await bullUser2Tracker.get();

      let tx = await hyperPredictionV1Pair.claim([1], { from: bullUser1 }); // Success
      let gasUsed = tx.receipt.gasUsed;

      expectEvent(tx, "Claim", {
        sender: bullUser1,
        epoch: new BN("1"),
        amount: ether("2.31"),
      }); // 2.1 = 1/3 * (7*0.9)
      assert.equal(
        (await bullUser1Tracker.delta()).toString(),
        ether("2.31").sub(calcGasCost(gasUsed)).toString()
      );

      tx = await hyperPredictionV1Pair.claim([1], { from: bullUser2 }); // Success
      gasUsed = tx.receipt.gasUsed;

      expectEvent(tx, "Claim", {
        sender: bullUser2,
        epoch: new BN("1"),
        amount: ether("4.62"),
      }); // 4.62 = 2/3 * (7*0.99)
      assert.equal(
        (await bullUser2Tracker.delta()).toString(),
        ether("4.62").sub(calcGasCost(gasUsed)).toString()
      );

      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bearUser1 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bullUser1 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bullUser2 }),
        "Round has not ended"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bearUser1 }),
        "Round has not ended"
      );

      // Epoch 4, Round 2 is Bear (100 < 130)
      await nextEpoch();
      const price100 = 10000000000; // $100
      await updateOraclePrice(price100);
      await hyperPredictionV1Pair.executeRound();

      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser1), false); // User has claimed
      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser2), false); // User has claimed
      assert.equal(await hyperPredictionV1Pair.claimable(1, bearUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bullUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bullUser2), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bearUser1), true);

      // Claim for Round 2: Total rewards = 67, Bull = 43, Bear = 24
      await bearUser1Tracker.get();

      tx = await hyperPredictionV1Pair.claim([2], { from: bearUser1 }); // Success
      gasUsed = tx.receipt.gasUsed;
      expectEvent(tx, "Claim", {
        sender: bearUser1,
        epoch: new BN("2"),
        amount: ether("66.33"),
      }); // 66.33 = 24/24 * (67*0.99)
      assert.equal(
        (await bearUser1Tracker.delta()).toString(),
        ether("66.33").sub(calcGasCost(gasUsed)).toString()
      );

      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bullUser1 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bullUser2 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bearUser1 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bullUser1 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bullUser2 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bearUser1 }),
        "Not eligible for claim"
      );
    });

    it("Should multi claim rewards", async () => {
      // Epoch 1
      const price110 = 11000000000; // $110
      await updateOraclePrice(price110);
      await hyperPredictionV1Pair.genesisStartRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      }); // 1 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("2"),
      }); // 2 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("4"),
      }); // 4 ETH

      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser2), false);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bearUser1), false);

      // Epoch 2
      await nextEpoch();
      const price120 = 12000000000; // $120
      await updateOraclePrice(price120);
      await hyperPredictionV1Pair.genesisLockRound(); // For round 1
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("21"),
      }); // 21 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("22"),
      }); // 22 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("24"),
      }); // 24 ETH

      // Epoch 3, Round 1 is Bull (130 > 120)
      await nextEpoch();
      const price130 = 13000000000; // $130
      await updateOraclePrice(price130);
      await hyperPredictionV1Pair.executeRound();

      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser1), true);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser2), true);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bearUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bullUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bullUser2), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bearUser1), false);

      // Epoch 4, Round 2 is Bull (140 > 130)
      await nextEpoch();
      const price140 = 14000000000; // $140
      await updateOraclePrice(price140);
      await hyperPredictionV1Pair.executeRound();

      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser1), true);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser2), true);
      assert.equal(await hyperPredictionV1Pair.claimable(1, bearUser1), false);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bullUser1), true);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bullUser2), true);
      assert.equal(await hyperPredictionV1Pair.claimable(2, bearUser1), false);

      await expectRevert(
        hyperPredictionV1Pair.claim([2, 2], { from: bullUser1 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1, 1], { from: bullUser1 }),
        "Not eligible for claim"
      );

      const bullUser1Tracker = await balance.tracker(bullUser1);
      const bullUser2Tracker = await balance.tracker(bullUser2);

      let tx = await hyperPredictionV1Pair.claim([1, 2], { from: bullUser1 }); // Success
      let gasUsed = tx.receipt.gasUsed;

      // 2.1 = 1/3 * (7*0.9) + // 29.4488372093 = 21 / 43 * (67 * 0.99) = 29.448837209302325581
      expectEvent(tx, "Claim", {
        sender: bullUser1,
        epoch: new BN("1"),
        amount: ether("2.31"),
      });

      // Manual event handling for second event with same name from the same contract
      assert.equal(tx.logs[1].args.sender, bullUser1);
      assert.equal(tx.logs[1].args.epoch, "2");
      assert.equal(
        tx.logs[1].args.amount.toString(),
        ether("32.393720930232558139").toString()
      );

      // assert.equal(
      //   (await bullUser1Tracker.delta()).toString(),
      //   ether("34.702404906232558139").sub(calcGasCost(gasUsed)).toString()
      // );

      tx = await hyperPredictionV1Pair.claim([1, 2], { from: bullUser2 }); // Success
      gasUsed = tx.receipt.gasUsed;

      // 4.2 = 2/3 * (7*0.99) + // 30.851162790697674418 = 22 / 43 * (67 * 0.99) = 35.051162790697674418 ETH
      expectEvent(tx, "Claim", {
        sender: bullUser2,
        epoch: new BN("1"),
        amount: ether("4.62"),
      });

      // Manual event handling for second event with same name from the same contract
      assert.equal(tx.logs[1].args.sender, bullUser2);
      assert.equal(tx.logs[1].args.epoch, "2");
      assert.equal(
        tx.logs[1].args.amount.toString(),
        ether("33.936279069767441860").toString()
      );

      // assert.equal(
      //   (await bullUser2Tracker.delta()).toString(),
      //   ether("38.554963045767441860").sub(calcGasCost(gasUsed)).toString()
      // );

      await expectRevert(
        hyperPredictionV1Pair.claim([1, 2], { from: bullUser1 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2, 1], { from: bullUser1 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1, 2], { from: bullUser2 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2, 1], { from: bullUser2 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bearUser1 }),
        "Not eligible for claim"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([2], { from: bearUser1 }),
        "Not eligible for claim"
      );
    });

    it("Should allow factory batch claims across pairs", async () => {
      await factory.createPair(
        oracle.address,
        priceId,
        operator,
        INTERVAL_SECONDS,
        { from: admin }
      );
      const secondPairAddress = await factory.allPairs(1);
      const secondPair = await HyperPredictV1Pair.at(secondPairAddress);

      // Setup round for first pair
      const firstStart = 15000000000; // $150
      await updateOraclePrice(firstStart);
      await hyperPredictionV1Pair.genesisStartRound();
      let epoch = await hyperPredictionV1Pair.currentEpoch();
      await hyperPredictionV1Pair.betBull(epoch, {
        from: bullUser1,
        value: ether("2"),
      });
      await hyperPredictionV1Pair.betBear(epoch, {
        from: bearUser1,
        value: ether("3"),
      });

      await nextEpoch();
      const firstLock = 16000000000; // $160
      await updateOraclePrice(firstLock);
      await hyperPredictionV1Pair.genesisLockRound();

      await nextEpoch();
      const firstClose = 17000000000; // $170
      await updateOraclePrice(firstClose);
      await hyperPredictionV1Pair.executeRound();
      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser1), true);

      // Setup round for second pair
      const secondStart = 21000000000; // $210
      await updateOraclePrice(secondStart);
      await secondPair.genesisStartRound();
      epoch = await secondPair.currentEpoch();
      await secondPair.betBull(epoch, {
        from: bullUser1,
        value: ether("4"),
      });
      await secondPair.betBear(epoch, {
        from: bearUser2,
        value: ether("5"),
      });

      await nextEpoch();
      const secondLock = 22000000000; // $220
      await updateOraclePrice(secondLock);
      await secondPair.genesisLockRound();

      await nextEpoch();
      const secondClose = 23000000000; // $230
      await updateOraclePrice(secondClose);
      await secondPair.executeRound();
      assert.equal(await secondPair.claimable(1, bullUser1), true);

      const tx = await factory.claim(
        [
          { pair: hyperPredictionV1Pair.address, epochs: [1] },
          { pair: secondPair.address, epochs: [1] },
        ],
        { from: bullUser1 }
      );

      await expectEvent.inTransaction(tx.tx, hyperPredictionV1Pair, "Claim", {
        sender: bullUser1,
        epoch: new BN("1"),
      });

      await expectEvent.inTransaction(tx.tx, secondPair, "Claim", {
        sender: bullUser1,
        epoch: new BN("1"),
      });

      assert.equal(await hyperPredictionV1Pair.claimable(1, bullUser1), false);
      assert.equal(await secondPair.claimable(1, bullUser1), false);
    });

    it("Should revert factory claim for unknown pairs", async () => {
      const foreignPair = await HyperPredictV1Pair.new(
        owner,
        oracle.address,
        priceId,
        operator,
        INTERVAL_SECONDS,
        { from: owner }
      );

      await expectRevert(
        factory.claim([{ pair: foreignPair.address, epochs: [1] }], {
          from: bullUser1,
        }),
        "Unknown pair"
      );
    });

    it("Should record draw and refund", async () => {
      // Epoch 1
      const price110 = 11000000000; // $110
      await updateOraclePrice(price110);
      await hyperPredictionV1Pair.genesisStartRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      }); // 1 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("2"),
      }); // 2 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("4"),
      }); // 4 ETH

      // Epoch 2
      await nextEpoch();
      await updateOraclePrice(price110);
      await hyperPredictionV1Pair.genesisLockRound(); // For round 1

      // Epoch 3, Round 1 is Same (110 == 110), House wins
      await nextEpoch();
      await updateOraclePrice(price110);
      await hyperPredictionV1Pair.executeRound();

      let tx = await hyperPredictionV1Pair.claim([1], { from: bullUser1 }); // Success
      expectEvent(tx, "Claim", {
        sender: bullUser1,
        epoch: new BN("1"),
        amount: ether("1"),
      });

      tx = await hyperPredictionV1Pair.claim([1], { from: bullUser2 }); // Success
      expectEvent(tx, "Claim", {
        sender: bullUser2,
        epoch: new BN("1"),
        amount: ether("2"),
      });

      assert.equal(
        (await hyperPredictionV1Pair.treasuryAmount()).toString(),
        ether("0").toString()
      );
    });

    it("Should claim treasury rewards", async () => {
      const adminTracker = await balance.tracker(admin);
      let predictionCurrentETH = ether("0");
      assert.equal(await balance.current(hyperPredictionV1Pair.address), 0);

      // Epoch 1
      const price110 = 11000000000; // $110
      await updateOraclePrice(price110);
      await hyperPredictionV1Pair.genesisStartRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      }); // 1 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("2"),
      }); // 2 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("4"),
      }); // 4 ETH
      predictionCurrentETH = predictionCurrentETH.add(ether("7"));

      assert.equal(await hyperPredictionV1Pair.treasuryAmount(), 0);
      assert.equal(
        (await balance.current(hyperPredictionV1Pair.address)).toString(),
        predictionCurrentETH.toString()
      );

      // Epoch 2
      await nextEpoch();
      const price120 = 12000000000; // $120
      await updateOraclePrice(price120);
      await hyperPredictionV1Pair.genesisLockRound(); // For round 1
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("21"),
      }); // 21 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("22"),
      }); // 22 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("24"),
      }); // 24 ETH
      predictionCurrentETH = predictionCurrentETH.add(ether("67"));

      assert.equal(await hyperPredictionV1Pair.treasuryAmount(), 0);
      assert.equal(
        (await balance.current(hyperPredictionV1Pair.address)).toString(),
        predictionCurrentETH.toString()
      );

      // Epoch 3, Round 1 is Bull (130 > 120)
      await nextEpoch();
      const price130 = 13000000000; // $130
      await updateOraclePrice(price130);
      await hyperPredictionV1Pair.executeRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("31"),
      }); // 31 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("32"),
      }); // 32 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("34"),
      }); // 34 ETH
      predictionCurrentETH = predictionCurrentETH.add(ether("97"));

      // Admin claim for Round 1
      await adminTracker.get();
      assert.equal(
        (await balance.current(hyperPredictionV1Pair.address)).toString(),
        predictionCurrentETH.toString()
      );
      assert.equal(
        (await hyperPredictionV1Pair.treasuryAmount()).toString(),
        ether("0.035").toString()
      ); // 0.035 = 7 * 0.05
      let tx = await hyperPredictionV1Pair.claimTreasury({ from: admin }); // Success
      let gasUsed = tx.receipt.gasUsed;
      expectEvent(tx, "TreasuryClaim", { amount: ether("0.035") });
      assert.equal(
        (await adminTracker.delta()).toString(),
        ether("0.035").sub(calcGasCost(gasUsed)).toString()
      );
      assert.equal(await hyperPredictionV1Pair.treasuryAmount(), 0); // Empty
      predictionCurrentETH = predictionCurrentETH.sub(ether("0.035"));
      assert.equal(
        (await balance.current(hyperPredictionV1Pair.address)).toString(),
        predictionCurrentETH.toString()
      );

      // Epoch 4
      await nextEpoch();
      const price140 = 14000000000; // $140
      await updateOraclePrice(price140); // Prevent house from winning
      await hyperPredictionV1Pair.executeRound();
      assert.equal(
        (await hyperPredictionV1Pair.treasuryAmount()).toString(),
        ether("0.335").toString()
      ); // 0.335 = (21+22+24) * 0.005

      // Epoch 5
      await nextEpoch();
      const price150 = 15000000000; // $150
      await updateOraclePrice(price150); // Prevent house from winning
      await hyperPredictionV1Pair.executeRound();

      // Admin claim for Round 1 and 2
      await adminTracker.get();
      assert.equal(
        (await hyperPredictionV1Pair.treasuryAmount()).toString(),
        ether("0.335").add(ether("0.485")).toString()
      ); // 0.485 = (31+32+34) * 0.005
      tx = await hyperPredictionV1Pair.claimTreasury({ from: admin }); // Success
      gasUsed = tx.receipt.gasUsed;
      expectEvent(tx, "TreasuryClaim", { amount: ether("0.82") }); // 0.82 = 0.335 + 0.485
      assert.equal(
        (await adminTracker.delta()).toString(),
        ether("0.82").sub(calcGasCost(gasUsed)).toString()
      );
      assert.equal(await hyperPredictionV1Pair.treasuryAmount(), 0); // Empty
      predictionCurrentETH = predictionCurrentETH.sub(ether("0.82"));
      assert.equal(
        (await balance.current(hyperPredictionV1Pair.address)).toString(),
        predictionCurrentETH.toString()
      );
    });

    it("Admin/Owner function work as expected", async () => {
      await hyperPredictionV1Pair.pause({ from: admin });

      let tx = await factory.setMinBetAmount("50", {
        from: admin,
      });
      expectEvent(tx, "NewMinBetAmount", { minBetAmount: "50" });
      await expectRevert(
        factory.setMinBetAmount("0", { from: admin }),
        "Must be superior to 0"
      );

      tx = await hyperPredictionV1Pair.setOperator(admin, { from: admin });
      expectEvent(tx, "NewOperatorAddress", { operator: admin });
      await expectRevert(
        hyperPredictionV1Pair.setOperator(constants.ZERO_ADDRESS, {
          from: admin,
        }),
        "Cannot be zero address"
      );

      tx = await factory.setTreasuryFee("300", { from: admin });
      expectEvent(tx, "NewTreasuryFee", { treasuryFee: "300" });

      await expectRevert(
        factory.setTreasuryFee("3000", { from: admin }),
        "Treasury fee too high"
      );

      tx = await factory.setAdmin(owner, { from: owner });
      expectEvent(tx, "NewAdminAddress", { admin: owner });
      await expectRevert(
        factory.setAdmin(constants.ZERO_ADDRESS, { from: owner }),
        "Cannot be zero address"
      );
    });

    it("Should reject operator functions when not operator", async () => {
      await expectRevert(
        hyperPredictionV1Pair.genesisLockRound({ from: admin }),
        "Not operator"
      );
      await expectRevert(
        hyperPredictionV1Pair.genesisStartRound({ from: admin }),
        "Not operator"
      );
      await expectRevert(
        hyperPredictionV1Pair.executeRound({ from: admin }),
        "Not operator"
      );
    });

    it("Should reject admin/owner functions when not admin/owner", async () => {
      await expectRevert(
        hyperPredictionV1Pair.claimTreasury({ from: bullUser1 }),
        "Not admin"
      );
      await expectRevert(
        hyperPredictionV1Pair.pause({ from: bullUser1 }),
        "Not operator/admin"
      );
      await hyperPredictionV1Pair.pause({ from: admin });
      await expectRevert(
        hyperPredictionV1Pair.unpause({ from: bullUser1 }),
        "Not operator/admin"
      );
      await expectRevert(
        factory.setMinBetAmount("0", { from: bullUser1 }),
        "Not admin"
      );
      await expectRevert(
        hyperPredictionV1Pair.setOperator(bearUser1, { from: bullUser1 }),
        "Not admin"
      );
      await expectRevert(
        factory.setTreasuryFee("100", { from: bullUser1 }),
        "Not admin"
      );
      await expectRevert(
        hyperPredictionV1Pair.unpause({ from: bullUser1 }),
        "Not operator/admin"
      );
      await hyperPredictionV1Pair.unpause({ from: admin });
      await expectRevert(
        factory.setAdmin(admin, { from: admin }),
        "Ownable: caller is not the owner"
      );
      await expectRevert(
        factory.setAdmin(bullUser1, { from: bullUser1 }),
        "Ownable: caller is not the owner"
      );
    });

    it("Should reject admin/owner functions when not paused", async () => {
      await expectRevert(
        hyperPredictionV1Pair.unpause({ from: admin }),
        "Pausable: not paused"
      );
    });

    it("Should refund rewards", async () => {
      const bullUser1Tracker = await balance.tracker(bullUser1);
      const bullUser2Tracker = await balance.tracker(bullUser2);
      const bearUser1Tracker = await balance.tracker(bearUser1);

      // Epoch 1
      const price110 = 11000000000; // $110
      await updateOraclePrice(price110);
      await hyperPredictionV1Pair.genesisStartRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      }); // 1 ETH
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("2"),
      }); // 2 ETH
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("4"),
      }); // 4 ETH

      assert.equal(await hyperPredictionV1Pair.refundable(1, bullUser1), false);
      assert.equal(await hyperPredictionV1Pair.refundable(1, bullUser2), false);
      assert.equal(await hyperPredictionV1Pair.refundable(1, bearUser1), false);
      assert.equal(await hyperPredictionV1Pair.treasuryAmount(), 0);
      assert.equal(
        (await balance.current(hyperPredictionV1Pair.address)).toString(),
        ether("7").toString()
      );

      // Epoch 2
      await nextEpoch();
      await hyperPredictionV1Pair.genesisLockRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      assert.equal(await hyperPredictionV1Pair.refundable(1, bullUser1), false);
      assert.equal(await hyperPredictionV1Pair.refundable(1, bullUser2), false);
      assert.equal(await hyperPredictionV1Pair.refundable(1, bearUser1), false);

      await factory.setBufferSeconds("10", { from: admin });
      const bufferSeconds = new BN(
        (await hyperPredictionV1Pair.bufferSeconds()).toString()
      );
      const roundInfo = await hyperPredictionV1Pair.rounds(1);
      const refundTime = new BN(roundInfo.closeTimestamp.toString())
        .add(bufferSeconds)
        .add(new BN(1));
      await time.increaseTo(refundTime.toNumber());
      await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
      await expectRevert(
        hyperPredictionV1Pair.executeRound(),
        "Can only lock round within bufferSeconds"
      );

      // Refund for Round 1
      await bullUser1Tracker.get();
      await bullUser2Tracker.get();
      await bearUser1Tracker.get();

      assert.equal(await hyperPredictionV1Pair.refundable(1, bullUser1), true);
      assert.equal(await hyperPredictionV1Pair.refundable(1, bullUser2), true);
      assert.equal(await hyperPredictionV1Pair.refundable(1, bearUser1), true);

      let tx = await hyperPredictionV1Pair.claim([1], { from: bullUser1 }); // Success
      let gasUsed = tx.receipt.gasUsed;
      expectEvent(tx, "Claim", {
        sender: bullUser1,
        epoch: new BN("1"),
        amount: ether("1"),
      }); // 1, 100% of bet amount
      assert.equal(
        (await bullUser1Tracker.delta()).toString(),
        ether("1").sub(calcGasCost(gasUsed)).toString()
      );

      tx = await hyperPredictionV1Pair.claim([1], { from: bullUser2 }); // Success
      gasUsed = tx.receipt.gasUsed;
      expectEvent(tx, "Claim", {
        sender: bullUser2,
        epoch: new BN(1),
        amount: ether("2"),
      }); // 2, 100% of bet amount
      assert.equal(
        (await bullUser2Tracker.delta()).toString(),
        ether("2").sub(calcGasCost(gasUsed)).toString()
      );

      tx = await hyperPredictionV1Pair.claim([1], { from: bearUser1 }); // Success
      gasUsed = tx.receipt.gasUsed;
      expectEvent(tx, "Claim", {
        sender: bearUser1,
        epoch: new BN(1),
        amount: ether("4"),
      }); // 4, 100% of bet amount
      assert.equal(
        (await bearUser1Tracker.delta()).toString(),
        ether("4").sub(calcGasCost(gasUsed)).toString()
      );

      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bullUser1 }),
        "Not eligible for refund"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bullUser2 }),
        "Not eligible for refund"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bearUser1 }),
        "Not eligible for refund"
      );

      // Treasury amount should be empty
      assert.equal(await hyperPredictionV1Pair.treasuryAmount(), 0);
      assert.equal(await balance.current(hyperPredictionV1Pair.address), 0);
    });

    it("Should refund single sided bull round after oracle call", async () => {
      const price120 = 12000000000; // $120
      await updateOraclePrice(price120);
      await hyperPredictionV1Pair.genesisStartRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      });
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("2"),
      });

      await nextEpoch();
      const price130 = 13000000000; // $130
      await updateOraclePrice(price130);
      await hyperPredictionV1Pair.genesisLockRound();

      await nextEpoch();
      const price140 = 14000000000; // $140
      await updateOraclePrice(price140);
      await hyperPredictionV1Pair.executeRound();

      await time.increaseTo((await time.latest()).toNumber() + 1);
      assert.equal(await hyperPredictionV1Pair.refundable(1, bullUser1), true);
      assert.equal(await hyperPredictionV1Pair.refundable(1, bullUser2), true);

      let tx = await hyperPredictionV1Pair.claim([1], { from: bullUser1 });
      expectEvent(tx, "Claim", {
        sender: bullUser1,
        epoch: new BN("1"),
        amount: ether("1"),
      });

      tx = await hyperPredictionV1Pair.claim([1], { from: bullUser2 });
      expectEvent(tx, "Claim", {
        sender: bullUser2,
        epoch: new BN("1"),
        amount: ether("2"),
      });

      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bullUser1 }),
        "Not eligible for refund"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bullUser2 }),
        "Not eligible for refund"
      );
      assert.equal(await balance.current(hyperPredictionV1Pair.address), 0);
    });

    it("Should refund single sided bear round after oracle call", async () => {
      const price200 = 20000000000; // $200
      await updateOraclePrice(price200);
      await hyperPredictionV1Pair.genesisStartRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("1"),
      });
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser2,
        value: ether("2"),
      });

      await nextEpoch();
      const price190 = 19000000000; // $190
      await updateOraclePrice(price190);
      await hyperPredictionV1Pair.genesisLockRound();

      await nextEpoch();
      const price180 = 18000000000; // $180
      await updateOraclePrice(price180);
      await hyperPredictionV1Pair.executeRound();

      await time.increaseTo((await time.latest()).toNumber() + 1);
      assert.equal(await hyperPredictionV1Pair.refundable(1, bearUser1), true);
      assert.equal(await hyperPredictionV1Pair.refundable(1, bearUser2), true);

      let tx = await hyperPredictionV1Pair.claim([1], { from: bearUser1 });
      expectEvent(tx, "Claim", {
        sender: bearUser1,
        epoch: new BN("1"),
        amount: ether("1"),
      });

      tx = await hyperPredictionV1Pair.claim([1], { from: bearUser2 });
      expectEvent(tx, "Claim", {
        sender: bearUser2,
        epoch: new BN("1"),
        amount: ether("2"),
      });

      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bearUser1 }),
        "Not eligible for refund"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bearUser2 }),
        "Not eligible for refund"
      );
      assert.equal(await balance.current(hyperPredictionV1Pair.address), 0);
    });

    it("Rejections for bet bulls/bears work as expected", async () => {
      // Epoch 0
      await expectRevert(
        hyperPredictionV1Pair.betBull("0", {
          from: bullUser1,
          value: ether("1"),
        }),
        "Round not bettable"
      );
      await expectRevert(
        hyperPredictionV1Pair.betBear("0", {
          from: bullUser1,
          value: ether("1"),
        }),
        "Round not bettable"
      );
      await expectRevert(
        hyperPredictionV1Pair.betBull("1", {
          from: bullUser1,
          value: ether("1"),
        }),
        "Bet is too early/late"
      );
      await expectRevert(
        hyperPredictionV1Pair.betBear("1", {
          from: bullUser1,
          value: ether("1"),
        }),
        "Bet is too early/late"
      );

      // Epoch 1
      const price110 = 11000000000; // $110
      await updateOraclePrice(price110);
      await hyperPredictionV1Pair.genesisStartRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();
      await expectRevert(
        hyperPredictionV1Pair.betBull("2", {
          from: bullUser1,
          value: ether("1"),
        }),
        "Bet is too early/late"
      );
      await expectRevert(
        hyperPredictionV1Pair.betBear("2", {
          from: bullUser1,
          value: ether("1"),
        }),
        "Bet is too early/late"
      );

      // Bets must be higher (or equal) than minBetAmount
      await expectRevert(
        hyperPredictionV1Pair.betBear("1", {
          from: bullUser1,
          value: ether("0.999999"),
        }),
        "Bet amount must be greater than minBetAmount"
      );
      await expectRevert(
        hyperPredictionV1Pair.betBull("1", {
          from: bullUser1,
          value: ether("0.999999"),
        }),
        "Bet amount must be greater than minBetAmount"
      );
    });
    it("Rejections for genesis start and lock rounds work as expected", async () => {
      await expectRevert(
        hyperPredictionV1Pair.executeRound(),
        "Can only run after genesisStartRound and genesisLockRound is triggered"
      );

      // Epoch 1
      await hyperPredictionV1Pair.genesisStartRound();
      await expectRevert(
        hyperPredictionV1Pair.genesisStartRound(),
        "Can only run genesisStartRound once"
      );
      await updateOraclePrice(INITIAL_PRICE);
      await expectRevert(
        hyperPredictionV1Pair.genesisLockRound(),
        "Can only lock round after lockTimestamp"
      );

      await expectRevert(
        hyperPredictionV1Pair.executeRound(),
        "Can only run after genesisStartRound and genesisLockRound is triggered"
      );

      // Cannot restart genesis round
      await expectRevert(
        hyperPredictionV1Pair.genesisStartRound(),
        "Can only run genesisStartRound once"
      );

      // Admin needs to pause, then unpause
      await hyperPredictionV1Pair.pause({ from: admin });
      await hyperPredictionV1Pair.unpause({ from: admin });

      // Prediction restart
      await hyperPredictionV1Pair.genesisStartRound();

      await nextEpoch();

      // Lock the round
      await hyperPredictionV1Pair.genesisLockRound();
      await nextEpoch();
      await expectRevert(
        hyperPredictionV1Pair.genesisLockRound(),
        "Can only run genesisLockRound once"
      );

      await nextEpoch();
      const bufferSeconds = new BN(
        (await hyperPredictionV1Pair.bufferSeconds()).toString()
      );
      const latestRound = await hyperPredictionV1Pair.rounds(
        await hyperPredictionV1Pair.currentEpoch()
      );
      const overdueTimestamp = new BN(latestRound.closeTimestamp.toString())
        .add(bufferSeconds)
        .add(new BN(1));
      await time.increaseTo(overdueTimestamp.toNumber());
      await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
      await expectRevert(
        hyperPredictionV1Pair.executeRound(),
        "Can only lock round within bufferSeconds"
      );
    });

    it("Should prevent betting when paused", async () => {
      await hyperPredictionV1Pair.genesisStartRound();
      await nextEpoch();
      await hyperPredictionV1Pair.genesisLockRound();
      await nextEpoch();
      await updateOraclePrice(INITIAL_PRICE); // To update Oracle roundId
      await hyperPredictionV1Pair.executeRound();

      let tx = await hyperPredictionV1Pair.pause({ from: admin });
      expectEvent(tx, "Pause", { epoch: new BN(3) });
      await expectRevert(
        hyperPredictionV1Pair.betBull(currentEpoch, {
          from: bullUser1,
          value: ether("1"),
        }),
        "Pausable: paused"
      );
      await expectRevert(
        hyperPredictionV1Pair.betBear(currentEpoch, {
          from: bearUser1,
          value: ether("1"),
        }),
        "Pausable: paused"
      );
      await expectRevert(
        hyperPredictionV1Pair.claim([1], { from: bullUser1 }),
        "Not eligible for claim"
      ); // Success
    });

    it("Should prevent round operations when paused", async () => {
      await hyperPredictionV1Pair.genesisStartRound();
      await nextEpoch();
      await updateOraclePrice(INITIAL_PRICE);
      await hyperPredictionV1Pair.genesisLockRound();
      await nextEpoch();
      await updateOraclePrice(INITIAL_PRICE);
      await hyperPredictionV1Pair.executeRound();

      let tx = await hyperPredictionV1Pair.pause({ from: admin });
      expectEvent(tx, "Pause", { epoch: new BN(3) });
      await expectRevert(
        hyperPredictionV1Pair.executeRound(),
        "Pausable: paused"
      );
      await expectRevert(
        hyperPredictionV1Pair.genesisStartRound(),
        "Pausable: paused"
      );
      await expectRevert(
        hyperPredictionV1Pair.genesisLockRound(),
        "Pausable: paused"
      );

      // Unpause and resume
      await nextEpoch(); // Goes to next epoch block number, but doesn't increase currentEpoch
      tx = await hyperPredictionV1Pair.unpause({ from: admin });
      expectEvent(tx, "Unpause", { epoch: new BN(3) }); // Although nextEpoch is called, currentEpoch doesn't change
      await hyperPredictionV1Pair.genesisStartRound(); // Success
      await nextEpoch();
      await updateOraclePrice(INITIAL_PRICE);
      await hyperPredictionV1Pair.genesisLockRound(); // Success
      await nextEpoch();
      await updateOraclePrice(INITIAL_PRICE);
      await hyperPredictionV1Pair.executeRound(); // Success
    });

    it("Should paginate user rounds", async () => {
      await hyperPredictionV1Pair.genesisStartRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      });
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("1"),
      });
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("1"),
      });

      await nextEpoch();
      await updateOraclePrice(INITIAL_PRICE);
      await hyperPredictionV1Pair.genesisLockRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      });
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("1"),
      });
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("1"),
      });

      await nextEpoch();
      await updateOraclePrice(INITIAL_PRICE);
      await hyperPredictionV1Pair.executeRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      });
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("1"),
      });
      await hyperPredictionV1Pair.betBear(currentEpoch, {
        from: bearUser1,
        value: ether("1"),
      });

      await nextEpoch();
      await updateOraclePrice(INITIAL_PRICE);
      await hyperPredictionV1Pair.executeRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      });
      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser2,
        value: ether("1"),
      });

      await nextEpoch();
      await updateOraclePrice(INITIAL_PRICE);
      await hyperPredictionV1Pair.executeRound();
      currentEpoch = await hyperPredictionV1Pair.currentEpoch();

      await hyperPredictionV1Pair.betBull(currentEpoch, {
        from: bullUser1,
        value: ether("1"),
      });

      // Get by page size of 2
      const pageSize = 2;

      assertBNArray(
        (await hyperPredictionV1Pair.getUserRounds(bullUser1, 0, 5))[0],
        [1, 2, 3, 4, 5]
      );

      let result = await hyperPredictionV1Pair.getUserRounds(
        bullUser1,
        0,
        pageSize
      );
      let epochData = result[0];
      let positionData = result[1];
      let cursor = result[2];

      assertBNArray(epochData, [1, 2]);
      assert.includeOrderedMembers(positionData[0], [
        "0",
        "1000000000000000000",
        false,
      ]);
      assert.includeOrderedMembers(positionData[1], [
        "0",
        "1000000000000000000",
        false,
      ]);
      assert.equal(cursor, 2);

      result = await hyperPredictionV1Pair.getUserRounds(
        bullUser1,
        cursor,
        pageSize
      );
      (epochData = result[0]), (positionData = result[1]), (cursor = result[2]);
      assertBNArray(epochData, [3, 4]);
      assert.includeOrderedMembers(positionData[0], [
        "0",
        "1000000000000000000",
        false,
      ]);
      assert.includeOrderedMembers(positionData[1], [
        "0",
        "1000000000000000000",
        false,
      ]);
      assert.equal(cursor, 4);

      result = await hyperPredictionV1Pair.getUserRounds(
        bullUser1,
        cursor,
        pageSize
      );
      (epochData = result[0]), (positionData = result[1]), (cursor = result[2]);
      assertBNArray(epochData, [5]);
      assert.includeOrderedMembers(positionData[0], [
        "0",
        "1000000000000000000",
        false,
      ]);
      assert.equal(cursor, 5);

      result = await hyperPredictionV1Pair.getUserRounds(
        bullUser1,
        cursor,
        pageSize
      );
      (epochData = result[0]), (positionData = result[1]), (cursor = result[2]);
      assertBNArray(epochData, []);
      assert.isEmpty(positionData);
      assert.equal(cursor, 5);

      assertBNArray(
        (await hyperPredictionV1Pair.getUserRounds(bullUser2, 0, 4))[0],
        [1, 2, 3, 4]
      );
      result = await hyperPredictionV1Pair.getUserRounds(
        bullUser2,
        0,
        pageSize
      );
      (epochData = result[0]), (positionData = result[1]), (cursor = result[2]);
      assertBNArray(epochData, [1, 2]);
      assert.includeOrderedMembers(positionData[0], [
        "0",
        "1000000000000000000",
        false,
      ]);
      assert.includeOrderedMembers(positionData[1], [
        "0",
        "1000000000000000000",
        false,
      ]);
      assert.equal(cursor, 2);

      result = await hyperPredictionV1Pair.getUserRounds(
        bullUser2,
        cursor,
        pageSize
      );
      (epochData = result[0]), (positionData = result[1]), (cursor = result[2]);
      assertBNArray(epochData, [3, 4]);
      assert.includeOrderedMembers(positionData[0], [
        "0",
        "1000000000000000000",
        false,
      ]);
      assert.includeOrderedMembers(positionData[1], [
        "0",
        "1000000000000000000",
        false,
      ]);
      assert.equal(cursor, 4);

      result = await hyperPredictionV1Pair.getUserRounds(
        bullUser2,
        cursor,
        pageSize
      );
      (epochData = result[0]), (positionData = result[1]), (cursor = result[2]);
      assertBNArray(epochData, []);
      assert.isEmpty(positionData);
      assert.equal(cursor, 4);

      assertBNArray(
        (await hyperPredictionV1Pair.getUserRounds(bearUser1, 0, 3))[0],
        [1, 2, 3]
      );
      result = await hyperPredictionV1Pair.getUserRounds(
        bearUser1,
        0,
        pageSize
      );
      (epochData = result[0]), (positionData = result[1]), (cursor = result[2]);
      assertBNArray(epochData, [1, 2]);
      assert.includeOrderedMembers(positionData[0], [
        "1",
        "1000000000000000000",
        false,
      ]);
      assert.includeOrderedMembers(positionData[1], [
        "1",
        "1000000000000000000",
        false,
      ]);
      assert.equal(cursor, 2);

      result = await hyperPredictionV1Pair.getUserRounds(
        bearUser1,
        cursor,
        pageSize
      );
      (epochData = result[0]), (positionData = result[1]), (cursor = result[2]);
      assertBNArray(epochData, [3]);
      assert.includeOrderedMembers(positionData[0], [
        "1",
        "1000000000000000000",
        false,
      ]);
      assert.equal(cursor, 3);

      result = await hyperPredictionV1Pair.getUserRounds(
        bearUser1,
        cursor,
        pageSize
      );
      (epochData = result[0]), (positionData = result[1]), (cursor = result[2]);
      assertBNArray(epochData, []);
      assert.isEmpty(positionData);
      assert.equal(cursor, 3);
    });
  }
);

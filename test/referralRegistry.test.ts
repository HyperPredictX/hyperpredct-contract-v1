import { expect } from "chai";
import { ethers, artifacts } from "hardhat";

const HyperPredictV1Factory = artifacts.require("HyperPredictV1Factory");
const MockERC20 = artifacts.require("MockERC20");
const BLOCK_COUNT_MULTPLIER = 5;
const MIN_BET_AMOUNT = ethers.utils.parseEther("1");
const UPDATE_ALLOWANCE = 30 * BLOCK_COUNT_MULTPLIER; // 30s * multiplier
const INITIAL_REFERRAL_RATE = 0; // 0%
const INITIAL_TREASURY_RATE = 0.01; // 1%
const INITIAL_TREASURY_WITH_REFERRAL_RATE = 0.01; // 1%

describe("ReferralRegistry", function () {
  let referralRegistry: any;
  let factory: any;
  let owner: any;
  let userA: any;
  let userB: any;
  let userC: any;
  let betToken: any;

  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  beforeEach(async function () {
    [owner, userA, userB, userC] = await ethers.getSigners();
    const ReferralRegistry = await ethers.getContractFactory(
      "ReferralRegistry"
    );
    referralRegistry = await ReferralRegistry.deploy();
    await referralRegistry.deployed();
    betToken = await MockERC20.new("Mock USD Coin", "mUSDC", 18, {
      from: owner.address,
    });
    await betToken.mint(owner.address, ethers.utils.parseEther("1000"));
    factory = await HyperPredictV1Factory.new(
      betToken.address,
      referralRegistry.address,
      owner.address,
      MIN_BET_AMOUNT.toString(), // uint256
      UPDATE_ALLOWANCE, // uint256
      String(INITIAL_REFERRAL_RATE * 10000),
      String(INITIAL_TREASURY_RATE * 10000),
      String(INITIAL_TREASURY_WITH_REFERRAL_RATE * 10000),
      { from: owner.address } // deploy tx from
    );
  });

  it("referrerOf should be zero address by default", async function () {
    const ref = await referralRegistry.referrerOf(userA.address);
    expect(ref).to.equal(ZERO_ADDRESS);
  });

  it("should set another address as referrer & emit event", async function () {
    // Execute transaction
    const tx = await referralRegistry.connect(userA).setReferrer(userB.address);

    // Get transaction receipt
    const receipt = await tx.wait();

    // Find and decode the Referred event from logs
    const iface = referralRegistry.interface;
    const eventTopic = iface.getEventTopic("Referred");

    // Find the event log from the transaction receipt
    const log = receipt.logs.find((l: any) => l.topics[0] === eventTopic);
    expect(log).to.not.be.undefined;

    const decoded = iface.decodeEventLog("Referred", log.data, log.topics);

    // decoded[0] = user, decoded[1] = referrer
    expect(decoded[0]).to.equal(userA.address);
    expect(decoded[1]).to.equal(userB.address);

    // Verify storage update
    const ref = await referralRegistry.referrerOf(userA.address);
    expect(ref).to.equal(userB.address);
  });

  it("should revert when referrer is zero address (invalid referrer)", async function () {
    // Check revert with try/catch
    let threw = false;
    try {
      await referralRegistry.connect(userA).setReferrer(ZERO_ADDRESS);
    } catch (err: any) {
      threw = true;
      // Optionally check revert reason string
      expect(err.message).to.include("invalid referrer");
    }
    expect(threw).to.equal(true);
  });

  it("should revert when user sets themselves as referrer (self ref not allowed)", async function () {
    let threw = false;
    try {
      await referralRegistry.connect(userA).setReferrer(userA.address);
    } catch (err: any) {
      threw = true;
      expect(err.message).to.include("self ref not allowed");
    }
    expect(threw).to.equal(true);
  });

  it("should not allow referrer to be changed once set (already set)", async function () {
    // First set succeeds
    await referralRegistry.connect(userA).setReferrer(userB.address);

    // Second set should revert
    let threw = false;
    try {
      await referralRegistry.connect(userA).setReferrer(userC.address);
    } catch (err: any) {
      threw = true;
      expect(err.message).to.include("already set");
    }
    expect(threw).to.equal(true);

    // Verify the value is unchanged
    const ref = await referralRegistry.referrerOf(userA.address);
    expect(ref).to.equal(userB.address);
  });
});

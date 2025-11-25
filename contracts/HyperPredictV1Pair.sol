// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Pausable } from "@openzeppelin/contracts/security/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import "@pythnetwork/pyth-sdk-solidity/PythUtils.sol";
import { IReferralRegistry } from "./interfaces/IReferralRegistry.sol";
import { IHyperPredictV1Factory } from "./interfaces/IHyperPredictV1Factory.sol";

/**
 * @title HyperPredictV1Pair
 */
contract HyperPredictV1Pair is Pausable, ReentrancyGuard {
  using SafeERC20 for IERC20;

  IPyth public oracle;
  IHyperPredictV1Factory public factory;

  bool public genesisLockOnce = false;
  bool public genesisStartOnce = false;

  address public operatorAddress; // address of the operator
  bytes32 public priceId; // Pyth price ID

  uint256 public intervalSeconds; // interval in seconds between two prediction rounds

  uint256 public treasuryAmount; // treasury amount that was not claimed
  uint256 public referralAmount; // total referral amount that was paid

  uint256 public currentEpoch; // current epoch for prediction round

  uint256 public oracleLatestRoundId; // converted from uint80 (Chainlink)

  uint256 public constant MAX_TREASURY_FEE = 1000; // 10%
  uint256 public constant MAX_REFERRAL_FEE = 100; // 1%
  uint8 public constant PYTH_PRICE_DECIMALS = 8; // Match human readable precision (1e-8)

  mapping(uint256 => mapping(address => BetInfo)) public ledger;
  mapping(uint256 => Round) public rounds;
  mapping(uint256 => uint256) public referralAmountPerRound;
  mapping(address => uint256[]) public userRounds;

  enum Position {
    Bull,
    Bear
  }

  struct Round {
    uint256 epoch;
    uint256 startTimestamp;
    uint256 lockTimestamp;
    uint256 closeTimestamp;
    int256 lockPrice;
    int256 closePrice;
    uint256 lockOracleId;
    uint256 closeOracleId;
    uint256 totalAmount;
    uint256 bullAmount;
    uint256 bearAmount;
    uint256 rewardBaseCalAmount;
    uint256 rewardAmount;
    bool oracleCalled;
  }

  struct BetInfo {
    Position position;
    uint256 amount; // default 0
    bool claimed; // default false
  }

  struct ReferralSummary {
    address referrer;
    uint256 totalBonus;
    uint256 roundCount;
  }

  event BetBear(address indexed sender, uint256 indexed epoch, uint256 amount);
  event BetBull(address indexed sender, uint256 indexed epoch, uint256 amount);
  event Claim(address indexed sender, uint256 indexed epoch, uint256 amount);
  event EndRound(uint256 indexed epoch, uint256 indexed roundId, int256 price);
  event LockRound(uint256 indexed epoch, uint256 indexed roundId, int256 price);

  event NewOperatorAddress(address operator);

  event Pause(uint256 indexed epoch);
  event RewardsCalculated(
    uint256 indexed epoch,
    uint256 rewardBaseCalAmount,
    uint256 rewardAmount,
    uint256 treasuryAmount,
    uint256 referralAmount
  );
  event ReferralPaid(
    address indexed user,
    address indexed referrer,
    uint256 indexed referralRoundCount,
    uint256 referrerBonus
  );

  event StartRound(uint256 indexed epoch);
  event TokenRecovery(address indexed token, uint256 amount);
  event TreasuryClaim(uint256 amount);
  event Unpause(uint256 indexed epoch);

  modifier onlyAdmin() {
    require(msg.sender == adminAddress(), "Not admin");
    _;
  }

  modifier onlyAdminOrOperator() {
    require(
      msg.sender == adminAddress() || msg.sender == operatorAddress,
      "Not operator/admin"
    );
    _;
  }

  modifier onlyOperator() {
    require(msg.sender == operatorAddress, "Not operator");
    _;
  }

  modifier onlyFactory() {
    require(msg.sender == address(factory), "Not factory");
    _;
  }

  modifier notContract() {
    require(!_isContract(msg.sender), "Contract not allowed");
    require(msg.sender == tx.origin, "Proxy contract not allowed");
    _;
  }

  /**
   * @notice Constructor
   * @param _factory: factory contract address
   * @param _oracleAddress: oracle address
   * @param _priceId: Pyth price ID
   * @param _operatorAddress: operator address
   * @param _intervalSeconds: number of time within an interval
   */
  constructor(
    address _factory,
    address _oracleAddress,
    bytes32 _priceId,
    address _operatorAddress,
    uint256 _intervalSeconds
  ) {
    require(_factory != address(0), "Factory zero addr");
    factory = IHyperPredictV1Factory(_factory);
    oracle = IPyth(_oracleAddress);
    operatorAddress = _operatorAddress;
    priceId = _priceId;
    intervalSeconds = _intervalSeconds;
  }

  /**
   * @notice Bet bear position
   * @param epoch: epoch
   */
  function betBear(uint256 epoch)
    external
    payable
    whenNotPaused
    nonReentrant
    notContract
  {
    require(epoch == currentEpoch, "Bet is too early/late");
    require(_bettable(epoch), "Round not bettable");
    require(
      msg.value >= minBetAmount(),
      "Bet amount must be greater than minBetAmount"
    );

    // Update round data
    uint256 amount = msg.value;
    Round storage round = rounds[epoch];
    round.totalAmount = round.totalAmount + amount;
    round.bearAmount = round.bearAmount + amount;

    // Update user data
    BetInfo storage betInfo = ledger[epoch][msg.sender];
    bool isFirstBet = betInfo.amount == 0;

    if (isFirstBet) {
      betInfo.position = Position.Bear;
    } else {
      require(
        betInfo.position == Position.Bear,
        "Can only add to existing position"
      );
    }

    betInfo.amount = betInfo.amount + amount;
    if (isFirstBet) {
      userRounds[msg.sender].push(epoch);
    }

    emit BetBear(msg.sender, epoch, amount);
  }

  /**
   * @notice Bet bull position
   * @param epoch: epoch
   */
  function betBull(uint256 epoch)
    external
    payable
    whenNotPaused
    nonReentrant
    notContract
  {
    require(epoch == currentEpoch, "Bet is too early/late");
    require(_bettable(epoch), "Round not bettable");
    require(
      msg.value >= minBetAmount(),
      "Bet amount must be greater than minBetAmount"
    );

    // Update round data
    uint256 amount = msg.value;
    Round storage round = rounds[epoch];
    round.totalAmount = round.totalAmount + amount;
    round.bullAmount = round.bullAmount + amount;

    // Update user data
    BetInfo storage betInfo = ledger[epoch][msg.sender];
    bool isFirstBet = betInfo.amount == 0;

    if (isFirstBet) {
      betInfo.position = Position.Bull;
    } else {
      require(
        betInfo.position == Position.Bull,
        "Can only add to existing position"
      );
    }

    betInfo.amount = betInfo.amount + amount;
    if (isFirstBet) {
      userRounds[msg.sender].push(epoch);
    }

    emit BetBull(msg.sender, epoch, amount);
  }

  /**
   * @notice Claim reward for an array of epochs
   * @param epochs: array of epochs
   */
  function claim(uint256[] calldata epochs) external nonReentrant notContract {
    _claim(msg.sender, epochs);
  }

  /**
   * @notice Claim reward via factory
   * @param user address whose rewards will be claimed
   * @param epochs array of epochs
   */
  function claimViaFactory(address user, uint256[] calldata epochs)
    external
    nonReentrant
    onlyFactory
  {
    require(!_isContract(user), "Contract not allowed");
    require(user == tx.origin, "Proxy contract not allowed");
    _claim(user, epochs);
  }

  function _claim(address user, uint256[] calldata epochs) internal {
    uint256 reward; // Initializes reward
    ReferralSummary memory referralSummary = ReferralSummary({
      referrer: referralRegistry().referrerOf(user),
      totalBonus: 0,
      roundCount: 0
    });

    for (uint256 i = 0; i < epochs.length; i++) {
      uint256 epoch = epochs[i];
      require(rounds[epoch].startTimestamp != 0, "Round has not started");
      require(
        block.timestamp > rounds[epoch].closeTimestamp,
        "Round has not ended"
      );

      uint256 addedReward = 0;

      // Round valid, claim rewards
      if (rounds[epoch].oracleCalled) {
        require(claimable(epoch, user), "Not eligible for claim");
        Round memory round = rounds[epoch];

        if (round.lockPrice == round.closePrice) {
          addedReward = ledger[epoch][user].amount;
        } else {
          uint256 baseReward = (ledger[epoch][user].amount *
            round.rewardAmount) / round.rewardBaseCalAmount;
          (
            uint256 rewardWithReferral,
            uint256 referrerBonus,
            bool referralAwarded
          ) = _applyReferralBonus(
              epoch,
              user,
              referralSummary.referrer,
              baseReward
            );
          addedReward = rewardWithReferral;

          if (referralAwarded) {
            referralSummary.roundCount += 1;
            referralSummary.totalBonus += referrerBonus;
          }
        }
      }
      // Round invalid, refund bet amount
      else {
        require(refundable(epoch, user), "Not eligible for refund");
        addedReward = ledger[epoch][user].amount;
      }

      ledger[epoch][user].claimed = true;
      reward += addedReward;

      emit Claim(user, epoch, addedReward);
    }

    if (reward > 0) {
      _safeTransferNativeToken(address(user), reward);
    }

    if (referralSummary.roundCount > 0) {
      if (referralSummary.totalBonus > 0) {
        _safeTransferNativeToken(
          referralSummary.referrer,
          referralSummary.totalBonus
        );
      }

      emit ReferralPaid(
        user,
        referralSummary.referrer,
        referralSummary.roundCount,
        referralSummary.totalBonus
      );
    }
  }

  /**
   * @notice Start the next round n, lock price for round n-1, end round n-2
   * @dev Callable by operator
   */
  function executeRound() external whenNotPaused onlyOperator {
    require(
      genesisStartOnce && genesisLockOnce,
      "Can only run after genesisStartRound and genesisLockRound is triggered"
    );

    (uint256 currentRoundId, int256 currentPrice) = _getPriceFromOracle();

    oracleLatestRoundId = uint256(currentRoundId);

    // CurrentEpoch refers to previous round (n-1)
    _safeLockRound(currentEpoch, currentRoundId, currentPrice);
    _safeEndRound(currentEpoch - 1, currentRoundId, currentPrice);
    _calculateRewards(currentEpoch - 1);

    // Increment currentEpoch to current round (n)
    currentEpoch = currentEpoch + 1;
    _safeStartRound(currentEpoch);
  }

  /**
   * @notice Lock genesis round
   * @dev Callable by operator
   */
  function genesisLockRound() external whenNotPaused onlyOperator {
    require(
      genesisStartOnce,
      "Can only run after genesisStartRound is triggered"
    );
    require(!genesisLockOnce, "Can only run genesisLockRound once");

    (uint256 currentRoundId, int256 currentPrice) = _getPriceFromOracle();

    oracleLatestRoundId = uint256(currentRoundId);

    _safeLockRound(currentEpoch, currentRoundId, currentPrice);

    currentEpoch = currentEpoch + 1;
    _startRound(currentEpoch);
    genesisLockOnce = true;
  }

  /**
   * @notice Start genesis round
   * @dev Callable by admin or operator
   */
  function genesisStartRound() external whenNotPaused onlyOperator {
    require(!genesisStartOnce, "Can only run genesisStartRound once");

    currentEpoch = currentEpoch + 1;
    _startRound(currentEpoch);
    genesisStartOnce = true;
  }

  /**
   * @notice called by the admin to pause, triggers stopped state
   * @dev Callable by admin or operator
   */
  function pause() external whenNotPaused onlyAdminOrOperator {
    _pause();

    emit Pause(currentEpoch);
  }

  /**
   * @notice Claim all rewards in treasury
   * @dev Callable by admin
   */
  function claimTreasury() external nonReentrant onlyAdmin {
    uint256 currentTreasuryAmount = treasuryAmount;
    treasuryAmount = 0;
    _safeTransferNativeToken(adminAddress(), currentTreasuryAmount);

    emit TreasuryClaim(currentTreasuryAmount);
  }

  /**
   * @notice called by the admin to unpause, returns to normal state
   * Reset genesis state. Once paused, the rounds would need to be kickstarted by genesis
   */
  function unpause() external whenPaused onlyAdminOrOperator {
    genesisStartOnce = false;
    genesisLockOnce = false;
    _unpause();

    emit Unpause(currentEpoch);
  }

  function totalReferralFee() public view returns (uint256) {
    return referralFee() * 2;
  }

  /**
   * @notice It allows the owner to recover tokens sent to the contract by mistake
   * @param _token: token address
   * @param _amount: token amount
   * @dev Callable by owner
   */
  function recoverToken(address _token, uint256 _amount) external onlyAdmin {
    IERC20(_token).safeTransfer(address(msg.sender), _amount);

    emit TokenRecovery(_token, _amount);
  }

  /**
   * @notice Returns round epochs and bet information for a user that has participated
   * @param user: user address
   * @param cursor: cursor
   * @param size: size
   */
  function getUserRounds(
    address user,
    uint256 cursor,
    uint256 size
  )
    external
    view
    returns (
      uint256[] memory,
      BetInfo[] memory,
      uint256
    )
  {
    uint256 length = size;

    if (length > userRounds[user].length - cursor) {
      length = userRounds[user].length - cursor;
    }

    uint256[] memory values = new uint256[](length);
    BetInfo[] memory betInfo = new BetInfo[](length);

    for (uint256 i = 0; i < length; i++) {
      values[i] = userRounds[user][cursor + i];
      betInfo[i] = ledger[values[i]][user];
    }

    return (values, betInfo, cursor + length);
  }

  /**
   * @notice Returns round epochs length
   * @param user: user address
   */
  function getUserRoundsLength(address user) external view returns (uint256) {
    return userRounds[user].length;
  }

  /**
   * @notice Get the claimable stats of specific epoch and user account
   * @param epoch: epoch
   * @param user: user address
   */
  function claimable(uint256 epoch, address user) public view returns (bool) {
    BetInfo memory betInfo = ledger[epoch][user];
    Round memory round = rounds[epoch];

    return
      round.oracleCalled &&
      betInfo.amount != 0 &&
      !betInfo.claimed &&
      ((round.closePrice > round.lockPrice &&
        betInfo.position == Position.Bull) ||
        (round.closePrice < round.lockPrice &&
          betInfo.position == Position.Bear) ||
        (round.closePrice == round.lockPrice));
  }

  /**
   * @notice Get the refundable stats of specific epoch and user account
   * @param epoch: epoch
   * @param user: user address
   */
  function refundable(uint256 epoch, address user) public view returns (bool) {
    BetInfo memory betInfo = ledger[epoch][user];
    Round memory round = rounds[epoch];
    return
      !round.oracleCalled &&
      !betInfo.claimed &&
      block.timestamp > round.closeTimestamp + bufferSeconds() &&
      betInfo.amount != 0;
  }

  /**
   * @notice Calculate rewards for round
   * @param epoch: epoch
   */
  function _calculateRewards(uint256 epoch) internal {
    Round storage round = rounds[epoch];
    require(
      round.rewardBaseCalAmount == 0 && round.rewardAmount == 0,
      "Rewards calculated"
    );

    int256 lockPrice = round.lockPrice;
    int256 closePrice = round.closePrice;
    uint256 total = round.totalAmount;

    if (closePrice == lockPrice) {
      round.rewardBaseCalAmount = 0;
      round.rewardAmount = 0;
      referralAmountPerRound[epoch] = 0;
      emit RewardsCalculated(epoch, 0, 0, 0, 0);
      return;
    }

    uint256 treasuryAmt = (total * treasuryFee()) / 10000;
    uint256 referralAmt = (total * totalReferralFee()) / 10000;
    uint256 rewardAmount = total - (treasuryAmt + referralAmt);

    uint256 rewardBaseCalAmount = (closePrice > lockPrice)
      ? round.bullAmount
      : round.bearAmount;

    round.rewardBaseCalAmount = rewardBaseCalAmount;
    round.rewardAmount = rewardAmount;
    referralAmountPerRound[epoch] = referralAmt;

    treasuryAmount += treasuryAmt;

    emit RewardsCalculated(
      epoch,
      rewardBaseCalAmount,
      rewardAmount,
      treasuryAmt,
      referralAmt
    );
  }

  /**
   * @notice End round
   * @param epoch: epoch
   * @param roundId: roundId
   * @param price: price of the round
   */
  function _safeEndRound(
    uint256 epoch,
    uint256 roundId,
    int256 price
  ) internal {
    require(
      rounds[epoch].lockTimestamp != 0,
      "Can only end round after round has locked"
    );
    require(
      block.timestamp >= rounds[epoch].closeTimestamp,
      "Can only end round after closeTimestamp"
    );
    require(
      block.timestamp <= rounds[epoch].closeTimestamp + bufferSeconds(),
      "Can only end round within bufferSeconds"
    );
    Round storage round = rounds[epoch];
    round.closePrice = price;
    round.closeOracleId = roundId;
    round.oracleCalled = true;

    emit EndRound(epoch, roundId, round.closePrice);
  }

  /**
   * @notice Lock round
   * @param epoch: epoch
   * @param roundId: roundId
   * @param price: price of the round
   */
  function _safeLockRound(
    uint256 epoch,
    uint256 roundId,
    int256 price
  ) internal {
    require(
      rounds[epoch].startTimestamp != 0,
      "Can only lock round after round has started"
    );
    require(
      block.timestamp >= rounds[epoch].lockTimestamp,
      "Can only lock round after lockTimestamp"
    );
    require(
      block.timestamp <= rounds[epoch].lockTimestamp + bufferSeconds(),
      "Can only lock round within bufferSeconds"
    );
    Round storage round = rounds[epoch];
    round.closeTimestamp = block.timestamp + intervalSeconds;
    round.lockPrice = price;
    round.lockOracleId = roundId;

    emit LockRound(epoch, roundId, round.lockPrice);
  }

  /**
   * @notice Start round
   * Previous round n-2 must end
   * @param epoch: epoch
   */
  function _safeStartRound(uint256 epoch) internal {
    require(
      genesisStartOnce,
      "Can only run after genesisStartRound is triggered"
    );
    require(
      rounds[epoch - 2].closeTimestamp != 0,
      "Can only start round after round n-2 has ended"
    );
    require(
      block.timestamp >= rounds[epoch - 2].closeTimestamp,
      "Can only start new round after round n-2 closeTimestamp"
    );
    _startRound(epoch);
  }

  /**
   * @notice Transfer NativeToken in a safe way
   * @param to: address to transfer NativeToken to
   * @param value: NativeToken amount to transfer (in wei)
   */
  function _safeTransferNativeToken(address to, uint256 value) internal {
    (bool success, ) = to.call{ value: value }("");
    require(success, "TransferHelper: NativeToken_TRANSFER_FAILED");
  }

  /**
   * @notice Start round
   * Previous round n-2 must end
   * @param epoch: epoch
   */
  function _startRound(uint256 epoch) internal {
    Round storage round = rounds[epoch];
    round.startTimestamp = block.timestamp;
    round.lockTimestamp = block.timestamp + intervalSeconds;
    round.closeTimestamp = block.timestamp + (2 * intervalSeconds);
    round.epoch = epoch;
    round.totalAmount = 0;

    emit StartRound(epoch);
  }

  function _applyReferralBonus(
    uint256 epoch,
    address winner,
    address referrer,
    uint256 baseReward
  )
    internal
    returns (
      uint256,
      uint256,
      bool
    )
  {
    uint256 referralAllocated = (referralAmountPerRound[epoch] *
      ledger[epoch][winner].amount) / rounds[epoch].rewardBaseCalAmount;

    if (referrer == address(0) || referralAllocated == 0) {
      treasuryAmount += referralAllocated;
      return (baseReward, 0, false);
    }

    uint256 referrerBonus = referralAllocated / 2;
    uint256 winnerBonus = referralAllocated - referrerBonus;

    referralAmount += referralAllocated;

    return (baseReward + winnerBonus, referrerBonus, true);
  }

  /**
   * @notice Set operator address
   * @dev Callable by admin
   */
  function setOperator(address _operatorAddress) external onlyAdmin {
    require(_operatorAddress != address(0), "Cannot be zero address");
    operatorAddress = _operatorAddress;

    emit NewOperatorAddress(_operatorAddress);
  }

  /**
   * @notice Determine if a round is valid for receiving bets
   * Round must have started and locked
   * Current timestamp must be within startTimestamp and closeTimestamp
   */
  function _bettable(uint256 epoch) internal view returns (bool) {
    return
      rounds[epoch].startTimestamp != 0 &&
      rounds[epoch].lockTimestamp != 0 &&
      block.timestamp > rounds[epoch].startTimestamp &&
      block.timestamp < rounds[epoch].lockTimestamp;
  }

  /**
   * @notice Get latest recorded price from oracle
   * If it falls below allowed buffer or has not updated, it would be invalid.
   */
  function _getPriceFromOracle() internal view returns (uint256, int256) {
    PythStructs.Price memory price = oracle.getPriceNoOlderThan(
      priceId,
      bufferSeconds()
    );

    int64 rawPrice = price.price;
    bool isNegative = rawPrice < 0;

    if (isNegative) {
      // Prevent overflow when taking the absolute value of int64 min
      require(rawPrice != type(int64).min, "Invalid oracle price");
      rawPrice = -rawPrice;
    }

    uint256 unsignedNormalized = PythUtils.convertToUint(
      rawPrice,
      price.expo,
      PYTH_PRICE_DECIMALS
    );

    require(
      unsignedNormalized <= uint256(type(int256).max),
      "Oracle price overflow"
    );

    int256 normalizedPrice = isNegative
      ? -int256(unsignedNormalized)
      : int256(unsignedNormalized);

    return (price.publishTime, normalizedPrice);
  }

  /**
   * @notice Returns true if `account` is a contract.
   * @param account: account address
   */
  function _isContract(address account) internal view returns (bool) {
    uint256 size;
    assembly {
      size := extcodesize(account)
    }
    return size > 0;
  }

  function adminAddress() public view returns (address) {
    return factory.adminAddress();
  }

  function bufferSeconds() public view returns (uint256) {
    return factory.bufferSeconds();
  }

  function minBetAmount() public view returns (uint256) {
    return factory.minBetAmount();
  }

  function referralFee() public view returns (uint256) {
    return factory.referralFee();
  }

  function treasuryFee() public view returns (uint256) {
    return factory.treasuryFee();
  }

  function referralRegistry() public view returns (IReferralRegistry) {
    return IReferralRegistry(factory.referralRegistryAddress());
  }
}

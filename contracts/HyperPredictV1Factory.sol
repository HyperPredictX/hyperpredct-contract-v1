// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { HyperPredictV1Pair } from "./HyperPredictV1Pair.sol";
import { IHyperPredictV1PairDeployer } from "./interfaces/IHyperPredictV1PairDeployer.sol";

/**
 * @title HyperPredictV1Factory
 * @notice Deploys HyperPredictV1Pair contracts with shared configuration
 */
contract HyperPredictV1Factory is Ownable {
  using SafeERC20 for IERC20;

  IERC20 public immutable token; // Prediction token
  address public referralRegistryAddress;
  address public adminAddress;
  uint256 public minBetAmount;
  uint256 public referralFee;
  uint256 public treasuryFee;
  uint256 public bufferSeconds;
  IHyperPredictV1PairDeployer public pairDeployer;
  uint256 public constant MAX_TREASURY_FEE = 300; // 3%
  uint256 public constant MAX_REFERRAL_FEE = 100; // 1%
  struct ClaimRequest {
    address pair;
    uint256[] epochs;
  }

  // ====== Tracking deployed pairs ======
  address[] public allPairs;

  event PairCreated(
    address indexed pair,
    address indexed oracle,
    bytes32 indexed priceId,
    address operator,
    uint256 intervalSeconds
  );

  event NewAdminAddress(address admin);
  event NewMinBetAmount(uint256 minBetAmount);
  event NewTreasuryFee(uint256 treasuryFee);
  event NewReferralFee(uint256 referralFee);
  event NewBufferSeconds(uint256 bufferSeconds);
  event NewPairDeployer(address pairDeployer);

  modifier onlyAdmin() {
    require(msg.sender == adminAddress, "Not admin");
    _;
  }

  constructor(
    IERC20 _token,
    address _referralRegistryAddress,
    address _adminAddress,
    uint256 _minBetAmount,
    uint256 _bufferSeconds,
    uint256 _referralFee,
    uint256 _treasuryFee
  ) {
    require(address(_token) != address(0), "Token zero addr");
    require(_referralRegistryAddress != address(0), "Referral zero addr");
    require(_treasuryFee <= MAX_TREASURY_FEE, "Treasury fee too high");
    require(_referralFee <= MAX_REFERRAL_FEE, "Referral fee too high");
    require(
      _treasuryFee >= (_referralFee * 2),
      "Referral fee higher than treasury"
    );
    require(_bufferSeconds > 0, "bufferSeconds must be > 0");

    token = _token;
    referralRegistryAddress = _referralRegistryAddress;
    adminAddress = _adminAddress;
    minBetAmount = _minBetAmount;
    referralFee = _referralFee;
    treasuryFee = _treasuryFee;
    bufferSeconds = _bufferSeconds;
  }

  /**
   * @notice Create a new HyperPredictV1Pair
   * @param _oracleAddress Pyth oracle contract address
   * @param _priceId Pyth price ID
   * @param _operatorAddress operator address for this pair
   * @param _intervalSeconds round interval in seconds
   */
  function createPair(
    address _oracleAddress,
    bytes32 _priceId,
    address _operatorAddress,
    uint256 _intervalSeconds
  ) external onlyAdmin returns (address pair) {
    require(_oracleAddress != address(0), "oracle zero addr");
    require(_operatorAddress != address(0), "operator zero addr");
    require(_intervalSeconds > 0, "interval must > 0");
    require(adminAddress != address(0), "admin not set");
    require(referralRegistryAddress != address(0), "referral not set");
    require(address(pairDeployer) != address(0), "pair deployer not set");

    pair = pairDeployer.deployPair(
      _oracleAddress,
      _priceId,
      _operatorAddress,
      _intervalSeconds
    );
    allPairs.push(pair);

    emit PairCreated(
      pair,
      _oracleAddress,
      _priceId,
      _operatorAddress,
      _intervalSeconds
    );
  }

  /**
   * @notice Claim rewards from multiple pairs through the factory
   * @param requests array of claim requests
   */
  function claim(ClaimRequest[] calldata requests) external {
    for (uint256 i = 0; i < requests.length; i++) {
      address pairAddress = requests[i].pair;
      require(pairAddress != address(0), "pair zero addr");
      HyperPredictV1Pair pair = HyperPredictV1Pair(pairAddress);
      require(address(pair.factory()) == address(this), "Unknown pair");

      pair.claimViaFactory(msg.sender, requests[i].epochs);
    }
  }

  /**
   * @notice Place a bet on a specific pair through the factory
   * @param pairAddress pair contract to interact with
   * @param isBull true for bull position, false for bear
   * @param epoch target epoch
   * @param amount bet amount
   */
  function bet(
    address pairAddress,
    bool isBull,
    uint256 epoch,
    uint256 amount
  ) external {
    require(pairAddress != address(0), "pair zero addr");
    require(
      amount >= minBetAmount,
      "Bet amount must be greater than minBetAmount"
    );

    HyperPredictV1Pair pair = HyperPredictV1Pair(pairAddress);
    require(address(pair.factory()) == address(this), "Unknown pair");

    token.safeTransferFrom(msg.sender, address(this), amount);
    token.safeIncreaseAllowance(pairAddress, amount);

    if (isBull) {
      pair.betBullViaFactory(msg.sender, epoch, amount);
    } else {
      pair.betBearViaFactory(msg.sender, epoch, amount);
    }

    uint256 remainingAllowance = token.allowance(address(this), pairAddress);
    if (remainingAllowance > 0) {
      token.safeApprove(pairAddress, 0);
    }
  }

  // ====== View helpers ======

  function allPairsLength() external view returns (uint256) {
    return allPairs.length;
  }

  /**
   * @notice Set admin address
   * @dev Callable by owner
   */
  function setAdmin(address _adminAddress) external onlyOwner {
    require(_adminAddress != address(0), "Cannot be zero address");
    adminAddress = _adminAddress;

    emit NewAdminAddress(_adminAddress);
  }

  /**
   * @notice Set minBetAmount
   * @dev Callable by admin
   */
  function setMinBetAmount(uint256 _minBetAmount) external onlyAdmin {
    require(_minBetAmount != 0, "Must be superior to 0");
    minBetAmount = _minBetAmount;

    emit NewMinBetAmount(minBetAmount);
  }

  /**
   * @notice Set treasury fee
   * @dev Callable by admin
   */
  function setTreasuryFee(uint256 _treasuryFee) external onlyAdmin {
    require(_treasuryFee <= MAX_TREASURY_FEE, "Treasury fee too high");
    treasuryFee = _treasuryFee;

    emit NewTreasuryFee(treasuryFee);
  }

  /**
   * @notice Set referral fee
   * @dev Callable by admin
   */
  function setReferralFee(uint256 _referralFee) external onlyAdmin {
    require(_referralFee <= MAX_REFERRAL_FEE, "Referral fee too high");
    require(
      treasuryFee >= (_referralFee * 2),
      "Referral fee higher than treasury"
    );
    referralFee = _referralFee;
    emit NewReferralFee(referralFee);
  }

  /**
   * @notice Set buffer seconds used for oracle recency checks
   * @dev Callable by admin
   */
  function setBufferSeconds(uint256 _bufferSeconds) external onlyAdmin {
    require(_bufferSeconds > 0, "bufferSeconds must be > 0");
    bufferSeconds = _bufferSeconds;

    emit NewBufferSeconds(_bufferSeconds);
  }

  /**
   * @notice Set pair deployer contract
   * @dev Callable by owner
   */
  function setPairDeployer(address _pairDeployer) external onlyOwner {
    require(_pairDeployer != address(0), "Cannot be zero address");
    pairDeployer = IHyperPredictV1PairDeployer(_pairDeployer);

    emit NewPairDeployer(_pairDeployer);
  }
}

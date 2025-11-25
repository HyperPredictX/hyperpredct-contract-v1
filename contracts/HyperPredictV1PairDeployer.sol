// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./HyperPredictV1Pair.sol";
import "./interfaces/IHyperPredictV1PairDeployer.sol";

/**
 * @title HyperPredictV1PairDeployer
 * @notice Deploys HyperPredictV1Pair contracts on behalf of the factory
 */
contract HyperPredictV1PairDeployer is IHyperPredictV1PairDeployer {
  address public immutable factory;

  modifier onlyFactory() {
    require(msg.sender == factory, "Not factory");
    _;
  }

  constructor(address _factory) {
    require(_factory != address(0), "Factory zero addr");
    factory = _factory;
  }

  function deployPair(
    address _oracleAddress,
    bytes32 _priceId,
    address _operatorAddress,
    uint256 _intervalSeconds
  ) external override onlyFactory returns (address pair) {
    HyperPredictV1Pair newPair = new HyperPredictV1Pair(
      factory,
      _oracleAddress,
      _priceId,
      _operatorAddress,
      _intervalSeconds
    );

    pair = address(newPair);
  }
}


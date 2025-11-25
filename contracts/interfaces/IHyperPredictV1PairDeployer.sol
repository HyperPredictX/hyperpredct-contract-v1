// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IHyperPredictV1PairDeployer {
  function deployPair(
    address _oracleAddress,
    bytes32 _priceId,
    address _operatorAddress,
    uint256 _intervalSeconds
  ) external returns (address pair);
}


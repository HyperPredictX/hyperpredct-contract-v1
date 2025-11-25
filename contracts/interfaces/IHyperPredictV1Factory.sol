// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IHyperPredictV1Factory {
  function referralRegistryAddress() external view returns (address);

  function adminAddress() external view returns (address);

  function bufferSeconds() external view returns (uint256);

  function minBetAmount() external view returns (uint256);

  function referralFee() external view returns (uint256);

  function treasuryFee() external view returns (uint256);
}

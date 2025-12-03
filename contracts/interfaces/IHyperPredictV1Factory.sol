// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IHyperPredictV1Factory {
  function token() external view returns (IERC20);

  function referralRegistryAddress() external view returns (address);

  function adminAddress() external view returns (address);

  function bufferSeconds() external view returns (uint256);

  function minBetAmount() external view returns (uint256);

  function referralFee() external view returns (uint256);

  function treasuryFee() external view returns (uint256);

  function treasuryFeeWithReferral() external view returns (uint256);

  function bet(
    address pair,
    bool isBull,
    uint256 epoch,
    uint256 amount
  ) external;
}

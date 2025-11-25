// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IReferralRegistry {
  function referrerOf(address user) external view returns (address);
}

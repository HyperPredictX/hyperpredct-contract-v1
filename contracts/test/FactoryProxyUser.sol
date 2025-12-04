// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { HyperPredictV1Factory } from "../HyperPredictV1Factory.sol";

/**
 * @notice Helper contract used in tests to simulate a smart-account user
 * interacting with the HyperPredict factory.
 */
contract FactoryProxyUser {
  HyperPredictV1Factory public immutable factory;
  IERC20 public immutable token;
  address public immutable owner;

  modifier onlyOwner() {
    require(msg.sender == owner, "Not owner");
    _;
  }

  constructor(address factoryAddress) {
    factory = HyperPredictV1Factory(factoryAddress);
    token = factory.token();
    owner = msg.sender;
  }

  function approveFactory(uint256 amount) external onlyOwner {
    token.approve(address(factory), amount);
  }

  function placeBet(
    address pair,
    bool isBull,
    uint256 epoch,
    uint256 amount
  ) external onlyOwner {
    factory.bet(pair, isBull, epoch, amount);
  }

  function batchClaim(HyperPredictV1Factory.ClaimRequest[] calldata requests)
    external
    onlyOwner
  {
    factory.claim(requests);
  }

  function withdraw(address to, uint256 amount) external onlyOwner {
    token.transfer(to, amount);
  }
}

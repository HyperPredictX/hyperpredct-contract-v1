// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract ReferralRegistry {
  mapping(address => address) public referrerOf;

  event Referred(address indexed user, address indexed referrer);

  function setReferrer(address referrer) external {
    require(referrer != address(0), "invalid referrer");
    require(referrer != msg.sender, "self ref not allowed");
    require(referrerOf[msg.sender] == address(0), "already set");
    referrerOf[msg.sender] = referrer;
    emit Referred(msg.sender, referrer);
  }
}

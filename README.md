# HyperPredict V1 Contract

## Description

HyperPredict V1 Contract is a decentralized prediction market protocol built on Binance smart chain. It allows users to bet on the price movement of BNB/USD within specified time intervals (rounds). Each round consists of three phases: betting, locking, and execution. This contract was forked from PancakeSwap Prediction V1 Contract.

## Features

### Deployment

mainnet deployment script for Binance smart chain:

```bash
source config/env/bsc/.env.BNB-3min

npx hardhat run --network bsc_mainnet scripts/deploy-referral-registry.ts
npx hardhat run --network bsc_mainnet scripts/deploy-factory.ts

source config/env/bsc/.env.BNB-3min
npx hardhat run --network bsc_mainnet scripts/deploy-pair.ts
source config/env/bsc/.env.BNB-15min
npx hardhat run --network bsc_mainnet scripts/deploy-pair.ts
source config/env/bsc/.env.BNB-1h
npx hardhat run --network bsc_mainnet scripts/deploy-pair.ts
source config/env/bsc/.env.BNB-1d
npx hardhat run --network bsc_mainnet scripts/deploy-pair.ts

# genesis round
npx hardhat run scripts/runRound/index.ts --network bsc_mainnet

# set referral testers
npx hardhat run scripts/runRound/setReferral.ts --network bsc_mainnet

# start test bot
npx hardhat run scripts/bot/testBet.ts --network bsc_mainnet

npx hardhat run scripts/bot/allClaim.ts --network bsc_mainnet
```

testnet deployment script for Binance smart chain:

```bash
source config/env/bscTestnet/.env.BNB-3min

npx hardhat run --network bsc_testnet scripts/deploy-referral-registry.ts
npx hardhat run --network bsc_testnet scripts/deploy-factory.ts

npx hardhat run --network bsc_testnet scripts/deploy-pair.ts


source config/env/bscTestnet/.env.BNB-1d
npx hardhat run --network bsc_testnet scripts/deploy-pair.ts
source config/env/bscTestnet/.env.BNB-1h
npx hardhat run --network bsc_testnet scripts/deploy-pair.ts
source config/env/bscTestnet/.env.BNB-15min
npx hardhat run --network bsc_testnet scripts/deploy-pair.ts

export OPERATOR_PRIVATE_KEY=""

# genesis round
npx hardhat run scripts/runRound/index.ts --network bsc_testnet

# set referral testers
npx hardhat run scripts/runRound/setReferral.ts --network bsc_testnet

# start test bot
npx hardhat run scripts/bot/testBet.ts --network bsc_testnet

npx hardhat run scripts/bot/allClaim.ts --network bsc_testnet
```

### Deploying a mock ERC20 token

Use `scripts/deploy-mock-erc20.ts` to deploy the mintable `MockERC20` test token to any Hardhat-supported network.

Optional environment overrides (defaults shown):

- `MOCK_ERC20_NAME` (`"Mock USD Coin"`)
- `MOCK_ERC20_SYMBOL` (`"mUSDC"`)
- `MOCK_ERC20_DECIMALS` (`18`)
- `MOCK_ERC20_INITIAL_MINT` – amount to mint after deployment (e.g. `1000`)
- `MOCK_ERC20_MINT_TO` – recipient of the initial mint (defaults to deployer)

Example:

```bash
export MOCK_ERC20_NAME="Mock USD Coin"
export MOCK_ERC20_SYMBOL="mUSDC"
export MOCK_ERC20_DECIMALS=18
export MOCK_ERC20_INITIAL_MINT=1000
export MOCK_ERC20_MINT_TO="0xYourAddress"

npx hardhat run --network bsc_testnet scripts/deploy-mock-erc20.ts
```

### Operation

When a round is started, the round's `lockBlock` and `closeBlock` would be set.

`lockBlock` = current block + `intervalBlocks`

`closeBlock` = current block + (`intervalBlocks` \* 2)

## Kick-start Rounds

The rounds are always kick-started with:

```
genesisStartRound()
(wait for x blocks)
genesisLockRound()
(wait for x blocks)
executeRound()
```

## Continue Running Rounds

```
executeRound()
(wait for x blocks)
executeRound()
(wait for x blocks)
```

## Resuming Rounds

After errors like missing `executeRound()` etc.

```
pause()
(Users can't bet, but still is able to withdraw)
unpause()
startGenesisRound()
(wait for x blocks)
lockGenesisRound()
(wait for x blocks)
executeRound()
```

## Oracle Price

Pyth Network is used as the oracle price source.
https://www.npmjs.com/package/@pythnetwork/pyth-sdk-solidity

## Common Errors

Refer to `test/prediction.test.js`

## Architecture Illustration

### Normal Operation

![normal](images/normal-round.png)

### Missing Round Operation

![missing](images/missing-round.png)

import { BigNumber } from "ethers";
import { ethers, network, run } from "hardhat";

const DEFAULT_NAME = "Mock USD Coin";
const DEFAULT_SYMBOL = "mUSDC";
const DEFAULT_DECIMALS = 18;

function parseDecimals(input: string): number {
  const decimals = Number(input);
  if (!Number.isFinite(decimals) || !Number.isInteger(decimals)) {
    throw new Error(
      `Invalid MOCK_ERC20_DECIMALS value "${input}". Provide an integer between 0 and 255.`
    );
  }

  if (decimals < 0 || decimals > 255) {
    throw new Error(
      `Invalid MOCK_ERC20_DECIMALS value "${input}". Provide an integer between 0 and 255.`
    );
  }
  return decimals;
}

function parseInitialMint(
  value: string | undefined,
  decimals: number
): BigNumber | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  try {
    return ethers.utils.parseUnits(normalized, decimals);
  } catch (error) {
    throw new Error(
      `Invalid MOCK_ERC20_INITIAL_MINT value "${value}". Provide a numeric amount in token units.`
    );
  }
}

const main = async () => {
  const name = process.env.MOCK_ERC20_NAME ?? DEFAULT_NAME;
  const symbol = process.env.MOCK_ERC20_SYMBOL ?? DEFAULT_SYMBOL;
  const decimalsEnv =
    process.env.MOCK_ERC20_DECIMALS ?? DEFAULT_DECIMALS.toString();
  const decimals = parseDecimals(decimalsEnv);
  const initialMint = parseInitialMint(
    process.env.MOCK_ERC20_INITIAL_MINT,
    decimals
  );

  const mintRecipientEnv = process.env.MOCK_ERC20_MINT_TO;
  if (mintRecipientEnv && !ethers.utils.isAddress(mintRecipientEnv)) {
    throw new Error(
      `Invalid MOCK_ERC20_MINT_TO address "${mintRecipientEnv}". Provide a valid EVM address.`
    );
  }

  console.log(
    `Deploying MockERC20 (${name}/${symbol}, decimals ${decimals}) to ${network.name}...`
  );

  await run("compile");
  console.log("Compiled contracts. Deploying token...");

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No signer available from Hardhat. Check your accounts.");
  }

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy(name, symbol, decimals);
  await token.deployed();

  console.log(
    `MockERC20 deployed to ${token.address.toLowerCase()} (deployer: ${deployer.address}).`
  );

  if (initialMint && !initialMint.isZero()) {
    const recipient = ethers.utils.getAddress(
      mintRecipientEnv?.trim() || deployer.address
    );
    const mintTx = await token.mint(recipient, initialMint);
    await mintTx.wait();
    console.log(
      `Minted ${ethers.utils.formatUnits(
        initialMint,
        decimals
      )} tokens to ${recipient} (tx: ${mintTx.hash}).`
    );
  }
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

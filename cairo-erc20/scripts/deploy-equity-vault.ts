/**
 * Deploy EquityVault (ERC-20 factory).
 *
 * Usage:
 *   npx hardhat run scripts/deploy-equity-vault.ts --network sepolia
 *   npx hardhat run scripts/deploy-equity-vault.ts --network mainnet
 */

import "dotenv/config";
import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH\n");

  const Factory = await ethers.getContractFactory("EquityVault");
  const vault   = await Factory.deploy(deployer.address);

  await vault.waitForDeployment();
  const address = await vault.getAddress();

  console.log("EquityVault deployed:", address);
  console.log("\nUpdate .env files:");
  console.log(`EQUITY_VAULT_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

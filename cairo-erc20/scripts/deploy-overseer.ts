/**
 * Deploy Overseer.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-overseer.ts --network sepolia
 *   npx hardhat run scripts/deploy-overseer.ts --network mainnet
 */

import "dotenv/config";
import hre from "hardhat";

async function main() {
  const network = await hre.network.connect();
  const { ethers } = network;

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const BACKEND_SIGNER  = process.env.BACKEND_SIGNER_ADDRESS;
  const MDT_TOKEN       = process.env.CONTRACT_ADDRESS;       // new MaritimeDeposit
  const EQUITY_VAULT    = process.env.EQUITY_VAULT_ADDRESS;
  const OWNER           = process.env.OWNER_WALLET;

  if (!BACKEND_SIGNER) throw new Error("BACKEND_SIGNER_ADDRESS not set");
  if (!MDT_TOKEN)      throw new Error("CONTRACT_ADDRESS not set");
  if (!EQUITY_VAULT)   throw new Error("EQUITY_VAULT_ADDRESS not set");
  if (!OWNER)          throw new Error("OWNER_WALLET not set");

  console.log("backendSigner:", BACKEND_SIGNER);
  console.log("mdtToken:     ", MDT_TOKEN);
  console.log("equityVault:  ", EQUITY_VAULT);
  console.log("owner:        ", OWNER);

  const Factory  = await ethers.getContractFactory("Overseer");
  const overseer = await Factory.deploy(BACKEND_SIGNER, MDT_TOKEN, EQUITY_VAULT, OWNER);
  await overseer.waitForDeployment();

  const addr = await overseer.getAddress();
  console.log("\nDeployed to:", addr);
  console.log("\nNext steps:");
  console.log("  1. Grant MINTER_ROLE  + BURNER_ROLE on MDT to:", addr);
  console.log("  2. Grant MINTER_ROLE  on EquityVault to:", addr);
  console.log("  3. Grant DEFAULT_ADMIN_ROLE on EquityVault to:", addr, "(needed for burnSharesForMDT)");
  console.log("\nAdd to .env:");
  console.log(`  OVERSEER_ADDRESS=${addr}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

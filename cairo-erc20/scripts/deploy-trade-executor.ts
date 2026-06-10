/**
 * Deploy TradeExecutor and grant it the required roles on MDT and EquityVault.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-trade-executor.ts --network sepolia
 *   npx hardhat run scripts/deploy-trade-executor.ts --network mainnet
 */

import "dotenv/config";
import hre from "hardhat";

async function main() {
  const network = await hre.network.connect();
  const { ethers } = network;

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const BACKEND_SIGNER  = process.env.BACKEND_SIGNER_ADDRESS ?? deployer.address;
  const MDT_ADDRESS     = process.env.CONTRACT_ADDRESS!;
  const EQUITY_VAULT    = process.env.EQUITY_VAULT_ADDRESS!;
  const OWNER           = process.env.OWNER_WALLET ?? deployer.address;

  if (!MDT_ADDRESS)  throw new Error("CONTRACT_ADDRESS not set");
  if (!EQUITY_VAULT) throw new Error("EQUITY_VAULT_ADDRESS not set");

  console.log("backendSigner:", BACKEND_SIGNER);
  console.log("mdtToken:     ", MDT_ADDRESS);
  console.log("equityVault:  ", EQUITY_VAULT);
  console.log("owner:        ", OWNER);

  // ── Deploy ──────────────────────────────────────────────────────────────────
  const Factory  = await ethers.getContractFactory("TradeExecutor");
  const executor = await Factory.deploy(BACKEND_SIGNER, MDT_ADDRESS, EQUITY_VAULT, OWNER);
  await executor.waitForDeployment();
  const addr = await executor.getAddress();
  console.log("\nTradeExecutor deployed:", addr);

  // ── Grant roles on MDT ───────────────────────────────────────────────────────
  const mdt = new ethers.Contract(MDT_ADDRESS, [
    "function grantRole(bytes32 role, address account) external",
    "function MINTER_ROLE() view returns (bytes32)",
    "function BURNER_ROLE() view returns (bytes32)",
  ], deployer);

  const MINTER_ROLE = await mdt.MINTER_ROLE();
  const BURNER_ROLE = await mdt.BURNER_ROLE();

  let tx = await mdt.grantRole(BURNER_ROLE, addr);
  await tx.wait();
  console.log("Granted BURNER_ROLE on MDT ✓");

  tx = await mdt.grantRole(MINTER_ROLE, addr);
  await tx.wait();
  console.log("Granted MINTER_ROLE on MDT ✓");

  // ── Grant roles on EquityVault ───────────────────────────────────────────────
  const vault = new ethers.Contract(EQUITY_VAULT, [
    "function grantRole(bytes32 role, address account) external",
    "function MINTER_ROLE() view returns (bytes32)",
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  ], deployer);

  const VAULT_MINTER_ROLE  = await vault.MINTER_ROLE();
  const DEFAULT_ADMIN_ROLE = await vault.DEFAULT_ADMIN_ROLE();

  tx = await vault.grantRole(VAULT_MINTER_ROLE, addr);
  await tx.wait();
  console.log("Granted MINTER_ROLE on EquityVault ✓");

  tx = await vault.grantRole(DEFAULT_ADMIN_ROLE, addr);
  await tx.wait();
  console.log("Granted DEFAULT_ADMIN_ROLE on EquityVault ✓");

  console.log("\nAdd to .env files:");
  console.log(`TRADE_EXECUTOR_ADDRESS=${addr}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

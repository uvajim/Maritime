/**
 * Grant MINTER_ROLE + BURNER_ROLE on MDT and MINTER_ROLE + DEFAULT_ADMIN_ROLE on EquityVault
 * to the Overseer contract.
 */

import "dotenv/config";
import hre from "hardhat";

async function main() {
  const network = await hre.network.connect();
  const { ethers } = network;

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const OVERSEER       = process.env.OVERSEER_ADDRESS!;
  const MDT_ADDRESS    = process.env.CONTRACT_ADDRESS!;
  const EQUITY_VAULT   = process.env.EQUITY_VAULT_ADDRESS!;

  if (!OVERSEER)     throw new Error("OVERSEER_ADDRESS not set");
  if (!MDT_ADDRESS)  throw new Error("CONTRACT_ADDRESS not set");
  if (!EQUITY_VAULT) throw new Error("EQUITY_VAULT_ADDRESS not set");

  const mdt = new ethers.Contract(MDT_ADDRESS, [
    "function grantRole(bytes32 role, address account) external",
    "function MINTER_ROLE() view returns (bytes32)",
    "function BURNER_ROLE() view returns (bytes32)",
  ], deployer);

  const vault = new ethers.Contract(EQUITY_VAULT, [
    "function grantRole(bytes32 role, address account) external",
    "function MINTER_ROLE() view returns (bytes32)",
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  ], deployer);

  const MINTER_ROLE        = await mdt.MINTER_ROLE();
  const BURNER_ROLE        = await mdt.BURNER_ROLE();
  const VAULT_MINTER_ROLE  = await vault.MINTER_ROLE();
  const DEFAULT_ADMIN_ROLE = await vault.DEFAULT_ADMIN_ROLE();

  let tx = await mdt.grantRole(BURNER_ROLE, OVERSEER);
  await tx.wait();
  console.log("Granted BURNER_ROLE on MDT ✓");

  tx = await mdt.grantRole(MINTER_ROLE, OVERSEER);
  await tx.wait();
  console.log("Granted MINTER_ROLE on MDT ✓");

  tx = await vault.grantRole(VAULT_MINTER_ROLE, OVERSEER);
  await tx.wait();
  console.log("Granted MINTER_ROLE on EquityVault ✓");

  tx = await vault.grantRole(DEFAULT_ADMIN_ROLE, OVERSEER);
  await tx.wait();
  console.log("Granted DEFAULT_ADMIN_ROLE on EquityVault ✓");
}

main().catch((e) => { console.error(e); process.exit(1); });

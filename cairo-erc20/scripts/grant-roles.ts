/**
 * Grant roles to TradeExecutor on MDTToken and EquityVault.
 * Run this after deploying all contracts.
 *
 * Required .env vars:
 *   MDT_TOKEN_ADDRESS      — MDTToken contract
 *   EQUITY_VAULT_ADDRESS   — EquityVault contract
 *   TRADE_EXECUTOR_ADDRESS — TradeExecutor contract
 *   DEPLOYER_PRIVATE_KEY   — must hold DEFAULT_ADMIN_ROLE on both contracts
 *
 * Usage:
 *   npx hardhat run scripts/grant-roles.ts --network sepolia
 *   npx hardhat run scripts/grant-roles.ts --network mainnet
 */

import "dotenv/config";
import hre from "hardhat";

const MDT_ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
];

const VAULT_ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
];

async function main() {
  const network = await hre.network.connect();
  const { ethers } = network;

  const [deployer] = await ethers.getSigners();
  console.log("Network:         ", network.networkName);
  console.log("Deployer:        ", deployer.address);

  const MDT_TOKEN      = process.env.MDT_TOKEN_ADDRESS!;
  const EQUITY_VAULT   = process.env.EQUITY_VAULT_ADDRESS!;
  const TRADE_EXECUTOR = process.env.TRADE_EXECUTOR_ADDRESS!;

  if (!MDT_TOKEN || !EQUITY_VAULT || !TRADE_EXECUTOR) {
    throw new Error("MDT_TOKEN_ADDRESS, EQUITY_VAULT_ADDRESS and TRADE_EXECUTOR_ADDRESS must all be set");
  }

  console.log("MDTToken:        ", MDT_TOKEN);
  console.log("EquityVault:     ", EQUITY_VAULT);
  console.log("TradeExecutor:   ", TRADE_EXECUTOR);

  const MINTER_ROLE       = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const BURNER_ROLE       = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  const mdt   = new ethers.Contract(MDT_TOKEN,    MDT_ABI,   deployer);
  const vault = new ethers.Contract(EQUITY_VAULT, VAULT_ABI, deployer);

  // ── MDTToken roles ────────────────────────────────────────────────────────
  // TradeExecutor needs BURNER_ROLE (adminBurn on buy) and MINTER_ROLE (mintTradePayout on sell)

  console.log("\n── MDTToken roles ──────────────────────────────────────────");

  const mdtMinter = await mdt.hasRole(MINTER_ROLE, TRADE_EXECUTOR);
  if (!mdtMinter) {
    process.stdout.write("Granting MINTER_ROLE on MDTToken... ");
    await (await mdt.grantRole(MINTER_ROLE, TRADE_EXECUTOR)).wait();
    console.log("done.");
  } else {
    console.log("MINTER_ROLE on MDTToken: already granted.");
  }

  const mdtBurner = await mdt.hasRole(BURNER_ROLE, TRADE_EXECUTOR);
  if (!mdtBurner) {
    process.stdout.write("Granting BURNER_ROLE on MDTToken... ");
    await (await mdt.grantRole(BURNER_ROLE, TRADE_EXECUTOR)).wait();
    console.log("done.");
  } else {
    console.log("BURNER_ROLE on MDTToken: already granted.");
  }

  // ── EquityVault roles ─────────────────────────────────────────────────────
  // TradeExecutor needs MINTER_ROLE (mint on buy) and DEFAULT_ADMIN_ROLE (burnSharesForMDT on sell)

  console.log("\n── EquityVault roles ───────────────────────────────────────");

  const vaultMinter = await vault.hasRole(MINTER_ROLE, TRADE_EXECUTOR);
  if (!vaultMinter) {
    process.stdout.write("Granting MINTER_ROLE on EquityVault... ");
    await (await vault.grantRole(MINTER_ROLE, TRADE_EXECUTOR)).wait();
    console.log("done.");
  } else {
    console.log("MINTER_ROLE on EquityVault: already granted.");
  }

  const vaultAdmin = await vault.hasRole(DEFAULT_ADMIN_ROLE, TRADE_EXECUTOR);
  if (!vaultAdmin) {
    process.stdout.write("Granting DEFAULT_ADMIN_ROLE on EquityVault... ");
    await (await vault.grantRole(DEFAULT_ADMIN_ROLE, TRADE_EXECUTOR)).wait();
    console.log("done.");
  } else {
    console.log("DEFAULT_ADMIN_ROLE on EquityVault: already granted.");
  }

  console.log("\n✓ All roles granted. TradeExecutor is ready to execute trades.");
}

main().catch((e) => { console.error(e); process.exit(1); });

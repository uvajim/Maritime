/**
 * Transfer admin/ownership roles on MDT and EquityVault to a new address,
 * and send all USDC from the deployer to that address.
 *
 * Usage:
 *   npx hardhat run scripts/transfer-admin.ts --network sepolia
 *   npx hardhat run scripts/transfer-admin.ts --network mainnet
 */

import "dotenv/config";
import hre from "hardhat";
import { getStablecoins } from "./addresses";

const NEW_OWNER = "0x6632a1c1748C6AA22E3beeE74C9fc5b385A09520";

const ACCESS_CONTROL_ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function MINTER_ROLE() view returns (bytes32)",
  "function BURNER_ROLE() view returns (bytes32)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

async function main() {
  const network = await hre.network.connect();
  const { ethers } = network;

  const networkName = network.networkName;
  const { USDC: NETWORK_USDC } = getStablecoins(networkName);

  const [deployer] = await ethers.getSigners();
  console.log("Network:", networkName);
  console.log("Deployer:", deployer.address);
  console.log("New owner:", NEW_OWNER, "\n");

  const MDT_ADDRESS         = process.env.CONTRACT_ADDRESS!;
  const EQUITY_VAULT_ADDRESS = process.env.EQUITY_VAULT_ADDRESS!;

  if (!MDT_ADDRESS)          throw new Error("CONTRACT_ADDRESS not set");
  if (!EQUITY_VAULT_ADDRESS) throw new Error("EQUITY_VAULT_ADDRESS not set");

  const mdt   = new ethers.Contract(MDT_ADDRESS,          ACCESS_CONTROL_ABI, deployer);
  const vault = new ethers.Contract(EQUITY_VAULT_ADDRESS, ACCESS_CONTROL_ABI, deployer);

  const DEFAULT_ADMIN_ROLE = await mdt.DEFAULT_ADMIN_ROLE();
  const MINTER_ROLE        = await mdt.MINTER_ROLE();
  const BURNER_ROLE        = await mdt.BURNER_ROLE();

  // ── MDT roles ──────────────────────────────────────────────────────────────
  console.log("── MDT:", MDT_ADDRESS);
  for (const [label, role] of [
    ["DEFAULT_ADMIN_ROLE", DEFAULT_ADMIN_ROLE],
    ["MINTER_ROLE",        MINTER_ROLE],
    ["BURNER_ROLE",        BURNER_ROLE],
  ] as [string, string][]) {
    const already = await mdt.hasRole(role, NEW_OWNER);
    if (already) {
      console.log(`  ${label} already granted — skipping`);
    } else {
      const tx = await mdt.grantRole(role, NEW_OWNER);
      await tx.wait();
      console.log(`  Granted ${label} ✓`);
    }
  }

  // ── EquityVault roles ──────────────────────────────────────────────────────
  console.log("\n── EquityVault:", EQUITY_VAULT_ADDRESS);
  const vaultMinterRole = await (vault as any).MINTER_ROLE();
  for (const [label, role] of [
    ["DEFAULT_ADMIN_ROLE", DEFAULT_ADMIN_ROLE],
    ["MINTER_ROLE",        vaultMinterRole],
  ] as [string, string][]) {
    const already = await vault.hasRole(role, NEW_OWNER);
    if (already) {
      console.log(`  ${label} already granted — skipping`);
    } else {
      const tx = await vault.grantRole(role, NEW_OWNER);
      await tx.wait();
      console.log(`  Granted ${label} ✓`);
    }
  }

  // ── USDC transfer ──────────────────────────────────────────────────────────
  console.log("\n── USDC:", NETWORK_USDC);
  const usdc    = new ethers.Contract(NETWORK_USDC, ERC20_ABI, deployer);
  const balance = await usdc.balanceOf(deployer.address);

  if (balance === 0n) {
    console.log("  No USDC balance — skipping");
  } else {
    const decimals    = await usdc.decimals();
    const displayAmt  = (Number(balance) / 10 ** decimals).toFixed(decimals);
    console.log(`  Balance: ${displayAmt} USDC`);
    const tx = await usdc.transfer(NEW_OWNER, balance);
    await tx.wait();
    console.log(`  Transferred ${displayAmt} USDC to ${NEW_OWNER} ✓`);
  }

  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });

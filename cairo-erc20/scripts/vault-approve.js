/**
 * One-time setup: vault approves the contract to pull stablecoins for withdrawals.
 * Run this once after every new deployment.
 *
 * Usage:
 *   npx hardhat run scripts/vault-approve.js
 */

import "dotenv/config";
import hre from "hardhat";
import { getStablecoins } from "./addresses.js";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

async function main() {
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not set in .env");

  const network = await hre.network.connect();
  const { ethers } = network;
  const { USDC, USDT } = getStablecoins(network.networkName);
  const signers = await ethers.getSigners();
  const vault   = signers[2]; // VAULT_PRIVATE_KEY (index 2)

  console.log(`\nNetwork:      ${network.networkName}`);
  console.log(`Vault wallet: ${vault.address}`);
  console.log(`Contract:     ${CONTRACT_ADDRESS}`);

  const usdc = new ethers.Contract(USDC, ERC20_ABI, vault);
  const usdt = new ethers.Contract(USDT, ERC20_ABI, vault);

  // Approve USDC
  const usdcAllowance = await usdc.allowance(vault.address, CONTRACT_ADDRESS);
  if (usdcAllowance === ethers.MaxUint256) {
    console.log("\nUSDC already approved at MaxUint256, skipping.");
  } else {
    console.log("\nApproving USDC...");
    const tx = await usdc.approve(CONTRACT_ADDRESS, ethers.MaxUint256);
    await tx.wait();
    console.log("USDC approved. Tx:", tx.hash);
  }

  // Approve USDT
  const usdtAllowance = await usdt.allowance(vault.address, CONTRACT_ADDRESS);
  if (usdtAllowance === ethers.MaxUint256) {
    console.log("USDT already approved at MaxUint256, skipping.");
  } else {
    console.log("\nApproving USDT...");
    const tx = await usdt.approve(CONTRACT_ADDRESS, ethers.MaxUint256);
    await tx.wait();
    console.log("USDT approved. Tx:", tx.hash);
  }

  console.log("\nVault setup complete. Withdrawals are now enabled.");
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Admin-burn MDT from any address (BURNER_ROLE only).
 *
 * Usage:
 *   FROM=0x... AMOUNT=100 npx hardhat run scripts/force-burn.js
 */

import "dotenv/config";
import hre from "hardhat";

const MDT_ABI = [
  "function adminBurn(address from, uint256 amount) external",
  "function balanceOf(address) view returns (uint256)",
];

async function main() {
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not set in .env");

  const from      = process.env.FROM;
  const amountStr = process.env.AMOUNT;
  if (!from)      throw new Error("FROM not set — run with FROM=0x...");
  if (!amountStr) throw new Error("AMOUNT not set — run with AMOUNT=100");

  const network = await hre.network.connect();
  const { ethers } = network;
  const [owner] = await ethers.getSigners(); // DEPLOYER_PRIVATE_KEY must be the contract owner

  const amount = ethers.parseUnits(amountStr, 6);
  const mdt    = new ethers.Contract(CONTRACT_ADDRESS, MDT_ABI, owner);

  const balanceBefore = await mdt.balanceOf(from);
  console.log(`Owner:          ${owner.address}`);
  console.log(`Burning from:   ${from}`);
  console.log(`Amount:         ${amountStr} MDT`);
  console.log(`Balance before: ${ethers.formatUnits(balanceBefore, 6)} MDT`);

  const tx = await mdt.adminBurn(from, amount);
  console.log("Tx hash:", tx.hash);
  await tx.wait();

  const balanceAfter = await mdt.balanceOf(from);
  console.log(`Balance after:  ${ethers.formatUnits(balanceAfter, 6)} MDT`);
}

main().catch((e) => { console.error(e); process.exit(1); });

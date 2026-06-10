/**
 * Mint MDT directly to any address (owner only, no stablecoin required).
 *
 * Usage:
 *   TO=0x... AMOUNT=100 npx hardhat run scripts/owner-mint-mdt.js
 */

import "dotenv/config";
import hre from "hardhat";

const MDT_ABI = [
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address) view returns (uint256)",
];

async function main() {
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not set in .env");

  const to        = process.env.TO;
  const amountStr = process.env.AMOUNT;
  if (!to)        throw new Error("TO not set — run with TO=0x...");
  if (!amountStr) throw new Error("AMOUNT not set — run with AMOUNT=100");

  const network = await hre.network.connect();
  const { ethers } = network;
  const [owner] = await ethers.getSigners(); // DEPLOYER_PRIVATE_KEY must be the contract owner

  const amount = ethers.parseUnits(amountStr, 6);
  const mdt    = new ethers.Contract(CONTRACT_ADDRESS, MDT_ABI, owner);

  console.log(`Owner:  ${owner.address}`);
  console.log(`Minting ${amountStr} MDT → ${to}`);

  const tx = await mdt.mint(to, amount);
  console.log("Tx hash:", tx.hash);
  await tx.wait();

  const balance = await mdt.balanceOf(to);
  console.log(`New MDT balance: ${ethers.formatUnits(balance, 6)} MDT`);
}

main().catch((e) => { console.error(e); process.exit(1); });

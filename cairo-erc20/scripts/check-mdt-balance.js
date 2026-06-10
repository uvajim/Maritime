/**
 * Check a user's MDT balance.
 * The MaritimeDeposit contract address IS the MDT token address.
 *
 * Usage:
 *   USER_ADDRESS=0x... npx hardhat run scripts/check-mdt-balance.js
 */

import "dotenv/config";
import hre from "hardhat";

const MDT_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
];

async function main() {
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not set in .env");

  const userAddress = process.env.USER_ADDRESS;
  if (!userAddress) throw new Error("USER_ADDRESS not set — run with USER_ADDRESS=0x... npx hardhat run ...");

  // In a browser: new ethers.BrowserProvider(window.ethereum)
  // USER_ADDRESS can be any wallet — no signer needed for a view call
  const network = await hre.network.connect();
  const { ethers } = network;

  const mdt = new ethers.Contract(CONTRACT_ADDRESS, MDT_ABI, ethers.provider);

  const [balance, totalSupply] = await Promise.all([
    mdt.balanceOf(userAddress),
    mdt.totalSupply(),
  ]);

  console.log("User:         ", userAddress);
  console.log("MDT balance:  ", ethers.formatUnits(balance, 6), "MDT");
  console.log("Total supply: ", ethers.formatUnits(totalSupply, 6), "MDT");
}

main().catch((e) => { console.error(e); process.exit(1); });

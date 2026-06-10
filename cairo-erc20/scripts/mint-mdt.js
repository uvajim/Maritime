/**
 * Mint X MDT by depositing the equivalent USDC or USDT.
 * MDT is minted 1:1 with the deposited stablecoin (6 decimals).
 *
 * Usage:
 *   AMOUNT=100 npx hardhat run scripts/mint-mdt.js
 *   AMOUNT=100 TOKEN=USDT USER_ID=user-001 npx hardhat run scripts/mint-mdt.js
 */

import "dotenv/config";
import hre from "hardhat";
import { getStablecoins } from "./addresses.js";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const MDT_ABI = [
  "function deposit(address token, uint256 amount, bytes32 userId) external",
  "function balanceOf(address) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

async function main() {
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not set in .env");

  const amountStr   = process.env.AMOUNT;
  if (!amountStr) throw new Error("AMOUNT not set — run with AMOUNT=100 npx hardhat run ...");

  const tokenSymbol = (process.env.TOKEN || "USDC").toUpperCase();
  if (tokenSymbol !== "USDC" && tokenSymbol !== "USDT") {
    throw new Error("TOKEN must be USDC or USDT");
  }

  const userIdStr = process.env.USER_ID || "mint";

  const network = await hre.network.connect();
  const { ethers } = network;
  const { USDC, USDT } = getStablecoins(network.networkName);
  const [, signer] = await ethers.getSigners(); // USER_PRIVATE_KEY (index 1)

  const tokenAddress = tokenSymbol === "USDC" ? USDC : USDT;
  const amount = ethers.parseUnits(amountStr, 6); // 6 decimals = 1 MDT per 1 stablecoin unit
  const userId = ethers.encodeBytes32String(userIdStr);

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const mdt   = new ethers.Contract(CONTRACT_ADDRESS, MDT_ABI, signer);

  console.log(`Minting ${amountStr} MDT via ${tokenSymbol} deposit`);
  console.log(`Wallet: ${signer.address}`);

  // Check stablecoin balance
  const balance = await token.balanceOf(signer.address);
  if (balance < amount) {
    throw new Error(
      `Insufficient ${tokenSymbol}: have ${ethers.formatUnits(balance, 6)}, need ${amountStr}`
    );
  }

  // Approve if needed
  const allowance = await token.allowance(signer.address, CONTRACT_ADDRESS);
  if (allowance < amount) {
    console.log(`Approving ${amountStr} ${tokenSymbol}...`);
    const tx = await token.approve(CONTRACT_ADDRESS, amount);
    await tx.wait();
    console.log("Approved.");
  }

  // Deposit stablecoin → mint MDT 1:1
  console.log(`Depositing ${amountStr} ${tokenSymbol}...`);
  const tx = await mdt.deposit(tokenAddress, amount, userId);
  console.log("Tx hash:", tx.hash);

  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);

  // Find the MDT mint event (Transfer from address(0))
  for (const log of receipt.logs) {
    try {
      const parsed = mdt.interface.parseLog(log);
      if (parsed.name === "Transfer" && parsed.args.from === ethers.ZeroAddress) {
        console.log(`Minted: ${ethers.formatUnits(parsed.args.value, 6)} MDT → ${parsed.args.to}`);
      }
    } catch { /* skip logs from other contracts */ }
  }

  const mdtBalance = await mdt.balanceOf(signer.address);
  console.log(`New MDT balance: ${ethers.formatUnits(mdtBalance, 6)} MDT`);
}

main().catch((e) => { console.error(e); process.exit(1); });

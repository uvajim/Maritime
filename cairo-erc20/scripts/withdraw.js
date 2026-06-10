/**
 * Withdraw USDC or USDT from MaritimeDeposit by returning MDT.
 * Stablecoins are paid out from the vault (not the contract).
 * The vault must have pre-approved this contract before withdrawals work.
 *
 * Usage:
 *   TOKEN=USDC AMOUNT=10 npx hardhat run scripts/withdraw.js
 *   TOKEN=USDT AMOUNT=50 npx hardhat run scripts/withdraw.js
 */

import "dotenv/config";
import hre from "hardhat";
import { getStablecoins } from "./addresses.js";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
];

const CONTRACT_ABI = [
  "function withdraw(address token, uint256 amount) external",
  "function balanceOf(address) view returns (uint256)",
  "function vault() view returns (address)",
  "function vaultBalance(address token) view returns (uint256)",
  "event Withdrawn(address indexed user, address indexed token, uint256 amount, uint256 timestamp)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

async function main() {
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not set in .env");

  const tokenSymbol = (process.env.TOKEN || "USDC").toUpperCase();
  const amountStr   = process.env.AMOUNT || "1";

  if (tokenSymbol !== "USDC" && tokenSymbol !== "USDT") {
    throw new Error("TOKEN must be USDC or USDT");
  }

  const network = await hre.network.connect();
  const { ethers } = network;
  const { USDC, USDT } = getStablecoins(network.networkName);
  const signers = await ethers.getSigners();
  const signer  = signers[1]; // USER_PRIVATE_KEY (index 1)

  const tokenAddress = tokenSymbol === "USDC" ? USDC : USDT;
  const amount       = ethers.parseUnits(amountStr, 6);

  const maritime = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
  const token    = new ethers.Contract(tokenAddress, ERC20_ABI, signer);

  console.log(`\nWallet:  ${signer.address}`);
  console.log(`Token:   ${tokenSymbol} (${tokenAddress})`);
  console.log(`Amount:  ${amountStr} ${tokenSymbol}`);

  const vaultAddress = await maritime.vault();
  console.log(`\nVault:   ${vaultAddress}`);

  // Check MDT balance
  const mdtBalance = await maritime.balanceOf(signer.address);
  console.log(`MDT balance:      ${ethers.formatUnits(mdtBalance, 6)} MDT`);
  if (mdtBalance < amount) {
    throw new Error(
      `Insufficient MDT: have ${ethers.formatUnits(mdtBalance, 6)}, need ${amountStr}`
    );
  }

  // Check vault stablecoin balance
  const vaultBal = await maritime.vaultBalance(tokenAddress);
  console.log(`Vault ${tokenSymbol} balance: ${ethers.formatUnits(vaultBal, 6)} ${tokenSymbol}`);
  if (vaultBal < amount) {
    throw new Error(
      `Insufficient ${tokenSymbol} in vault: ` +
      `have ${ethers.formatUnits(vaultBal, 6)}, need ${amountStr}. ` +
      `Vault wallet must be funded first.`
    );
  }

  // Simulate first to surface the exact revert reason before sending a real tx
  console.log("\nSimulating withdrawal...");
  try {
    await maritime.withdraw.staticCall(tokenAddress, amount);
  } catch (e) {
    const reason = e?.revert?.name ?? e?.reason ?? e?.message ?? String(e);
    throw new Error(`Simulation failed — withdraw() would revert: ${reason}`);
  }
  console.log("Simulation passed.");

  // Withdraw — no MDT approval needed, MDT moves directly from caller to contract
  console.log(`\nWithdrawing ${amountStr} ${tokenSymbol}...`);
  let tx;
  try {
    tx = await maritime.withdraw(tokenAddress, amount);
  } catch (e) {
    const reason = e?.revert?.name ?? e?.reason ?? e?.message ?? String(e);
    throw new Error(`withdraw() reverted: ${reason}`);
  }
  console.log("Tx hash:", tx.hash);

  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);

  // Parse events
  for (const log of receipt.logs) {
    try {
      const parsed = maritime.interface.parseLog(log);

      if (parsed.name === "Withdrawn") {
        console.log("\n── Withdrawn ─────────────────────────────────");
        console.log("user:   ", parsed.args.user);
        console.log("token:  ", parsed.args.token);
        console.log("amount: ", ethers.formatUnits(parsed.args.amount, 6), tokenSymbol);
        console.log("time:   ", new Date(Number(parsed.args.timestamp) * 1000).toISOString());
      }

      if (parsed.name === "Transfer" && parsed.args.to === CONTRACT_ADDRESS) {
        console.log("\n── MDT Returned to Contract ──────────────────");
        console.log("from:   ", parsed.args.from);
        console.log("amount: ", ethers.formatUnits(parsed.args.value, 6), "MDT");
      }
    } catch {
      // log from stablecoin contract, skip
    }
  }

  const newMdtBalance = await maritime.balanceOf(signer.address);
  console.log("\nNew MDT balance:", ethers.formatUnits(newMdtBalance, 6), "MDT");
}

main().catch((e) => { console.error(e); process.exit(1); });

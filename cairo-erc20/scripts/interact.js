/**
 * MaritimeDeposit – frontend interaction reference
 *
 * This script shows a frontend how to:
 *   1. Read USDC / USDT balances and allowances
 *   2. Read the user's MDT balance
 *   3. Approve the contract to spend stablecoins
 *   4. Call deposit() — which pulls stablecoins, forwards to owner, and mints MDT to caller
 *   5. Listen for the Deposited and Transfer(mint) events
 *
 * In a browser frontend replace the ethers.getSigners() call with a
 * BrowserProvider + getSigner() from MetaMask / WalletConnect.
 */

import "dotenv/config";
import hre from "hardhat";
import { getStablecoins } from "./addresses.js";

// ─── ABIs (minimal — only what the frontend needs) ────────────────────────────

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

// MaritimeDeposit is itself an ERC-20 (MDT) plus the deposit contract.
const CONTRACT_ABI = [
  // ── ERC-20 (MDT token) ──
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",

  // ── Deposit ──
  "function deposit(address token, uint256 amount, bytes32 userId) external",
  "function supportedTokens() view returns (address usdc, address usdt)",
  "function minDepositUSDC() view returns (uint256)",
  "function minDepositUSDT() view returns (uint256)",

  // ── Events ──
  "event Deposited(address indexed user, address indexed token, uint256 amount, bytes32 indexed userId, uint256 timestamp)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not set in .env");

  // In a browser: replace these two lines with
  //   const provider = new ethers.BrowserProvider(window.ethereum);
  //   const signer   = await provider.getSigner();
  const network = await hre.network.connect();
  const { ethers } = network;
  const { USDC, USDT } = getStablecoins(network.networkName);
  const [signer] = await ethers.getSigners();
  console.log("Network:", network.networkName);
  console.log("Wallet:", signer.address);

  const usdc     = new ethers.Contract(USDC, ERC20_ABI, signer);
  const usdt     = new ethers.Contract(USDT, ERC20_ABI, signer);
  const maritime = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

  // ── 1. Read balances ────────────────────────────────────────────────────────

  const [usdcBal, usdtBal, mdtBal, mdtSupply, minUsdc, minUsdt] = await Promise.all([
    usdc.balanceOf(signer.address),
    usdt.balanceOf(signer.address),
    maritime.balanceOf(signer.address),
    maritime.totalSupply(),
    maritime.minDepositUSDC(),
    maritime.minDepositUSDT(),
  ]);

  console.log("\n── Balances ──────────────────────────────────");
  console.log("USDC:          ", ethers.formatUnits(usdcBal,  6));
  console.log("USDT:          ", ethers.formatUnits(usdtBal,  6));
  console.log("MDT (yours):   ", ethers.formatUnits(mdtBal,   6));
  console.log("MDT total supply:", ethers.formatUnits(mdtSupply, 6));
  console.log("Min deposit USDC:", ethers.formatUnits(minUsdc, 6));
  console.log("Min deposit USDT:", ethers.formatUnits(minUsdt, 6));

  // ── 2. Deposit USDC ─────────────────────────────────────────────────────────

  const token  = USDC;
  const amount = ethers.parseUnits("10", 6);   // 10 USDC
  const userId = ethers.encodeBytes32String("user-001");  // your app's user ID

  if (usdcBal < amount) {
    throw new Error(`Insufficient USDC: have ${ethers.formatUnits(usdcBal, 6)}, need 10`);
  }

  // Step A: approve if allowance is too low
  const allowance = await usdc.allowance(signer.address, CONTRACT_ADDRESS);
  if (allowance < amount) {
    console.log("\nApproving USDC...");
    const approveTx = await usdc.approve(CONTRACT_ADDRESS, amount);
    await approveTx.wait();
    console.log("Approved.");
  }

  // Step B: deposit — single tx that does all four steps:
  //   transferFrom(user → contract) → transfer(contract → owner)
  //   → mint MDT → credit MDT to user
  //   User (signer) pays all gas.
  console.log("\nDepositing 10 USDC...");
  const tx = await maritime.deposit(token, amount, userId);
  console.log("Tx hash:", tx.hash);

  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);

  // ── 3. Parse events from the receipt ───────────────────────────────────────

  for (const log of receipt.logs) {
    try {
      const parsed = maritime.interface.parseLog(log);

      if (parsed.name === "Deposited") {
        console.log("\n── Deposited event ───────────────────────────");
        console.log("user:     ", parsed.args.user);
        console.log("token:    ", parsed.args.token);
        console.log("amount:   ", ethers.formatUnits(parsed.args.amount, 6));
        console.log("userId:   ", ethers.decodeBytes32String(parsed.args.userId));
        console.log("timestamp:", new Date(Number(parsed.args.timestamp) * 1000).toISOString());
      }

      // Transfer from address(0) = mint event
      if (parsed.name === "Transfer" && parsed.args.from === ethers.ZeroAddress) {
        console.log("\n── MDT Minted ────────────────────────────────");
        console.log("to:     ", parsed.args.to);
        console.log("amount: ", ethers.formatUnits(parsed.args.value, 6), "MDT");
      }
    } catch {
      // log belongs to USDC contract, skip
    }
  }

  // ── 4. Confirm updated MDT balance ─────────────────────────────────────────

  const newMdtBal = await maritime.balanceOf(signer.address);
  console.log("\nNew MDT balance:", ethers.formatUnits(newMdtBal, 6), "MDT");
}

main().catch((e) => { console.error(e); process.exit(1); });

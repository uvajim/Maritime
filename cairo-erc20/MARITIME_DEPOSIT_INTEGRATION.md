# MaritimeDeposit — Frontend Integration Guide

This document describes the complete flow for integrating the MaritimeDeposit smart contract into a frontend. Feed this to Claude Code when building the UI.

---

## Overview

The `MaritimeDeposit` contract at `CONTRACT_ADDRESS` does two things:

1. **It is the deposit handler** — accepts USDC or USDT from users and routes them to a vault.
2. **It is the MDT ERC-20 token itself** — the same contract address is the token address.

There is no separate token contract to deploy or interact with. The contract address is the MDT token address.

---

## Addresses (Sepolia testnet)

```
CONTRACT_ADDRESS = 0xE7ef0924D1545515cA322E613D66CcC269CF6010   ← also the MDT token address
USDC             = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
USDT             = 0x7169D38820dfd117C3FA1f22a697dBA58d90BA06
```

---

## ABI

Use this minimal ABI for all frontend interactions:

```js
const CONTRACT_ABI = [
  // ── MDT token (ERC-20) ──
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",

  // ── Deposit / Withdrawal ──
  "function deposit(address token, uint256 amount, bytes32 userId) external",
  "function withdraw(address token, uint256 amount) external",

  // ── Views ──
  "function supportedTokens() view returns (address usdc, address usdt)",
  "function vaultBalance(address token) view returns (uint256)",
  "function minDepositUSDC() view returns (uint256)",
  "function minDepositUSDT() view returns (uint256)",
  "function vault() view returns (address)",

  // ── Events ──
  "event Deposited(address indexed user, address indexed token, uint256 amount, bytes32 indexed userId, uint256 timestamp)",
  "event Withdrawn(address indexed user, address indexed token, uint256 amount, uint256 timestamp)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];
```

---

## Token details

| Property | Value |
|---|---|
| Name | Maritime Deposit Token |
| Symbol | MDT |
| Decimals | 6 |
| Ratio | 1 MDT = 1 USDC = 1 USDT |

All amounts use 6 decimal places, same as USDC and USDT.

```js
// Convert human-readable to raw units
const amount = ethers.parseUnits("10", 6)   // "10" → 10000000n

// Convert raw units to human-readable
const display = ethers.formatUnits(amount, 6) // 10000000n → "10.0"
```

---

## Connecting a wallet (browser)

```js
import { ethers } from "ethers";

// MetaMask / any EIP-1193 wallet
const provider = new ethers.BrowserProvider(window.ethereum);
const signer   = await provider.getSigner();

const maritime = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
const usdc     = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
const usdt     = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, signer);
```

---

## Reading balances

```js
const userAddress = await signer.getAddress();

const [usdcBalance, usdtBalance, mdtBalance, vaultUsdc, vaultUsdt] = await Promise.all([
  usdc.balanceOf(userAddress),
  usdt.balanceOf(userAddress),
  maritime.balanceOf(userAddress),       // user's MDT balance
  maritime.vaultBalance(USDC_ADDRESS),   // available USDC for withdrawals
  maritime.vaultBalance(USDT_ADDRESS),   // available USDT for withdrawals
]);

console.log("USDC:", ethers.formatUnits(usdcBalance, 6));
console.log("USDT:", ethers.formatUnits(usdtBalance, 6));
console.log("MDT:",  ethers.formatUnits(mdtBalance,  6));
```

---

## Deposit flow

The user deposits USDC or USDT. Stablecoins go directly to the vault. MDT is minted 1:1 to the user. The user pays all gas.

### Step 1 — Approve (only if allowance is insufficient)

```js
const tokenContract = token === "USDC" ? usdc : usdt;
const tokenAddress  = token === "USDC" ? USDC_ADDRESS : USDT_ADDRESS;
const amount        = ethers.parseUnits(humanAmount, 6);

const allowance = await tokenContract.allowance(userAddress, CONTRACT_ADDRESS);
if (allowance < amount) {
  const approveTx = await tokenContract.approve(CONTRACT_ADDRESS, amount);
  await approveTx.wait();
}
```

### Step 2 — Deposit

`userId` is your app's internal user identifier encoded as bytes32 (max 31 ASCII characters).

```js
const userId = ethers.encodeBytes32String("your-user-id");

const tx      = await maritime.deposit(tokenAddress, amount, userId);
const receipt = await tx.wait();
```

### Step 3 — Read the result from events

```js
for (const log of receipt.logs) {
  try {
    const parsed = maritime.interface.parseLog(log);

    if (parsed.name === "Deposited") {
      console.log("Deposited:", ethers.formatUnits(parsed.args.amount, 6), token);
      console.log("User ID:",   ethers.decodeBytes32String(parsed.args.userId));
      console.log("Time:",      new Date(Number(parsed.args.timestamp) * 1000).toISOString());
    }

    // Transfer from address(0) = MDT mint event
    if (parsed.name === "Transfer" && parsed.args.from === ethers.ZeroAddress) {
      console.log("MDT minted:", ethers.formatUnits(parsed.args.value, 6), "MDT");
    }
  } catch {
    // log belongs to the stablecoin contract, skip
  }
}
```

---

## Withdrawal flow

The user returns MDT to receive stablecoins back from the vault. MDT moves to the contract (kept alive, not burned). No MDT approval is needed — the contract pulls directly from `msg.sender`. The user chooses whether to receive USDC or USDT regardless of what they deposited.

### Step 1 — Check vault has sufficient balance

```js
const tokenAddress = token === "USDC" ? USDC_ADDRESS : USDT_ADDRESS;
const amount       = ethers.parseUnits(humanAmount, 6);

const vaultBal = await maritime.vaultBalance(tokenAddress);
if (vaultBal < amount) {
  throw new Error(`Insufficient vault balance for ${token} withdrawal`);
}
```

### Step 2 — Check user has sufficient MDT

```js
const mdtBalance = await maritime.balanceOf(userAddress);
if (mdtBalance < amount) {
  throw new Error("Insufficient MDT balance");
}
```

### Step 3 — Withdraw (no approve needed)

```js
const tx      = await maritime.withdraw(tokenAddress, amount);
const receipt = await tx.wait();
```

### Step 4 — Read the result from events

```js
for (const log of receipt.logs) {
  try {
    const parsed = maritime.interface.parseLog(log);

    if (parsed.name === "Withdrawn") {
      console.log("Withdrew:", ethers.formatUnits(parsed.args.amount, 6), token);
    }

    // Transfer to contract address = MDT returned to contract
    if (parsed.name === "Transfer" && parsed.args.to === CONTRACT_ADDRESS) {
      console.log("MDT returned:", ethers.formatUnits(parsed.args.value, 6), "MDT");
    }
  } catch {
    // log from stablecoin contract, skip
  }
}
```

---

## Adding MDT to MetaMask

Prompt the user to add MDT to their wallet after their first deposit:

```js
await window.ethereum.request({
  method: "wallet_watchAsset",
  params: {
    type: "ERC20",
    options: {
      address: CONTRACT_ADDRESS,   // MDT token address = contract address
      symbol:  "MDT",
      decimals: 6,
    },
  },
});
```

---

## Error handling

The contract uses custom errors. Map them to user-friendly messages:

```js
function parseContractError(e) {
  const name = e?.revert?.name ?? e?.reason ?? "";

  const messages = {
    UnsupportedToken:        "That token is not supported. Use USDC or USDT.",
    BelowMinimum:            "Amount is below the minimum deposit.",
    InsufficientVaultBalance:"Withdrawals are temporarily unavailable. Try again later.",
    InsufficientBalance:     "Insufficient MDT balance.",
    InsufficientAllowance:   "Please approve the contract to spend your tokens first.",
    TransferFailed:          "Token transfer failed.",
  };

  return messages[name] ?? "Transaction failed. Please try again.";
}
```

---

## Wallet roles

| Role | Description |
|---|---|
| **User** | Calls `deposit()` and `withdraw()`. Uses their own MetaMask wallet. |
| **Vault** | Holds stablecoin reserves. Must pre-approve the contract once after each deployment. Never exposed to the frontend. |
| **Owner** | Admin wallet. Can call `rescue()` to recover stuck tokens. Never exposed to the frontend. |

---

## Environment variables (.env)

```
DEPLOYER_PRIVATE_KEY=   # index 0 — deploys contracts
USER_PRIVATE_KEY=       # index 1 — deposit/withdraw scripts
VAULT_PRIVATE_KEY=      # index 2 — vault approval script

SEPOLIA_RPC_URL=
MAINNET_RPC_URL=

OWNER_WALLET=
VAULT_WALLET=
CONTRACT_ADDRESS=
```

---

## Scripts

| Script | Command | Who runs it |
|---|---|---|
| Deploy contract | `npx hardhat run scripts/deploy.js` | Deployer, once per deployment |
| Vault approval | `npx hardhat run scripts/vault-approve.js` | Vault wallet, once per deployment |
| Deposit | `TOKEN=USDC AMOUNT=10 USER_ID=user-001 npx hardhat run scripts/deposit.js` | User / testing |
| Withdraw | `TOKEN=USDC AMOUNT=10 npx hardhat run scripts/withdraw.js` | User / testing |
| Check MDT balance | `USER_ADDRESS=0x... npx hardhat run scripts/check-mdt-balance.js` | Anyone |
| Run tests | `npx hardhat test test/MaritimeDeposit.test.js` | Development |

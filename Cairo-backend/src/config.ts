import { ethers } from "ethers";
import "dotenv/config";

export const config = {
  port:                 Number(process.env.PORT ?? 3001),
  chainId:              Number(process.env.CHAIN_ID ?? 11155111),
  tradeExecutorAddress: process.env.TRADE_EXECUTOR_ADDRESS!,
  equityVaultAddress:   process.env.EQUITY_VAULT_ADDRESS!,
  mdtAddress:           process.env.MDT_TOKEN_ADDRESS ?? process.env.MDT_ADDRESS!,
  rpcUrl:               process.env.RPC_URL!,
  offerTtl:             Number(process.env.OFFER_TTL ?? 120),
};

export const provider = new ethers.JsonRpcProvider(config.rpcUrl);

// Signs EIP-712 offers — never used to send transactions
export const backendWallet = new ethers.Wallet(
  process.env.BACKEND_SIGNER_PRIVATE_KEY!,
  provider
);

// Sends on-chain transactions (mint, burn, compliance) — separate key from signer
export const operatorWallet = new ethers.Wallet(
  process.env.OPERATOR_PRIVATE_KEY ?? process.env.BACKEND_SIGNER_PRIVATE_KEY!,
  provider
);

// ── ABIs ──────────────────────────────────────────────────────────────────────

export const TRADE_EXECUTOR_ABI = [
  "function nonces(address user) view returns (uint256)",
  "event BuyExecuted(address indexed user, string ticker, uint256 shares, uint256 mdtCost)",
  "event SellExecuted(address indexed user, string ticker, uint256 shares, uint256 mdtPayout)",
];

export const EQUITY_VAULT_ABI = [
  // Read
  "function balanceOfTicker(address account, string ticker) view returns (uint256)",
  "function tokenIdForTicker(string ticker) view returns (uint256)",
  "function totalSupplyOf(string ticker) view returns (uint256)",
  "function isRegistered(string ticker) view returns (bool)",
  "function frozen(address account) view returns (bool)",
  "function tickerCount() view returns (uint256)",
  "function allTickers(uint256 index) view returns (string)",
  // Write (operator only)
  "function mint(address to, string ticker, uint256 amount)",
  "function batchMint(address to, string[] tickers, uint256[] amounts)",
  "function burnSharesForMDT(address from, string ticker, uint256 amount)",
  "function freeze(address account)",
  "function unfreeze(address account)",
  "function seize(address from, address to, string ticker, uint256 amount)",
  "function grantRole(bytes32 role, address account)",
  // Events
  "event SharesMinted(address indexed to, string ticker, uint256 amount, address token)",
  "event SharesBurned(address indexed from, string ticker, uint256 amount, address token)",
];

// ── Contract instances ────────────────────────────────────────────────────────

// Read-only — used for nonce queries
export const tradeExecutorContract = new ethers.Contract(
  config.tradeExecutorAddress,
  TRADE_EXECUTOR_ABI,
  provider
);

// Connected to operator wallet — supports both reads and on-chain writes
export const equityVaultContract = new ethers.Contract(
  config.equityVaultAddress,
  EQUITY_VAULT_ABI,
  operatorWallet
);

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.equityVaultContract = exports.tradeExecutorContract = exports.EQUITY_VAULT_ABI = exports.TRADE_EXECUTOR_ABI = exports.operatorWallet = exports.backendWallet = exports.provider = exports.config = void 0;
const ethers_1 = require("ethers");
require("dotenv/config");
exports.config = {
    port: Number(process.env.PORT ?? 3001),
    chainId: Number(process.env.CHAIN_ID ?? 11155111),
    tradeExecutorAddress: process.env.TRADE_EXECUTOR_ADDRESS,
    equityVaultAddress: process.env.EQUITY_VAULT_ADDRESS,
    mdtAddress: process.env.MDT_TOKEN_ADDRESS ?? process.env.MDT_ADDRESS,
    rpcUrl: process.env.RPC_URL,
    offerTtl: Number(process.env.OFFER_TTL ?? 120),
};
exports.provider = new ethers_1.ethers.JsonRpcProvider(exports.config.rpcUrl);
// Signs EIP-712 offers — never used to send transactions
exports.backendWallet = new ethers_1.ethers.Wallet(process.env.BACKEND_SIGNER_PRIVATE_KEY, exports.provider);
// Sends on-chain transactions (mint, burn, compliance) — separate key from signer
exports.operatorWallet = new ethers_1.ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY ?? process.env.BACKEND_SIGNER_PRIVATE_KEY, exports.provider);
// ── ABIs ──────────────────────────────────────────────────────────────────────
exports.TRADE_EXECUTOR_ABI = [
    "function nonces(address user) view returns (uint256)",
    "event BuyExecuted(address indexed user, string ticker, uint256 shares, uint256 mdtCost)",
    "event SellExecuted(address indexed user, string ticker, uint256 shares, uint256 mdtPayout)",
];
exports.EQUITY_VAULT_ABI = [
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
exports.tradeExecutorContract = new ethers_1.ethers.Contract(exports.config.tradeExecutorAddress, exports.TRADE_EXECUTOR_ABI, exports.provider);
// Connected to operator wallet — supports both reads and on-chain writes
exports.equityVaultContract = new ethers_1.ethers.Contract(exports.config.equityVaultAddress, exports.EQUITY_VAULT_ABI, exports.operatorWallet);

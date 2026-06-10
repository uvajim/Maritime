// All backend calls use relative paths so the rewrite proxy in next.config.ts
// forwards them to Railway server-side. The Railway URL never reaches the client.
export const PORTFOLIO_BALANCE_API_URL = "/api/portfolio-balance";

// ── Railway backend routes ────────────────────────────────────────────────────
export const ASSETS_URL    = "/api/holdings";
export const BALANCE_URL   = "/api/account";
export const ACTIVITY_URL  = "/api/activity";

// ── Still on Cloud Run ────────────────────────────────────────────────────────
export const DEPOSIT_URL  = "https://maritime-deposit-service-266596137006.us-south1.run.app";
export const WITHDRAW_URL = "https://withdrawl-funds-266596137006.us-west4.run.app";

// ── Trade execution is handled by Dhow TradeExecutor (see TRADE_EXECUTOR_ADDRESS below)

// ── Dhow TradeExecutor contract (Ethereum Sepolia testnet) ────────────────────
// User submits the backend-signed BuyParams/SellParams here and pays gas.
export const TRADE_EXECUTOR_ADDRESS =
  (process.env.NEXT_PUBLIC_TRADE_EXECUTOR_ADDRESS ?? "0x589D6446bc4586c6d904F62Ed53E137919398F39") as `0x${string}`;

export const TRADE_EXECUTOR_ABI = [
  {
    name: "executeBuy",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p", type: "tuple",
        components: [
          { name: "user",    type: "address" },
          { name: "ticker",  type: "string"  },
          { name: "shares",  type: "uint256" },
          { name: "dUSDCost", type: "uint256" },
          { name: "nonce",   type: "uint256" },
          { name: "expiry",  type: "uint256" },
        ],
      },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "executeSell",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p", type: "tuple",
        components: [
          { name: "user",      type: "address" },
          { name: "ticker",    type: "string"  },
          { name: "shares",    type: "uint256" },
          { name: "dUSDPayout", type: "uint256" },
          { name: "nonce",     type: "uint256" },
          { name: "expiry",    type: "uint256" },
        ],
      },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "nonces",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

// ── Dhow EquityVault ERC-20 factory contract (Ethereum Sepolia testnet) ───────
// Deploys a ShareToken ERC-20 per ticker on first mint.
// Canonical source of truth for all equity share balances.
export const EQUITY_VAULT_ADDRESS =
  (process.env.NEXT_PUBLIC_EQUITY_VAULT_ADDRESS ?? "0x71F24eCE2B8952711Ddcd12E8C6d803f4203d076") as `0x${string}`;

// DhowUSD (dUSD) platform stablecoin — separate from the DhowDeposit gateway.
export const dUSD_TOKEN_CONTRACT =
  (process.env.NEXT_PUBLIC_dUSD_TOKEN_CONTRACT ?? "0x186E1C1999E53515F755e36d9D179118F9E4C5C2") as `0x${string}`;

// ERC-20 stablecoin contract addresses (Ethereum mainnet).
export const STABLECOIN_ADDRESSES: Record<string, string> = {
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
};

// ── DhowDeposit gateway contract (Ethereum Sepolia testnet) ───────────────────
// On/off ramp: deposit() pulls USDC/USDT → vault and mints dUSD 1:1;
// withdraw() burns dUSD and returns USDC/USDT.
export const DHOW_DEPOSIT_CONTRACT =
  (process.env.NEXT_PUBLIC_DHOW_DEPOSIT_CONTRACT ?? "0xff90F72EfCD77C141a946968d1C54aBf48c8AB0B") as `0x${string}`;

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 1);

const EXPLORER_ROOTS: Record<number, string> = {
  1:        'https://etherscan.io',
  11155111: 'https://sepolia.etherscan.io',
  8453:     'https://basescan.org',
  84532:    'https://sepolia.basescan.org',
};
export const EXPLORER_URL = EXPLORER_ROOTS[CHAIN_ID] ?? 'https://etherscan.io';

// Dhow mock USDC/USDT on Ethereum Sepolia (MockERC20 — freely mintable for testing).
export const SEPOLIA_STABLECOINS: Record<string, `0x${string}`> = {
  USDC: "0x5734fF0BDb277BeABe8E63F50B2B730dCCA4DdeE",
  USDT: "0x6c91Ae68c439285f577348bc2358999b73367726",
};

// Minimal ERC-20 ABI (approve + allowance)
export const ERC20_APPROVE_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value",   type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner",   type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

// USDT's approve doesn't return a bool (non-standard ERC20). Using the standard
// ABI above causes wagmi's simulation step to fail decoding the empty return value.
export const USDT_APPROVE_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value",   type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner",   type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

// DhowDeposit ABI — withdraw(address token, uint256 amount)
// Burns the user's dUSD and returns USDC/USDT from the vault. No approve step needed
// (the gateway holds BURNER_ROLE on dUSD).
export const DHOW_WITHDRAW_ABI = [
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token",  type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "vaultBalance",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

// DhowDeposit ABI — deposit(address token, uint256 amount, bytes32 userId)
// Pulls `amount` of `token` (USDC/USDT) from the user and mints dUSD 1:1.
export const DHOW_DEPOSIT_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token",  type: "address" },
      { name: "amount", type: "uint256" },
      { name: "userId", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;


// ── EquityVault ABI ───────────────────────────────────────────────────────────
export const EQUITY_VAULT_ABI = [
  {
    name: "balanceOfTicker",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "ticker",  type: "string"  },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    // Returns the ERC-20 ShareToken address for a ticker (address(0) if never minted)
    name: "tokenAddressForTicker",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "ticker", type: "string" }],
    outputs: [{ type: "address" }],
  },
  {
    // Total supply of a ticker's ShareToken (6 decimals)
    name: "totalSupplyOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "ticker", type: "string" }],
    outputs: [{ type: "uint256" }],
  },
  {
    // Returns the ticker string at index i in the allTickers array
    name: "allTickers",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
  {
    // Total number of distinct tickers ever minted
    name: "tickerCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "isRegistered",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "ticker", type: "string" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "SharesMinted",
    type: "event",
    inputs: [
      { name: "to",     type: "address", indexed: true  },
      { name: "ticker", type: "string",  indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "token",  type: "address", indexed: false },
    ],
  },
  {
    name: "SharesBurned",
    type: "event",
    inputs: [
      { name: "from",   type: "address", indexed: true  },
      { name: "ticker", type: "string",  indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "token",  type: "address", indexed: false },
    ],
  },
] as const;

// ── DhowUSD (dUSD) ABI ────────────────────────────────────────────────────────
// Custom ERC-20-ish token (6 decimals). `frozen(addr)` reports whether an account
// is restricted — deposits/transfers/trades revert for frozen accounts.
export const DUSD_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs:  [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "frozen",
    type: "function",
    stateMutability: "view",
    inputs:  [{ name: "account", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

// ── EIP-712 DepositIntent (shared by all deposit UI + backend verification) ───
export const DEPOSIT_INTENT_DOMAIN = {
  name:              "Cairo",
  version:           "1",
  verifyingContract: DHOW_DEPOSIT_CONTRACT,
} as const;

export const DEPOSIT_INTENT_TYPES = {
  DepositIntent: [
    { name: "walletAddress", type: "address" },
    { name: "amount",        type: "string"  },
    { name: "timestamp",     type: "uint256" },
  ],
} as const;

// Friendly messages for contract revert names
export const CONTRACT_ERROR_MESSAGES: Record<string, string> = {
  // Deposit / withdrawal errors
  UnsupportedToken:         "Only USDC and USDT are supported.",
  BelowMinimum:             "Amount is below the minimum deposit.",
  InsufficientVaultBalance: "Vault balance too low. Try again later.",
  InsufficientAllowance:    "Approve the contract to spend your tokens first.",
  TransferFailed:           "Token transfer failed.",
  // Trade errors (Dhow TradeExecutor)
  CallerNotUser:            "Connected wallet does not match the requested address.",
  InvalidSignature:         "Offer is invalid — request a new one.",
  InvalidNonce:             "Another trade landed first — request a new one.",
  OfferExpired:             "Offer timed out — request a new one.",
  // Shared errors
  InsufficientBalance:      "Not enough dUSD — deposit more stablecoins first.",
  AccountFrozen:            "This account is restricted.",
};

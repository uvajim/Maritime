/**
 * Per-network stablecoin addresses.
 * Add new networks here as needed — all deploy scripts read from this file.
 */

export interface StablecoinAddresses {
  USDC: string;
  USDT: string;
}

const STABLECOINS: Record<string, StablecoinAddresses> = {
  // ── Mainnet ────────────────────────────────────────────────────────────────
  mainnet: {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  },

  // ── Sepolia testnet ────────────────────────────────────────────────────────
  sepolia: {
    USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    USDT: "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06",
  },
};

export function getStablecoins(networkName: string): StablecoinAddresses {
  const addrs = STABLECOINS[networkName];
  if (!addrs) {
    throw new Error(
      `No stablecoin addresses configured for network "${networkName}". ` +
      `Add them to scripts/addresses.ts.`
    );
  }
  return addrs;
}

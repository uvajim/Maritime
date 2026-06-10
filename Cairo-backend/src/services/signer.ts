import { ethers } from "ethers";
import { backendWallet, config } from "../config";

// ── Must mirror TradeExecutor.sol exactly ─────────────────────────────────────

const BUY_TYPES = {
  BuyParams: [
    { name: "user",    type: "address" },
    { name: "ticker",  type: "string"  },
    { name: "shares",  type: "uint256" },
    { name: "mdtCost", type: "uint256" },
    { name: "nonce",   type: "uint256" },
    { name: "expiry",  type: "uint256" },
  ],
};

const SELL_TYPES = {
  SellParams: [
    { name: "user",      type: "address" },
    { name: "ticker",    type: "string"  },
    { name: "shares",    type: "uint256" },
    { name: "mdtPayout", type: "uint256" },
    { name: "nonce",     type: "uint256" },
    { name: "expiry",    type: "uint256" },
  ],
};

function getDomain() {
  return {
    name:              "Cairo",
    version:           "1",
    chainId:           config.chainId,
    verifyingContract: config.tradeExecutorAddress,
  };
}

export interface BuyParams {
  user:    string;
  ticker:  string;
  shares:  bigint;
  mdtCost: bigint;
  nonce:   bigint;
  expiry:  bigint;
}

export interface SellParams {
  user:      string;
  ticker:    string;
  shares:    bigint;
  mdtPayout: bigint;
  nonce:     bigint;
  expiry:    bigint;
}

export async function signBuyParams(params: BuyParams): Promise<string> {
  return backendWallet.signTypedData(getDomain(), BUY_TYPES, params);
}

export async function signSellParams(params: SellParams): Promise<string> {
  return backendWallet.signTypedData(getDomain(), SELL_TYPES, params);
}

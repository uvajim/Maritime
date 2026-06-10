"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signBuyParams = signBuyParams;
exports.signSellParams = signSellParams;
const config_1 = require("../config");
// ── Must mirror TradeExecutor.sol exactly ─────────────────────────────────────
const BUY_TYPES = {
    BuyParams: [
        { name: "user", type: "address" },
        { name: "ticker", type: "string" },
        { name: "shares", type: "uint256" },
        { name: "mdtCost", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" },
    ],
};
const SELL_TYPES = {
    SellParams: [
        { name: "user", type: "address" },
        { name: "ticker", type: "string" },
        { name: "shares", type: "uint256" },
        { name: "mdtPayout", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" },
    ],
};
function getDomain() {
    return {
        name: "Cairo",
        version: "1",
        chainId: config_1.config.chainId,
        verifyingContract: config_1.config.tradeExecutorAddress,
    };
}
async function signBuyParams(params) {
    return config_1.backendWallet.signTypedData(getDomain(), BUY_TYPES, params);
}
async function signSellParams(params) {
    return config_1.backendWallet.signTypedData(getDomain(), SELL_TYPES, params);
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNonce = getNonce;
exports.getTokenId = getTokenId;
exports.isTickerRegistered = isTickerRegistered;
const config_1 = require("../config");
async function getNonce(user) {
    return BigInt(await config_1.tradeExecutorContract.nonces(user));
}
async function getTokenId(ticker) {
    return BigInt(await config_1.equityVaultContract.tokenIdForTicker(ticker));
}
async function isTickerRegistered(ticker) {
    return config_1.equityVaultContract.isRegistered(ticker);
}

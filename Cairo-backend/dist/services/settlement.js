"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSettlementListener = startSettlementListener;
const config_1 = require("../config");
// ── Buy settlement ────────────────────────────────────────────────────────────
// Fires after overseer.executeOffer() is confirmed on-chain.
// Mints the corresponding EquityVault shares to the user.
async function handleOfferExecuted(user, ticker, shares) {
    try {
        const tx = await config_1.equityVaultContract.mint(user, ticker, shares);
        const receipt = await tx.wait();
        console.log(`[settlement] minted ${ticker} ×${shares} to ${user} (block ${receipt.blockNumber})`);
    }
    catch (err) {
        console.error(`[settlement] mint failed for ${user} ${ticker} ×${shares}:`, err.message);
    }
}
// ── Sell settlement ───────────────────────────────────────────────────────────
// Fires after overseer.executeRedeem() is confirmed on-chain.
// Burns the corresponding EquityVault shares from the user.
async function handleRedeemExecuted(user, ticker, shares) {
    try {
        const tx = await config_1.equityVaultContract.burnForMDT(user, ticker, shares);
        const receipt = await tx.wait();
        console.log(`[settlement] burned ${ticker} ×${shares} from ${user} (block ${receipt.blockNumber})`);
    }
    catch (err) {
        console.error(`[settlement] burn failed for ${user} ${ticker} ×${shares}:`, err.message);
    }
}
// ── Listener ──────────────────────────────────────────────────────────────────
function startSettlementListener() {
    config_1.overseerContract.on("OfferExecuted", (user, ticker, shares) => {
        handleOfferExecuted(user, ticker, shares);
    });
    config_1.overseerContract.on("RedeemExecuted", (user, ticker, shares) => {
        handleRedeemExecuted(user, ticker, shares);
    });
    console.log("[settlement] listening for OfferExecuted and RedeemExecuted on Overseer");
}

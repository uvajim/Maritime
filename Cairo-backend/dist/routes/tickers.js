"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tickersRouter = void 0;
const express_1 = require("express");
const config_1 = require("../config");
exports.tickersRouter = (0, express_1.Router)();
// GET /api/tickers/:ticker  — check registration + return tokenId
exports.tickersRouter.get("/:ticker", async (req, res) => {
    const ticker = req.params.ticker.toUpperCase();
    try {
        const [registered, tokenId] = await Promise.all([
            config_1.equityVaultContract.isRegistered(ticker),
            config_1.equityVaultContract.tokenIdForTicker(ticker),
        ]);
        res.json({
            ticker,
            tokenId: tokenId.toString(),
            registered,
        });
    }
    catch (err) {
        res.status(502).json({ error: err.message });
    }
});

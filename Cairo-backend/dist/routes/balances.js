"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.balancesRouter = void 0;
const express_1 = require("express");
const ethers_1 = require("ethers");
const config_1 = require("../config");
exports.balancesRouter = (0, express_1.Router)();
// GET /balances/:address?tickers=AAPL,TSLA,MSFT
exports.balancesRouter.get("/:address", async (req, res) => {
    const { address } = req.params;
    if (!ethers_1.ethers.isAddress(address)) {
        res.status(400).json({ error: "Invalid address" });
        return;
    }
    const raw = req.query.tickers ?? "";
    const tickers = raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
    if (tickers.length === 0) {
        res.status(400).json({ error: "Provide ?tickers=AAPL,TSLA" });
        return;
    }
    const ids = tickers.map((t) => BigInt(ethers_1.ethers.keccak256(ethers_1.ethers.toUtf8Bytes(t))));
    const addrs = tickers.map(() => address);
    const bals = await config_1.equityVaultContract.balanceOfBatch(addrs, ids);
    const result = Object.fromEntries(tickers.map((t, i) => [t, bals[i].toString()]) // 6-decimal strings
    );
    res.json({ address, balances: result });
});

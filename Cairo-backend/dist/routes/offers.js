"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.offersRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const config_1 = require("../config");
const priceStore_1 = require("../services/priceStore");
const signer_1 = require("../services/signer");
exports.offersRouter = (0, express_1.Router)();
// ── POST /trade/buy ───────────────────────────────────────────────────────────
// Body: { user, ticker, shares }   (shares as 6-decimal integer string)
// Returns: { params, signature }
const BuyBody = zod_1.z.object({
    user: zod_1.z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    ticker: zod_1.z.string().min(1).max(10).toUpperCase(),
    shares: zod_1.z.string().regex(/^\d+$/), // 6-decimal bigint as string
});
exports.offersRouter.post("/buy", async (req, res) => {
    const parsed = BuyBody.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }
    const { user, ticker, shares } = parsed.data;
    try {
        const { price } = await (0, priceStore_1.getPrice)(ticker);
        const sharesBn = BigInt(shares);
        const mdtCost = (price * sharesBn) / 1000000n;
        const now = BigInt(Math.floor(Date.now() / 1000));
        const nonce = BigInt(await config_1.tradeExecutorContract.nonces(user));
        const expiry = now + BigInt(config_1.config.offerTtl);
        const params = { user, ticker, shares: sharesBn, mdtCost, nonce, expiry };
        const signature = await (0, signer_1.signBuyParams)(params);
        res.json({
            params: {
                user,
                ticker,
                shares: params.shares.toString(),
                mdtCost: params.mdtCost.toString(),
                nonce: params.nonce.toString(),
                expiry: params.expiry.toString(),
            },
            signature,
        });
    }
    catch (err) {
        res.status(502).json({ error: err.message });
    }
});
// ── POST /trade/sell ──────────────────────────────────────────────────────────
// Body: { user, ticker, shares }   (shares as 6-decimal integer string)
// Returns: { params, signature }
exports.offersRouter.post("/sell", async (req, res) => {
    const parsed = BuyBody.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }
    const { user, ticker, shares } = parsed.data;
    try {
        const { price } = await (0, priceStore_1.getPrice)(ticker);
        const sharesBn = BigInt(shares);
        // Apply a 3% sell spread (97% of midpoint price)
        const priceFloat = Number(price) / 1_000_000;
        const priceRaw = BigInt(Math.round(priceFloat * 970_000));
        const mdtPayout = (priceRaw * sharesBn) / 1000000n;
        const now = BigInt(Math.floor(Date.now() / 1000));
        const nonce = BigInt(await config_1.tradeExecutorContract.nonces(user));
        const expiry = now + BigInt(config_1.config.offerTtl);
        const params = { user, ticker, shares: sharesBn, mdtPayout, nonce, expiry };
        const signature = await (0, signer_1.signSellParams)(params);
        res.json({
            params: {
                user,
                ticker,
                shares: params.shares.toString(),
                mdtPayout: params.mdtPayout.toString(),
                nonce: params.nonce.toString(),
                expiry: params.expiry.toString(),
            },
            signature,
        });
    }
    catch (err) {
        res.status(502).json({ error: err.message });
    }
});

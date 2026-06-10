"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const priceStore_1 = require("../services/priceStore");
exports.adminRouter = (0, express_1.Router)();
// ── API key guard ─────────────────────────────────────────────────────────────
exports.adminRouter.use((req, res, next) => {
    if (!process.env.ADMIN_API_KEY || req.headers["x-admin-key"] !== process.env.ADMIN_API_KEY) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    next();
});
// ── POST /admin/price ─────────────────────────────────────────────────────────
// Body: { ticker, price }   (price as 6-decimal string, e.g. "185500000" = $185.50)
const SetPriceBody = zod_1.z.object({
    ticker: zod_1.z.string().min(1).max(10).toUpperCase(),
    price: zod_1.z.string().regex(/^\d+$/, "price must be a 6-decimal integer string"),
});
exports.adminRouter.post("/price", async (req, res) => {
    const parsed = SetPriceBody.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }
    const { ticker, price } = parsed.data;
    await (0, priceStore_1.setPrice)(ticker, BigInt(price));
    res.json({ ok: true, ticker, price });
});
// ── GET /admin/prices ─────────────────────────────────────────────────────────
exports.adminRouter.get("/prices", async (_req, res) => {
    res.json(await (0, priceStore_1.getAllPrices)());
});

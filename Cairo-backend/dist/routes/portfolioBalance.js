"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.portfolioBalanceRouter = void 0;
const express_1 = require("express");
const ethers_1 = require("ethers");
const zod_1 = require("zod");
const redis_1 = require("../lib/redis");
const db_1 = require("../lib/db");
exports.portfolioBalanceRouter = (0, express_1.Router)();
const BalanceBody = zod_1.z.object({
    balance: zod_1.z.number().finite().min(0),
});
const HistoryQuery = zod_1.z.object({
    timeframe: zod_1.z.enum(["1D", "1W", "1M", "3M", "1Y"]).optional(),
    days: zod_1.z.coerce.number().int().min(1).max(365).optional(),
});
function bucketInterval(days) {
    if (days <= 1)
        return "1 hour";
    if (days <= 7)
        return "6 hours";
    if (days <= 30)
        return "12 hours";
    if (days <= 90)
        return "1 day";
    return "3 days";
}
// ── GET /:address ─────────────────────────────────────────────────────────────
// Reads current balance from Redis (O(1)). Falls back to latest TSDB row.
exports.portfolioBalanceRouter.get("/:address", async (req, res) => {
    const { address } = req.params;
    if (!ethers_1.ethers.isAddress(address)) {
        res.status(400).json({ error: "Invalid address" });
        return;
    }
    const addr = address.toLowerCase();
    try {
        const cached = await redis_1.redis.get(`portfolio:${addr}:balance`);
        if (cached !== null) {
            res.json({ address, balance: parseFloat(cached) });
            return;
        }
        const result = await db_1.db.query(`SELECT value FROM portfolio_snapshots WHERE address = $1 ORDER BY ts DESC LIMIT 1`, [addr]);
        if (result.rows.length === 0) {
            res.json({ address, balance: null });
            return;
        }
        const balance = Math.round(parseFloat(result.rows[0].value) * 100) / 100;
        await redis_1.redis.set(`portfolio:${addr}:balance`, balance.toString());
        res.json({ address, balance });
    }
    catch {
        res.json({ address, balance: null });
    }
});
// ── PUT /:address ─────────────────────────────────────────────────────────────
// Frontend pushes computed portfolio value (MDT + equity × price).
exports.portfolioBalanceRouter.put("/:address", async (req, res) => {
    const { address } = req.params;
    if (!ethers_1.ethers.isAddress(address)) {
        res.status(400).json({ error: "Invalid address" });
        return;
    }
    const parsed = BalanceBody.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }
    const addr = address.toLowerCase();
    const balance = Math.round(parsed.data.balance * 1e6) / 1e6;
    const nowSec = Math.floor(Date.now() / 1000);
    try {
        await db_1.db.query(`INSERT INTO portfolio_snapshots (address, value, source, ts) VALUES ($1, $2, 'frontend', to_timestamp($3))`, [addr, balance, nowSec]);
        await redis_1.redis.set(`portfolio:${addr}:balance`, balance.toString());
    }
    catch {
        // DB unavailable — best-effort, still update Redis
        await redis_1.redis.set(`portfolio:${addr}:balance`, balance.toString()).catch(() => { });
    }
    res.json({ address, balance });
});
// ── GET /:address/history ─────────────────────────────────────────────────────
// Time-bucketed portfolio snapshots from TimescaleDB.
exports.portfolioBalanceRouter.get("/:address/history", async (req, res) => {
    const { address } = req.params;
    if (!ethers_1.ethers.isAddress(address)) {
        res.status(400).json({ error: "Invalid address" });
        return;
    }
    const parsed = HistoryQuery.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }
    const TIMEFRAME_DAYS = {
        "1D": 1, "1W": 7, "1M": 30, "3M": 90, "1Y": 365,
    };
    const days = parsed.data.days ?? (parsed.data.timeframe ? TIMEFRAME_DAYS[parsed.data.timeframe] : 1);
    const interval = bucketInterval(days);
    const addr = address.toLowerCase();
    try {
        const result = await db_1.db.query(`SELECT
         time_bucket($1::interval, ts) AS bucket,
         AVG(value)                    AS value
       FROM portfolio_snapshots
       WHERE address = $2
         AND ts >= NOW() - ($3 || ' days')::interval
       GROUP BY bucket
       ORDER BY bucket ASC`, [interval, addr, days]);
        const points = result.rows.map((row) => ({
            time: row.bucket.toISOString(),
            value: Math.round(parseFloat(row.value) * 100) / 100,
        }));
        res.json({ address, days, points });
    }
    catch {
        res.json({ address, days, points: [] });
    }
});

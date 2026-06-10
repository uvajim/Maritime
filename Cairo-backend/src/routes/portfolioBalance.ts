import { Router } from "express";
import { ethers } from "ethers";
import { z } from "zod";
import { redis } from "../lib/redis";
import { db } from "../lib/db";

export const portfolioBalanceRouter = Router();

const BalanceBody = z.object({
  balance: z.number().finite().min(0),
});

const HistoryQuery = z.object({
  timeframe: z.enum(["1D", "1W", "1M", "3M", "1Y"]).optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
});

function bucketInterval(days: number): string {
  if (days <= 1)  return "1 hour";
  if (days <= 7)  return "6 hours";
  if (days <= 30) return "12 hours";
  if (days <= 90) return "1 day";
  return "3 days";
}

// ── GET /:address ─────────────────────────────────────────────────────────────
// Reads current balance from Redis (O(1)). Falls back to latest TSDB row.

portfolioBalanceRouter.get("/:address", async (req, res) => {
  const { address } = req.params;
  if (!ethers.isAddress(address)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  const addr = address.toLowerCase();

  try {
    const cached = await redis.get(`portfolio:${addr}:balance`);
    if (cached !== null) {
      res.json({ address, balance: parseFloat(cached) });
      return;
    }

    const result = await db.query(
      `SELECT value FROM portfolio_snapshots WHERE address = $1 ORDER BY ts DESC LIMIT 1`,
      [addr]
    );

    if (result.rows.length === 0) {
      res.json({ address, balance: null });
      return;
    }

    const balance = Math.round(parseFloat(result.rows[0].value) * 100) / 100;
    await redis.set(`portfolio:${addr}:balance`, balance.toString());
    res.json({ address, balance });
  } catch {
    res.json({ address, balance: null });
  }
});

// ── PUT /:address ─────────────────────────────────────────────────────────────
// Frontend pushes computed portfolio value (MDT + equity × price).

portfolioBalanceRouter.put("/:address", async (req, res) => {
  const { address } = req.params;
  if (!ethers.isAddress(address)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  const parsed = BalanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const addr    = address.toLowerCase();
  const balance = Math.round(parsed.data.balance * 1e6) / 1e6;
  const nowSec  = Math.floor(Date.now() / 1000);

  try {
    await db.query(
      `INSERT INTO portfolio_snapshots (address, value, source, ts) VALUES ($1, $2, 'frontend', to_timestamp($3))`,
      [addr, balance, nowSec]
    );
    await redis.set(`portfolio:${addr}:balance`, balance.toString());
  } catch {
    // DB unavailable — best-effort, still update Redis
    await redis.set(`portfolio:${addr}:balance`, balance.toString()).catch(() => {});
  }

  res.json({ address, balance });
});

// ── GET /:address/history ─────────────────────────────────────────────────────
// Time-bucketed portfolio snapshots from TimescaleDB.

portfolioBalanceRouter.get("/:address/history", async (req, res) => {
  const { address } = req.params;
  if (!ethers.isAddress(address)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  const parsed = HistoryQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const TIMEFRAME_DAYS: Record<string, number> = {
    "1D": 1, "1W": 7, "1M": 30, "3M": 90, "1Y": 365,
  };
  const days = parsed.data.days ?? (parsed.data.timeframe ? TIMEFRAME_DAYS[parsed.data.timeframe] : 1);
  const interval = bucketInterval(days);
  const addr     = address.toLowerCase();

  try {
    const result = await db.query(
      `SELECT
         time_bucket($1::interval, ts) AS bucket,
         AVG(value)                    AS value
       FROM portfolio_snapshots
       WHERE address = $2
         AND ts >= NOW() - ($3 || ' days')::interval
       GROUP BY bucket
       ORDER BY bucket ASC`,
      [interval, addr, days]
    );

    const points = result.rows.map((row: any) => ({
      time:  (row.bucket as Date).toISOString(),
      value: Math.round(parseFloat(row.value) * 100) / 100,
    }));

    res.json({ address, days, points });
  } catch {
    res.json({ address, days, points: [] });
  }
});

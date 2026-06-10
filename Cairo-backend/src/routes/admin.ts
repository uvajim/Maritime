import { Router } from "express";
import { z } from "zod";
import { setPrice, getAllPrices } from "../services/priceStore";

export const adminRouter = Router();

// ── API key guard ─────────────────────────────────────────────────────────────
adminRouter.use((req, res, next) => {
  if (!process.env.ADMIN_API_KEY || req.headers["x-admin-key"] !== process.env.ADMIN_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

// ── POST /admin/price ─────────────────────────────────────────────────────────
// Body: { ticker, price }   (price as 6-decimal string, e.g. "185500000" = $185.50)

const SetPriceBody = z.object({
  ticker: z.string().min(1).max(10).toUpperCase(),
  price:  z.string().regex(/^\d+$/, "price must be a 6-decimal integer string"),
});

adminRouter.post("/price", async (req, res) => {
  const parsed = SetPriceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { ticker, price } = parsed.data;
  await setPrice(ticker, BigInt(price));
  res.json({ ok: true, ticker, price });
});

// ── GET /admin/prices ─────────────────────────────────────────────────────────
adminRouter.get("/prices", async (_req, res) => {
  res.json(await getAllPrices());
});

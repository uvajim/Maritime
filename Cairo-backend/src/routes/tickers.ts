import { Router } from "express";
import { equityVaultContract } from "../config";

export const tickersRouter = Router();

// GET /api/tickers/:ticker  — check registration + return tokenId
tickersRouter.get("/:ticker", async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();

  try {
    const [registered, tokenId] = await Promise.all([
      equityVaultContract.isRegistered(ticker),
      equityVaultContract.tokenIdForTicker(ticker),
    ]);

    res.json({
      ticker,
      tokenId:    tokenId.toString(),
      registered,
    });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

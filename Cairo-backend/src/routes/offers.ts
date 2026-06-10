import { Router } from "express";
import { z } from "zod";
import { config, tradeExecutorContract } from "../config";
import { getPrice } from "../services/priceStore";
import { signBuyParams, signSellParams } from "../services/signer";

export const offersRouter = Router();

// ── POST /trade/buy ───────────────────────────────────────────────────────────
// Body: { user, ticker, shares }   (shares as 6-decimal integer string)
// Returns: { params, signature }

const BuyBody = z.object({
  user:   z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  ticker: z.string().min(1).max(10).toUpperCase(),
  shares: z.string().regex(/^\d+$/),  // 6-decimal bigint as string
});

offersRouter.post("/buy", async (req, res) => {
  const parsed = BuyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { user, ticker, shares } = parsed.data;

  try {
    const { price } = await getPrice(ticker);

    const sharesBn = BigInt(shares);
    const mdtCost  = (price * sharesBn) / 1_000_000n;
    const now      = BigInt(Math.floor(Date.now() / 1000));
    const nonce    = BigInt(await tradeExecutorContract.nonces(user));
    const expiry   = now + BigInt(config.offerTtl);

    const params = { user, ticker, shares: sharesBn, mdtCost, nonce, expiry };
    const signature = await signBuyParams(params);

    res.json({
      params: {
        user,
        ticker,
        shares:  params.shares.toString(),
        mdtCost: params.mdtCost.toString(),
        nonce:   params.nonce.toString(),
        expiry:  params.expiry.toString(),
      },
      signature,
    });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ── POST /trade/sell ──────────────────────────────────────────────────────────
// Body: { user, ticker, shares }   (shares as 6-decimal integer string)
// Returns: { params, signature }

offersRouter.post("/sell", async (req, res) => {
  const parsed = BuyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { user, ticker, shares } = parsed.data;

  try {
    const { price } = await getPrice(ticker);

    const sharesBn   = BigInt(shares);
    // Apply a 3% sell spread (97% of midpoint price)
    const priceFloat = Number(price) / 1_000_000;
    const priceRaw   = BigInt(Math.round(priceFloat * 970_000));
    const mdtPayout  = (priceRaw * sharesBn) / 1_000_000n;
    const now        = BigInt(Math.floor(Date.now() / 1000));
    const nonce      = BigInt(await tradeExecutorContract.nonces(user));
    const expiry     = now + BigInt(config.offerTtl);

    const params = { user, ticker, shares: sharesBn, mdtPayout, nonce, expiry };
    const signature = await signSellParams(params);

    res.json({
      params: {
        user,
        ticker,
        shares:    params.shares.toString(),
        mdtPayout: params.mdtPayout.toString(),
        nonce:     params.nonce.toString(),
        expiry:    params.expiry.toString(),
      },
      signature,
    });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

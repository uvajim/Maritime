import { Router } from "express";
import { ethers } from "ethers";
import { equityVaultContract } from "../config";

export const balancesRouter = Router();

// GET /balances/:address?tickers=AAPL,TSLA,MSFT
balancesRouter.get("/:address", async (req, res) => {
  const { address } = req.params;
  if (!ethers.isAddress(address)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  const raw     = (req.query.tickers as string) ?? "";
  const tickers = raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);

  if (tickers.length === 0) {
    res.status(400).json({ error: "Provide ?tickers=AAPL,TSLA" });
    return;
  }

  const ids   = tickers.map((t: string) =>
    BigInt(ethers.keccak256(ethers.toUtf8Bytes(t)))
  );
  const addrs = tickers.map(() => address);

  const bals: bigint[] = await equityVaultContract.balanceOfBatch(addrs, ids);

  const result = Object.fromEntries(
    tickers.map((t, i) => [t, bals[i].toString()])  // 6-decimal strings
  );

  res.json({ address, balances: result });
});

import express from "express";
import helmet  from "helmet";
import { config } from "./config";
import { offersRouter }          from "./routes/offers";
import { balancesRouter }        from "./routes/balances";
import { tickersRouter }         from "./routes/tickers";
import { adminRouter }           from "./routes/admin";
import { portfolioBalanceRouter } from "./routes/portfolioBalance";

const app = express();
app.use(helmet());
app.use(express.json());

// Health check — used by Docker HEALTHCHECK and the CI smoke-test job.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", ts: Date.now() });
});

app.use("/api/trade",             offersRouter);
app.use("/api/balances",          balancesRouter);
app.use("/api/tickers",           tickersRouter);
app.use("/api/admin",             adminRouter);
app.use("/api/portfolio-balance", portfolioBalanceRouter);

app.listen(config.port, () => {
  console.log(`Cairo backend listening on :${config.port}`);
});

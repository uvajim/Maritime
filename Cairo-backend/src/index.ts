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

app.use("/api/trade",             offersRouter);
app.use("/api/balances",          balancesRouter);
app.use("/api/tickers",           tickersRouter);
app.use("/api/admin",             adminRouter);
app.use("/api/portfolio-balance", portfolioBalanceRouter);

app.listen(config.port, () => {
  console.log(`Cairo backend listening on :${config.port}`);
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const config_1 = require("./config");
const offers_1 = require("./routes/offers");
const balances_1 = require("./routes/balances");
const tickers_1 = require("./routes/tickers");
const admin_1 = require("./routes/admin");
const portfolioBalance_1 = require("./routes/portfolioBalance");
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
app.use(express_1.default.json());
app.use("/api/trade", offers_1.offersRouter);
app.use("/api/balances", balances_1.balancesRouter);
app.use("/api/tickers", tickers_1.tickersRouter);
app.use("/api/admin", admin_1.adminRouter);
app.use("/api/portfolio-balance", portfolioBalance_1.portfolioBalanceRouter);
app.listen(config_1.config.port, () => {
    console.log(`Cairo backend listening on :${config_1.config.port}`);
});

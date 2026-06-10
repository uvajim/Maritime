"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPortfolioBalance = getPortfolioBalance;
exports.setPortfolioBalance = setPortfolioBalance;
exports.getPortfolioBalanceHistory = getPortfolioBalanceHistory;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const STORE_DIR = path_1.default.resolve(process.cwd(), "data");
const STORE_PATH = path_1.default.join(STORE_DIR, "portfolio-balances.json");
function normalizeAddress(address) {
    return address.toLowerCase();
}
async function readStore() {
    try {
        const raw = await fs_1.promises.readFile(STORE_PATH, "utf8");
        const parsed = JSON.parse(raw);
        return parsed ?? {};
    }
    catch {
        return {};
    }
}
async function writeStore(data) {
    await fs_1.promises.mkdir(STORE_DIR, { recursive: true });
    const tmpPath = `${STORE_PATH}.tmp`;
    await fs_1.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
    await fs_1.promises.rename(tmpPath, STORE_PATH);
}
async function getPortfolioBalance(address) {
    const store = await readStore();
    return store[normalizeAddress(address)] ?? null;
}
async function setPortfolioBalance(address, balance) {
    const store = await readStore();
    const existing = store[normalizeAddress(address)];
    const now = new Date().toISOString();
    const history = existing?.history ?? [];
    const lastPoint = history[history.length - 1];
    const nextBalance = Math.round(balance * 100) / 100;
    if (!lastPoint || Math.abs(lastPoint.balance - nextBalance) >= 0.01) {
        history.push({ at: now, balance: nextBalance });
    }
    else {
        history[history.length - 1] = { at: now, balance: nextBalance };
    }
    const next = {
        balance: nextBalance,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        history,
    };
    store[normalizeAddress(address)] = next;
    await writeStore(store);
    return next;
}
async function getPortfolioBalanceHistory(address, days) {
    const row = await getPortfolioBalance(address);
    if (!row?.history?.length)
        return [];
    const since = Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000;
    return row.history.filter((p) => new Date(p.at).getTime() >= since);
}

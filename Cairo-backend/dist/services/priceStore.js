"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setPrice = setPrice;
exports.getPrice = getPrice;
exports.getAllPrices = getAllPrices;
const redis_1 = require("../lib/redis");
// Prices stored in Redis as 6-decimal integer strings (e.g. "185500000" = $185.50).
// Keys: price:<TICKER>  (uppercase)
// TTL:  none — prices persist until explicitly updated
const UPDATED_AT_SUFFIX = ":updatedAt";
async function setPrice(ticker, price) {
    const key = `price:${ticker.toUpperCase()}`;
    const now = Math.floor(Date.now() / 1000).toString();
    await redis_1.redis.set(key, price.toString());
    await redis_1.redis.set(key + UPDATED_AT_SUFFIX, now);
}
async function getPrice(ticker) {
    const key = `price:${ticker.toUpperCase()}`;
    const [priceStr, tsStr] = await redis_1.redis.mget(key, key + UPDATED_AT_SUFFIX);
    if (!priceStr)
        throw new Error(`No price set for ticker: ${ticker}`);
    return {
        price: BigInt(priceStr),
        updatedAt: tsStr ? Number(tsStr) : 0,
    };
}
async function getAllPrices() {
    const keys = await redis_1.redis.keys("price:*");
    // Filter out the :updatedAt keys
    const priceKeys = keys.filter((k) => !k.endsWith(UPDATED_AT_SUFFIX));
    if (priceKeys.length === 0)
        return {};
    const values = await redis_1.redis.mget(...priceKeys);
    const out = {};
    for (let i = 0; i < priceKeys.length; i++) {
        const ticker = priceKeys[i].replace("price:", "");
        const tsRaw = await redis_1.redis.get(priceKeys[i] + UPDATED_AT_SUFFIX);
        out[ticker] = {
            price: values[i] ?? "0",
            updatedAt: tsRaw ? Number(tsRaw) : 0,
        };
    }
    return out;
}

import { redis } from "../lib/redis";

// Prices stored in Redis as 6-decimal integer strings (e.g. "185500000" = $185.50).
// Keys: price:<TICKER>  (uppercase)
// TTL:  none — prices persist until explicitly updated

const UPDATED_AT_SUFFIX = ":updatedAt";

export async function setPrice(ticker: string, price: bigint): Promise<void> {
  const key = `price:${ticker.toUpperCase()}`;
  const now = Math.floor(Date.now() / 1000).toString();
  await redis.set(key, price.toString());
  await redis.set(key + UPDATED_AT_SUFFIX, now);
}

export async function getPrice(ticker: string): Promise<{ price: bigint; updatedAt: number }> {
  const key = `price:${ticker.toUpperCase()}`;
  const [priceStr, tsStr] = await redis.mget(key, key + UPDATED_AT_SUFFIX);
  if (!priceStr) throw new Error(`No price set for ticker: ${ticker}`);
  return {
    price:     BigInt(priceStr),
    updatedAt: tsStr ? Number(tsStr) : 0,
  };
}

export async function getAllPrices(): Promise<Record<string, { price: string; updatedAt: number }>> {
  const keys = await redis.keys("price:*");
  // Filter out the :updatedAt keys
  const priceKeys = keys.filter((k: string) => !k.endsWith(UPDATED_AT_SUFFIX));
  if (priceKeys.length === 0) return {};

  const values = await redis.mget(...priceKeys);
  const out: Record<string, { price: string; updatedAt: number }> = {};

  for (let i = 0; i < priceKeys.length; i++) {
    const ticker = priceKeys[i].replace("price:", "");
    const tsRaw  = await redis.get(priceKeys[i] + UPDATED_AT_SUFFIX);
    out[ticker] = {
      price:     values[i] ?? "0",
      updatedAt: tsRaw ? Number(tsRaw) : 0,
    };
  }

  return out;
}

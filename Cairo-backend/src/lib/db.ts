import { Pool } from "pg";

export const db = new Pool({
  connectionString:
    process.env.TIMESCALE_URL ??
    "postgresql://postgres:password@localhost:5432/portfolio",
});

db.on("error", (err: Error) =>
  console.error("[timescaledb] pool error:", err.message)
);

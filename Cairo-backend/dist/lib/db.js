"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const pg_1 = require("pg");
exports.db = new pg_1.Pool({
    connectionString: process.env.TIMESCALE_URL ??
        "postgresql://postgres:password@localhost:5432/portfolio",
});
exports.db.on("error", (err) => console.error("[timescaledb] pool error:", err.message));

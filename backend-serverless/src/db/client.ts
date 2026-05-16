import { neon, neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzlePool } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { env } from "../lib/env.js";
import * as schema from "./schema/index.js";

// Node.js runtime needs a WebSocket polyfill for the pooled driver.
// On true edge runtimes (Cloudflare Workers / Vercel Edge) this isn't needed.
neonConfig.webSocketConstructor = ws;

// HTTP driver: lowest latency for one-shot queries (no pool, no warmup).
// Best for the common case on Lambda.
const sql = neon(env.DATABASE_URL);
export const db = drizzleHttp({ client: sql, schema, casing: "snake_case" });

// Pool driver: required for multi-statement transactions. Kept lazy so we
// don't open a WebSocket on requests that never need one.
let _txPool: Pool | undefined;
export function txClient() {
  if (!_txPool) {
    _txPool = new Pool({ connectionString: env.DATABASE_URL });
  }
  return drizzlePool({ client: _txPool, schema, casing: "snake_case" });
}

export { schema };

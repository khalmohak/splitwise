import { Hono } from "hono";
import { query } from "../lib/db.js";

export const health = new Hono();

health.get("/", (c) => c.json({ ok: true, service: "talo-backend", time: new Date().toISOString() }));

health.get("/db", async (c) => {
  const r = await query<{ now: string }>("select now()::text as now");
  return c.json({ ok: true, now: r.rows[0]?.now });
});

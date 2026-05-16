// /api/categories — system-wide (group_id IS NULL) categories only.
// Group-scoped categories live under /api/groups/:groupId/categories and are
// defined in src/routes/groups/categories.ts.

import { Hono } from "hono";
import { isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { categories as categoriesTable } from "../db/schema/categories.js";
import { requireAuth, type AuthVariables } from "../lib/auth.js";

export const categories = new Hono<{ Variables: AuthVariables }>();

categories.use("*", requireAuth);

categories.get("/", async (c) => {
  const rows = await db
    .select()
    .from(categoriesTable)
    .where(isNull(categoriesTable.groupId));
  return c.json(rows);
});

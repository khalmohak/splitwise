import { Hono } from "hono";
import { and, eq, or, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { categories } from "../../db/schema/categories.js";
import { expenses } from "../../db/schema/expenses.js";
import { type AuthVariables } from "../../lib/auth.js";
import { parseJson } from "../../lib/http.js";
import { notFound } from "../../lib/errors.js";
import { requireGroupAdmin, requireGroupMember } from "../../lib/guards.js";

export const groupCategories = new Hono<{ Variables: AuthVariables }>();

// List system + this group's categories, matching the Express reference's
// "group categories" service which includes system defaults.
groupCategories.get("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const user = c.get("user");
  await requireGroupMember(groupId, user.id);
  const rows = await db
    .select()
    .from(categories)
    .where(or(isNull(categories.groupId), eq(categories.groupId, groupId)));
  return c.json(rows);
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  icon: z.string().trim().max(80).nullable().optional(),
  color: z.string().trim().max(40).nullable().optional(),
});

groupCategories.post("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const user = c.get("user");
  await requireGroupAdmin(groupId, user.id);
  const body = await parseJson(c, createSchema);
  const [row] = await db
    .insert(categories)
    .values({
      groupId,
      name: body.name,
      icon: body.icon ?? null,
      color: body.color ?? null,
    })
    .returning();
  return c.json(row, 201);
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  icon: z.string().trim().max(80).nullable().optional(),
  color: z.string().trim().max(40).nullable().optional(),
});

groupCategories.put("/:categoryId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const categoryId = c.req.param("categoryId")!;
  const user = c.get("user");
  await requireGroupAdmin(groupId, user.id);
  const body = await parseJson(c, updateSchema);
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.icon !== undefined) patch.icon = body.icon;
  if (body.color !== undefined) patch.color = body.color;
  const [row] = await db
    .update(categories)
    .set(patch)
    .where(and(eq(categories.id, categoryId), eq(categories.groupId, groupId)))
    .returning();
  if (!row) throw notFound("Category not found");
  return c.json(row);
});

groupCategories.delete("/:categoryId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const categoryId = c.req.param("categoryId")!;
  const user = c.get("user");
  await requireGroupAdmin(groupId, user.id);
  // Null out any expenses that point at this category before removing the row.
  await db
    .update(expenses)
    .set({ categoryId: null })
    .where(eq(expenses.categoryId, categoryId));
  const result = await db
    .delete(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.groupId, groupId)))
    .returning({ id: categories.id });
  if (result.length === 0) throw notFound("Category not found");
  return c.body(null, 204);
});

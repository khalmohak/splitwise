import { Hono } from "hono";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { tags, expenseTags } from "../../db/schema/tags.js";
import { type AuthVariables } from "../../lib/auth.js";
import { parseJson } from "../../lib/http.js";
import { notFound } from "../../lib/errors.js";
import { requireGroupAdmin, requireGroupMember } from "../../lib/guards.js";

export const groupTags = new Hono<{ Variables: AuthVariables }>();

groupTags.get("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const user = c.get("user");
  await requireGroupMember(groupId, user.id);
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      expenseCount: count(expenseTags.tagId),
    })
    .from(tags)
    .leftJoin(expenseTags, eq(expenseTags.tagId, tags.id))
    .where(eq(tags.groupId, groupId))
    .groupBy(tags.id);
  return c.json(rows.map((r) => ({ ...r, expenseCount: Number(r.expenseCount) })));
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().trim().max(40).nullable().optional(),
});

// Members (not just admins) can create tags — matches the Express reference's
// "must be member, not admin" rule for tag creation.
groupTags.post("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const user = c.get("user");
  await requireGroupMember(groupId, user.id);
  const body = await parseJson(c, createSchema);
  const [row] = await db
    .insert(tags)
    .values({ groupId, name: body.name, color: body.color ?? null })
    .returning();
  return c.json({ ...row, expenseCount: 0 }, 201);
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.string().trim().max(40).nullable().optional(),
});

groupTags.put("/:tagId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const tagId = c.req.param("tagId")!;
  const user = c.get("user");
  await requireGroupAdmin(groupId, user.id);
  const body = await parseJson(c, updateSchema);
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.color !== undefined) patch.color = body.color;
  const [row] = await db
    .update(tags)
    .set(patch)
    .where(and(eq(tags.id, tagId), eq(tags.groupId, groupId)))
    .returning();
  if (!row) throw notFound("Tag not found");
  return c.json({ ...row, expenseCount: 0 });
});

groupTags.delete("/:tagId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const tagId = c.req.param("tagId")!;
  const user = c.get("user");
  await requireGroupAdmin(groupId, user.id);
  // expense_tags FK cascades on tag delete, but be explicit for clarity.
  await db.delete(expenseTags).where(eq(expenseTags.tagId, tagId));
  const result = await db
    .delete(tags)
    .where(and(eq(tags.id, tagId), eq(tags.groupId, groupId)))
    .returning({ id: tags.id });
  if (result.length === 0) throw notFound("Tag not found");
  return c.body(null, 204);
});

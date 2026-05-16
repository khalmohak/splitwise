// /api/groups/:groupId/activity — paginated unified activity feed combining
// audit log entries with the most recent expense/settlement creations. We
// use audit_logs as the spine (it's already a unified timeline) and only
// enrich items with extra payload data when useful.

import { Hono } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { auditLogs } from "../../db/schema/audit-logs.js";
import { users } from "../../db/schema/users.js";
import { type AuthVariables } from "../../lib/auth.js";
import { requireGroupMember } from "../../lib/guards.js";
import { buildPaginationMeta, parsePagination } from "../../lib/pagination.js";

export const groupActivity = new Hono<{ Variables: AuthVariables }>();

groupActivity.get("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  const { page, limit } = parsePagination(c);

  const filters = [eq(auditLogs.groupId, groupId)];

  const [{ total }] = (await db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(...filters))) as [{ total: number }];

  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(...filters))
    .orderBy(desc(auditLogs.createdAt))
    .offset((page - 1) * limit)
    .limit(limit);

  const actorIds = Array.from(new Set(rows.map((r) => r.actorId)));
  const actors = actorIds.length
    ? await db.select().from(users).where(inArray(users.id, actorIds))
    : [];
  const actorById = new Map(actors.map((u) => [u.id, u]));

  return c.json({
    data: rows.map((r) => {
      const a = actorById.get(r.actorId);
      return {
        id: r.id,
        type: `${r.resourceType}_${r.action}`,
        actor: a ? { id: a.id, name: a.name, avatarUrl: a.avatarUrl } : null,
        summary: r.summary,
        payload: r.after ?? r.before ?? null,
        createdAt: r.createdAt.toISOString(),
      };
    }),
    meta: buildPaginationMeta(total, page, limit),
  });
});

import { Hono } from "hono";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { auditLogs } from "../../db/schema/audit-logs.js";
import { users } from "../../db/schema/users.js";
import { type AuthVariables } from "../../lib/auth.js";
import { requireGroupMember } from "../../lib/guards.js";
import { isDateOnly } from "../../lib/date-utils.js";
import { buildPaginationMeta, parsePagination } from "../../lib/pagination.js";

export const groupAudit = new Hono<{ Variables: AuthVariables }>();

const ACTIONS = ["created", "updated", "deleted"] as const;
const RESOURCES = ["expense", "settlement"] as const;

groupAudit.get("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const { page, limit } = parsePagination(c);

  const filters = [eq(auditLogs.groupId, groupId)];

  const action = c.req.query("action");
  if (action && (ACTIONS as readonly string[]).includes(action)) {
    filters.push(eq(auditLogs.action, action as (typeof ACTIONS)[number]));
  }
  const resourceType = c.req.query("resourceType");
  if (resourceType && (RESOURCES as readonly string[]).includes(resourceType)) {
    filters.push(eq(auditLogs.resourceType, resourceType as (typeof RESOURCES)[number]));
  }
  const resourceId = c.req.query("resourceId");
  if (resourceId) filters.push(eq(auditLogs.resourceId, resourceId));
  const actorId = c.req.query("actorId");
  if (actorId) filters.push(eq(auditLogs.actorId, actorId));

  // from/to accept either YYYY-MM-DD or full ISO timestamps.
  const from = c.req.query("from");
  if (from) {
    const ts = isDateOnly(from) ? new Date(`${from}T00:00:00Z`) : new Date(from);
    if (!Number.isNaN(ts.getTime())) filters.push(gte(auditLogs.createdAt, ts));
  }
  const to = c.req.query("to");
  if (to) {
    const ts = isDateOnly(to) ? new Date(`${to}T23:59:59.999Z`) : new Date(to);
    if (!Number.isNaN(ts.getTime())) filters.push(lte(auditLogs.createdAt, ts));
  }

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
        action: r.action,
        resource: { type: r.resourceType, id: r.resourceId },
        actor: a ? { id: a.id, name: a.name, avatarUrl: a.avatarUrl } : null,
        summary: r.summary,
        before: r.before,
        after: r.after,
        changedFields: r.changedFields ?? [],
        createdAt: r.createdAt.toISOString(),
      };
    }),
    meta: buildPaginationMeta(total, page, limit),
  });
});

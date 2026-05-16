import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { groupMembers } from "../../db/schema/groups.js";
import { users, type User } from "../../db/schema/users.js";
import { type AuthVariables } from "../../lib/auth.js";
import { parseJson } from "../../lib/http.js";
import {
  conflict,
  forbidden,
  notFound,
  unprocessable,
  validationError,
} from "../../lib/errors.js";
import { requireGroupAdmin, requireGroupMember } from "../../lib/guards.js";
import { toMemberResponse } from "../../lib/presenters.js";
import { computeUserNetCents } from "../../lib/balances.js";
import { notify } from "../../lib/notify.js";

export const groupMembersRoutes = new Hono<{ Variables: AuthVariables }>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const addSchema = z.object({
  email: z.string().trim().min(1),
  role: z.enum(["admin", "member"]).optional(),
});

groupMembersRoutes.post("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupAdmin(groupId, actor.id);
  const body = await parseJson(c, addSchema);
  const email = body.email.toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw validationError({ email: "Invalid email" });
  }

  const [target] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!target) throw notFound("User not found");

  const [existing] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, target.id)))
    .limit(1);
  if (existing) throw conflict("User is already a member");

  await db
    .insert(groupMembers)
    .values({ groupId, userId: target.id, role: body.role ?? "member" });

  await notify({
    kind: "added_to_group",
    groupId,
    recipientId: target.id,
    actorId: actor.id,
    role: body.role ?? "member",
  });

  return c.json(await listMembers(groupId), 201);
});

const updateRoleSchema = z.object({ role: z.enum(["admin", "member"]) });

groupMembersRoutes.patch("/:userId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const targetId = c.req.param("userId")!;
  const actor = c.get("user");
  await requireGroupAdmin(groupId, actor.id);
  const { role } = await parseJson(c, updateRoleSchema);

  // Sole-admin self-demotion guard.
  if (targetId === actor.id && role !== "admin") {
    const adminCount = await countAdmins(groupId);
    if (adminCount <= 1) {
      throw forbidden("Cannot demote yourself as the only admin");
    }
  }

  const [updated] = await db
    .update(groupMembers)
    .set({ role })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetId)))
    .returning();
  if (!updated) throw notFound("Member not found");

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);
  return c.json(toMemberResponse(updated, user as User));
});

groupMembersRoutes.delete("/:userId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const targetId = c.req.param("userId")!;
  const actor = c.get("user");
  const actorMember = await requireGroupMember(groupId, actor.id);

  const isSelf = targetId === actor.id;
  if (!isSelf && actorMember.role !== "admin") {
    throw forbidden("Cannot remove another member");
  }

  // Sole-admin self-removal guard.
  if (isSelf) {
    const [m] = await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, actor.id)))
      .limit(1);
    if (m?.role === "admin" && (await countAdmins(groupId)) <= 1) {
      throw forbidden("Cannot remove yourself as the only admin");
    }
  }

  // Reject removal if the member has outstanding balance in the group.
  const nets = await computeUserNetCents(groupId);
  const balance = nets.get(targetId) ?? 0;
  if (balance !== 0) {
    throw unprocessable("Member has outstanding debts", "UNSETTLED_BALANCES");
  }

  const deleted = await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetId)))
    .returning({ groupId: groupMembers.groupId });
  if (deleted.length === 0) throw notFound("Member not found");

  if (!isSelf) {
    await notify({
      kind: "member_removed",
      groupId,
      recipientId: targetId,
      actorId: actor.id,
    });
  }

  return c.body(null, 204);
});

async function countAdmins(groupId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, "admin")));
  return row?.n ?? 0;
}

async function listMembers(groupId: string) {
  const rows = await db
    .select({
      member: groupMembers,
      user: users,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId));
  return rows.map((r) => toMemberResponse(r.member, r.user));
}

export { listMembers };

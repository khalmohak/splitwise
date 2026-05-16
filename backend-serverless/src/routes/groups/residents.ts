import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { groupMembers } from "../../db/schema/groups.js";
import { users } from "../../db/schema/users.js";
import { type AuthVariables } from "../../lib/auth.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { requireGroupAdmin, requireGroupMember } from "../../lib/guards.js";
import { parseJson } from "../../lib/http.js";

export const groupResidents = new Hono<{ Variables: AuthVariables }>();

function presentResident(
  member: typeof groupMembers.$inferSelect,
  user: typeof users.$inferSelect,
) {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    role: member.role,
    status: member.status,
    roomLabel: member.roomLabel,
    moveInDate: member.moveInDate,
    moveOutDate: member.moveOutDate,
    billingStartPolicy: member.billingStartPolicy,
    billingEndPolicy: member.billingEndPolicy,
    joinedAt: member.joinedAt.toISOString(),
  };
}

groupResidents.get("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const rows = await db
    .select({
      member: groupMembers,
      user: users,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId));

  return c.json({
    residents: rows.map((row) => presentResident(row.member, row.user)),
  });
});

const patchResidentSchema = z.object({
  role: z.enum(["admin", "member"]).optional(),
  status: z.enum(["active", "leaving", "left"]).optional(),
  roomLabel: z.string().trim().max(120).nullable().optional(),
  moveInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  moveOutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  billingStartPolicy: z.enum(["next_cycle", "custom_prorated", "end_of_cycle"]).optional(),
  billingEndPolicy: z.enum(["next_cycle", "custom_prorated", "end_of_cycle"]).optional(),
});

groupResidents.patch("/:userId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const targetId = c.req.param("userId")!;
  const actor = c.get("user");
  await requireGroupAdmin(groupId, actor.id);
  const body = await parseJson(c, patchResidentSchema);

  const [row] = await db
    .update(groupMembers)
    .set(body)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetId)))
    .returning();
  if (!row) throw notFound("Resident not found");

  const [user] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
  if (!user) throw notFound("Resident not found");
  return c.json({ resident: presentResident(row, user) });
});

const leaveSchema = z.object({
  lastDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  billingEndPolicy: z.enum(["next_cycle", "custom_prorated", "end_of_cycle"]).optional(),
});

groupResidents.post("/:userId/leave", async (c) => {
  const groupId = c.req.param("groupId")!;
  const targetId = c.req.param("userId")!;
  const actor = c.get("user");
  const actorMember = await requireGroupMember(groupId, actor.id);
  if (actor.id !== targetId && actorMember.role !== "admin") {
    throw forbidden("Not allowed to mark this resident as leaving");
  }

  const { lastDay, billingEndPolicy } = await parseJson(c, leaveSchema);
  const today = new Date().toISOString().slice(0, 10);
  const nextStatus = lastDay <= today ? "left" : "leaving";

  const [row] = await db
    .update(groupMembers)
    .set({
      status: nextStatus,
      moveOutDate: lastDay,
      billingEndPolicy: billingEndPolicy ?? "end_of_cycle",
    })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetId)))
    .returning();
  if (!row) throw notFound("Resident not found");

  const [user] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
  if (!user) throw notFound("Resident not found");
  return c.json({ resident: presentResident(row, user) });
});

groupResidents.post("/:userId/cancel-leave", async (c) => {
  const groupId = c.req.param("groupId")!;
  const targetId = c.req.param("userId")!;
  const actor = c.get("user");
  const actorMember = await requireGroupMember(groupId, actor.id);
  if (actor.id !== targetId && actorMember.role !== "admin") {
    throw forbidden("Not allowed to cancel leave for this resident");
  }

  const [row] = await db
    .update(groupMembers)
    .set({
      status: "active",
      moveOutDate: null,
      billingEndPolicy: "end_of_cycle",
    })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetId)))
    .returning();
  if (!row) throw notFound("Resident not found");

  const [user] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
  if (!user) throw notFound("Resident not found");
  return c.json({ resident: presentResident(row, user) });
});

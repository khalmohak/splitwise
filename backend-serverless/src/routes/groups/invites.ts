import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { groupInvites } from "../../db/schema/group-invites.js";
import { groups } from "../../db/schema/groups.js";
import { users } from "../../db/schema/users.js";
import { type AuthVariables } from "../../lib/auth.js";
import { enqueueAsyncJob } from "../../lib/async-jobs.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { inviteUrl } from "../../lib/email/links.js";
import { requireGroupAdmin } from "../../lib/guards.js";
import { parseJson } from "../../lib/http.js";

export const groupTrackedInvites = new Hono<{ Variables: AuthVariables }>();

function createInviteToken(): string {
  return randomBytes(18).toString("base64url");
}

function presentInvite(
  invite: typeof groupInvites.$inferSelect,
  invitedBy?: Pick<typeof users.$inferSelect, "id" | "name">,
  acceptedBy?: Pick<typeof users.$inferSelect, "id" | "name">,
) {
  return {
    id: invite.id,
    inviteToken: invite.inviteToken,
    inviteType: invite.inviteType,
    phone: invite.phone,
    email: invite.email,
    intendedName: invite.intendedName,
    roomLabel: invite.roomLabel,
    intendedMoveInDate: invite.intendedMoveInDate,
    status: invite.status,
    invitedBy: invitedBy ? { id: invitedBy.id, name: invitedBy.name } : null,
    acceptedBy: acceptedBy ? { id: acceptedBy.id, name: acceptedBy.name } : null,
    acceptedAt: invite.acceptedAt?.toISOString() ?? null,
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    createdAt: invite.createdAt.toISOString(),
    updatedAt: invite.updatedAt.toISOString(),
  };
}

const createInviteSchema = z.object({
  inviteType: z.enum(["link", "phone", "email"]).optional(),
  phone: z.string().trim().min(1).max(40).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  intendedName: z.string().trim().min(1).max(120).nullable().optional(),
  roomLabel: z.string().trim().max(120).nullable().optional(),
  intendedMoveInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  expiresInDays: z.number().int().min(1).max(90).optional(),
});

async function loadGroupName(groupId: string): Promise<string> {
  const [group] = await db
    .select({ name: groups.name })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) throw notFound("Group not found");
  return group.name;
}

async function enqueueTrackedInviteEmail(input: {
  invite: typeof groupInvites.$inferSelect;
  groupName: string;
  inviterName: string;
}) {
  if (input.invite.inviteType !== "email" || !input.invite.email) return;

  await enqueueAsyncJob({
    type: "group_invite_email",
    to: input.invite.email,
    groupName: input.groupName,
    inviterName: input.inviterName,
    inviteUrl: inviteUrl(input.invite.inviteToken),
  });
}

groupTrackedInvites.post("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupAdmin(groupId, actor.id);

  const body = await parseJson(c, createInviteSchema);
  const inviteType = body.inviteType ?? "link";
  if (inviteType === "phone" && !body.phone) {
    throw badRequest("phone is required for phone invites", "PHONE_REQUIRED");
  }
  if (inviteType === "email" && !body.email) {
    throw badRequest("email is required for email invites", "EMAIL_REQUIRED");
  }

  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + (body.expiresInDays ?? 14));

  const [invite] = await db
    .insert(groupInvites)
    .values({
      groupId,
      inviteToken: createInviteToken(),
      inviteType,
      phone: body.phone ?? null,
      email: body.email ? body.email.toLowerCase() : null,
      intendedName: body.intendedName ?? null,
      roomLabel: body.roomLabel ?? null,
      intendedMoveInDate: body.intendedMoveInDate ?? null,
      status: "pending",
      invitedById: actor.id,
      expiresAt,
    })
    .returning();

  if (invite) {
    await enqueueTrackedInviteEmail({
      invite,
      groupName: await loadGroupName(groupId),
      inviterName: actor.name,
    });
  }

  return c.json({ invite: presentInvite(invite!, actor) }, 201);
});

groupTrackedInvites.get("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupAdmin(groupId, actor.id);

  const rows = await db
    .select({
      invite: groupInvites,
      inviter: users,
    })
    .from(groupInvites)
    .innerJoin(users, eq(users.id, groupInvites.invitedById))
    .where(eq(groupInvites.groupId, groupId))
    .orderBy(desc(groupInvites.createdAt));

  return c.json({
    invites: rows.map((row) => presentInvite(row.invite, row.inviter)),
  });
});

groupTrackedInvites.post("/:inviteId/revoke", async (c) => {
  const groupId = c.req.param("groupId")!;
  const inviteId = c.req.param("inviteId")!;
  const actor = c.get("user");
  await requireGroupAdmin(groupId, actor.id);

  const [invite] = await db
    .update(groupInvites)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(and(eq(groupInvites.groupId, groupId), eq(groupInvites.id, inviteId)))
    .returning();
  if (!invite) throw notFound("Invite not found");

  await enqueueTrackedInviteEmail({
    invite,
    groupName: await loadGroupName(groupId),
    inviterName: actor.name,
  });

  return c.json({ invite: presentInvite(invite, actor) });
});

groupTrackedInvites.post("/:inviteId/resend", async (c) => {
  const groupId = c.req.param("groupId")!;
  const inviteId = c.req.param("inviteId")!;
  const actor = c.get("user");
  await requireGroupAdmin(groupId, actor.id);

  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 14);

  const [invite] = await db
    .update(groupInvites)
    .set({
      status: "pending",
      expiresAt,
      updatedAt: new Date(),
    })
    .where(and(eq(groupInvites.groupId, groupId), eq(groupInvites.id, inviteId)))
    .returning();
  if (!invite) throw notFound("Invite not found");

  return c.json({ invite: presentInvite(invite, actor) });
});

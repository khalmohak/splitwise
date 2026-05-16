// /api/invites/:code — public preview + join. Both endpoints require auth
// (the caller's identity is what we use to join them), but no group
// membership.

import { Hono } from "hono";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { groups, groupMembers } from "../db/schema/groups.js";
import { groupInvites } from "../db/schema/group-invites.js";
import { uploadedFiles } from "../db/schema/uploaded-files.js";
import { requireAuth, type AuthVariables } from "../lib/auth.js";
import { notFound } from "../lib/errors.js";
import { parseJson } from "../lib/http.js";

export const invites = new Hono<{ Variables: AuthVariables }>();

invites.use("*", requireAuth);

function isInviteExpired(invite: typeof groupInvites.$inferSelect): boolean {
  return !!invite.expiresAt && invite.expiresAt.getTime() < Date.now();
}

async function loadTrackedInvite(token: string) {
  const [invite] = await db
    .select()
    .from(groupInvites)
    .where(eq(groupInvites.inviteToken, token))
    .limit(1);
  if (!invite) return null;
  if (invite.status !== "pending" || isInviteExpired(invite)) return null;
  return invite;
}

invites.post("/:token/preview", async (c) => {
  const token = c.req.param("token")!;
  const actor = c.get("user");
  const invite = await loadTrackedInvite(token);
  if (!invite) throw notFound("Invite link is invalid or has expired");

  const [group] = await db
    .select()
    .from(groups)
    .where(eq(groups.id, invite.groupId))
    .limit(1);
  if (!group) throw notFound("Invite link is invalid or has expired");

  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, group.id), ne(groupMembers.status, "left")))) as [
    { n: number },
  ];

  const [self] = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, group.id),
        eq(groupMembers.userId, actor.id),
        ne(groupMembers.status, "left"),
      ),
    )
    .limit(1);

  const [coverFile] = group.coverFileId
    ? await db
        .select({ publicUrl: uploadedFiles.publicUrl })
        .from(uploadedFiles)
        .where(eq(uploadedFiles.id, group.coverFileId))
        .limit(1)
    : [];

  return c.json({
    invite: {
      id: invite.id,
      inviteType: invite.inviteType,
      roomLabel: invite.roomLabel,
      intendedMoveInDate: invite.intendedMoveInDate,
      intendedName: invite.intendedName,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
    },
    group: {
      id: group.id,
      name: group.name,
      type: group.type,
      city: group.city,
      locality: group.locality,
      apartmentName: group.apartmentName,
      unitLabel: group.unitLabel,
      coverFileId: group.coverFileId,
      coverUrl: coverFile?.publicUrl ?? null,
      memberCount: n,
    },
    alreadyMember: !!self,
  });
});

const acceptInviteSchema = z.object({
  moveInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  roomLabel: z.string().trim().max(120).nullable().optional(),
});

invites.post("/:token/accept", async (c) => {
  const token = c.req.param("token")!;
  const actor = c.get("user");
  const invite = await loadTrackedInvite(token);
  if (!invite) throw notFound("Invite link is invalid or has expired");
  const body = await parseJson(c, acceptInviteSchema);

  const moveInDate = body.moveInDate ?? invite.intendedMoveInDate ?? new Date().toISOString().slice(0, 10);
  const roomLabel = body.roomLabel ?? invite.roomLabel ?? null;

  await db
    .insert(groupMembers)
    .values({
      groupId: invite.groupId,
      userId: actor.id,
      role: "member",
      status: "active",
      moveInDate,
      roomLabel,
    })
    .onConflictDoUpdate({
      target: [groupMembers.groupId, groupMembers.userId],
      set: {
        role: "member",
        status: "active",
        moveInDate,
        roomLabel,
        moveOutDate: null,
        billingStartPolicy: "next_cycle",
        billingEndPolicy: "end_of_cycle",
      },
    });

  await db
    .update(groupInvites)
    .set({
      status: "accepted",
      acceptedByUserId: actor.id,
      acceptedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(groupInvites.id, invite.id));

  return c.json({ groupId: invite.groupId });
});

invites.get("/:code", async (c) => {
  const code = c.req.param("code")!;
  const actor = c.get("user");
  const [group] = await db
    .select()
    .from(groups)
    .where(eq(groups.inviteCode, code))
    .limit(1);
  if (!group) throw notFound("Invite link is invalid or has been revoked");

  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, group.id), ne(groupMembers.status, "left")))) as [
    { n: number },
  ];

  const [self] = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, group.id),
        eq(groupMembers.userId, actor.id),
        ne(groupMembers.status, "left"),
      ),
    )
    .limit(1);

  const [coverFile] = group.coverFileId
    ? await db
        .select({ publicUrl: uploadedFiles.publicUrl })
        .from(uploadedFiles)
        .where(eq(uploadedFiles.id, group.coverFileId))
        .limit(1)
    : [];

  return c.json({
    group: {
      id: group.id,
      name: group.name,
      type: group.type,
      city: group.city,
      locality: group.locality,
      apartmentName: group.apartmentName,
      unitLabel: group.unitLabel,
      coverFileId: group.coverFileId,
      coverUrl: coverFile?.publicUrl ?? null,
      memberCount: n,
    },
    alreadyMember: !!self,
  });
});

invites.post("/:code/join", async (c) => {
  const code = c.req.param("code")!;
  const actor = c.get("user");
  const [group] = await db
    .select()
    .from(groups)
    .where(eq(groups.inviteCode, code))
    .limit(1);
  if (!group) throw notFound("Invite link is invalid or has been revoked");

  await db
    .insert(groupMembers)
    .values({
      groupId: group.id,
      userId: actor.id,
      role: "member",
      status: "active",
      moveInDate: new Date().toISOString().slice(0, 10),
    })
    .onConflictDoUpdate({
      target: [groupMembers.groupId, groupMembers.userId],
      set: {
        role: "member",
        status: "active",
        moveOutDate: null,
      },
    });

  return c.json({ groupId: group.id });
});

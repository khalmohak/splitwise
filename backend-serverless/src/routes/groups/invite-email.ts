import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { groupMembers, groups } from "../../db/schema/groups.js";
import { users } from "../../db/schema/users.js";
import { type AuthVariables } from "../../lib/auth.js";
import { enqueueAsyncJob } from "../../lib/async-jobs.js";
import { inviteUrl, ensureInviteCode } from "../../lib/invite-codes.js";
import { conflict, notFound } from "../../lib/errors.js";
import { requireGroupAdmin } from "../../lib/guards.js";
import { parseJson } from "../../lib/http.js";

export const groupInviteEmailRoutes = new Hono<{ Variables: AuthVariables }>();

const schema = z.object({
  email: z.string().trim().email(),
});

groupInviteEmailRoutes.post("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupAdmin(groupId, actor.id);

  const { email } = await parseJson(c, schema);
  const normalizedEmail = email.toLowerCase();

  const [group] = await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) throw notFound("Group not found");

  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);
  if (existingUser) {
    const [membership] = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.userId, existingUser.id),
        ),
      )
      .limit(1);
    if (membership) throw conflict("That person is already in this room");
  }

  const code = await ensureInviteCode(groupId);
  const url = inviteUrl(code);

  await enqueueAsyncJob({
    type: "group_invite_email",
    to: normalizedEmail,
    groupName: group.name,
    inviterName: actor.name,
    inviteUrl: url,
  });

  return c.json({ email: normalizedEmail, code, url });
});

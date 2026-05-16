import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { groups } from "../../db/schema/groups.js";
import { type AuthVariables } from "../../lib/auth.js";
import { inviteUrl, setFreshInviteCode } from "../../lib/invite-codes.js";
import { requireGroupAdmin } from "../../lib/guards.js";
import { notFound } from "../../lib/errors.js";

export const groupInviteCode = new Hono<{ Variables: AuthVariables }>();

groupInviteCode.post("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const user = c.get("user");
  await requireGroupAdmin(groupId, user.id);
  const code = await setFreshInviteCode(groupId);
  return c.json({ code, url: inviteUrl(code) });
});

groupInviteCode.delete("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const user = c.get("user");
  await requireGroupAdmin(groupId, user.id);
  await db
    .update(groups)
    .set({ inviteCode: null, updatedAt: new Date() })
    .where(eq(groups.id, groupId));
  return c.body(null, 204);
});

import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "../db/client.js";
import { groups } from "../db/schema/groups.js";
import { notFound } from "./errors.js";
import { inviteUrl } from "./email/links.js";

export async function generateUniqueInviteCode(): Promise<string> {
  for (let i = 0; i < 5; i += 1) {
    const code = randomBytes(6).toString("base64url");
    const [existing] = await db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.inviteCode, code))
      .limit(1);
    if (!existing) return code;
  }
  throw new Error("could not allocate unique invite code");
}

export async function setFreshInviteCode(groupId: string): Promise<string> {
  const code = await generateUniqueInviteCode();
  const [row] = await db
    .update(groups)
    .set({ inviteCode: code, updatedAt: new Date() })
    .where(eq(groups.id, groupId))
    .returning({ inviteCode: groups.inviteCode });
  if (!row?.inviteCode) throw notFound("Group not found");
  return row.inviteCode;
}

export async function ensureInviteCode(groupId: string): Promise<string> {
  const [group] = await db
    .select({ id: groups.id, inviteCode: groups.inviteCode })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) throw notFound("Group not found");
  if (group.inviteCode) return group.inviteCode;
  return setFreshInviteCode(groupId);
}

export { inviteUrl };

import { and, eq, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { groupMembers, type GroupMember } from "../db/schema/groups.js";
import { forbidden, notFound } from "./errors.js";

export type MemberContext = GroupMember;

// Asserts the user belongs to the group. Returns the membership row (so
// callers can inspect role without a second query).
export async function requireGroupMember(
  groupId: string,
  userId: string,
): Promise<MemberContext> {
  const [row] = await db
    .select()
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        ne(groupMembers.status, "left"),
      ),
    )
    .limit(1);
  if (!row) throw notFound("Group not found");
  return row;
}

export async function requireGroupAdmin(
  groupId: string,
  userId: string,
): Promise<MemberContext> {
  const m = await requireGroupMember(groupId, userId);
  if (m.role !== "admin") throw forbidden("Admin required");
  return m;
}

export function isAdmin(m: MemberContext | null | undefined): boolean {
  return !!m && m.role === "admin";
}

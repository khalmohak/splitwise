import { Hono } from "hono";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { depositLedgerEntries } from "../../db/schema/deposit-ledger-entries.js";
import { groupMembers } from "../../db/schema/groups.js";
import { users } from "../../db/schema/users.js";
import { type AuthVariables } from "../../lib/auth.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { requireGroupMember } from "../../lib/guards.js";
import { parseJson } from "../../lib/http.js";
import { isMoneyString, parseMoneyToCents, formatCents } from "../../lib/money.js";

export const groupDeposits = new Hono<{ Variables: AuthVariables }>();

const entrySchema = z.object({
  entryType: z.enum(["contribution", "transfer", "refund", "deduction"]),
  amount: z.string(),
  fromUserId: z.string().uuid().nullable().optional(),
  toUserId: z.string().uuid().nullable().optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  proofFileId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

async function assertResidentsExist(groupId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        inArray(groupMembers.userId, userIds),
      ),
    );
  const found = new Set(rows.map((row) => row.userId));
  for (const userId of userIds) {
    if (!found.has(userId)) throw notFound("Resident not found");
  }
}

groupDeposits.get("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const rows = await db
    .select()
    .from(depositLedgerEntries)
    .where(eq(depositLedgerEntries.groupId, groupId))
    .orderBy(asc(depositLedgerEntries.effectiveDate), asc(depositLedgerEntries.createdAt));

  const userIds = Array.from(
    new Set(
      rows.flatMap((row) => [row.fromUserId, row.toUserId]).filter((id): id is string => !!id),
    ),
  );
  const userRows = userIds.length
    ? await db.select().from(users).where(inArray(users.id, userIds))
    : [];
  const userById = new Map(userRows.map((row) => [row.id, row]));

  const netByUser = new Map<string, number>();
  for (const row of rows) {
    const cents = parseMoneyToCents(row.amount);
    if (row.toUserId) netByUser.set(row.toUserId, (netByUser.get(row.toUserId) ?? 0) + cents);
    if (row.fromUserId) netByUser.set(row.fromUserId, (netByUser.get(row.fromUserId) ?? 0) - cents);
  }

  return c.json({
    entries: rows.map((row) => ({
      id: row.id,
      entryType: row.entryType,
      amount: row.amount,
      fromUser: row.fromUserId
        ? {
            id: row.fromUserId,
            name: userById.get(row.fromUserId)?.name ?? "",
            avatarUrl: userById.get(row.fromUserId)?.avatarUrl ?? null,
          }
        : null,
      toUser: row.toUserId
        ? {
            id: row.toUserId,
            name: userById.get(row.toUserId)?.name ?? "",
            avatarUrl: userById.get(row.toUserId)?.avatarUrl ?? null,
          }
        : null,
      effectiveDate: row.effectiveDate,
      proofFileId: row.proofFileId,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
    })),
    netByUser: Array.from(netByUser.entries()).map(([userId, cents]) => ({
      userId,
      name: userById.get(userId)?.name ?? "",
      avatarUrl: userById.get(userId)?.avatarUrl ?? null,
      netAmount: formatCents(cents),
    })),
  });
});

groupDeposits.post("/entries", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  const body = await parseJson(c, entrySchema);
  if (!isMoneyString(body.amount)) {
    throw badRequest("Amount must be a money string", "INVALID_AMOUNT");
  }

  const residentIds = [body.fromUserId, body.toUserId].filter((id): id is string => !!id);
  await assertResidentsExist(groupId, residentIds);

  const [entry] = await db
    .insert(depositLedgerEntries)
    .values({
      groupId,
      entryType: body.entryType,
      amount: body.amount,
      fromUserId: body.fromUserId ?? null,
      toUserId: body.toUserId ?? null,
      effectiveDate: body.effectiveDate,
      proofFileId: body.proofFileId ?? null,
      notes: body.notes ?? null,
      createdById: actor.id,
    })
    .returning();

  return c.json({ entry }, 201);
});

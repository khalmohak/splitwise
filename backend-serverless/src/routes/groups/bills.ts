import { Hono } from "hono";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, txClient } from "../../db/client.js";
import { billInstances } from "../../db/schema/bill-instances.js";
import { billTemplates } from "../../db/schema/bill-templates.js";
import { expenseParticipants } from "../../db/schema/expense-participants.js";
import { expenses } from "../../db/schema/expenses.js";
import { uploadedFiles } from "../../db/schema/uploaded-files.js";
import { users } from "../../db/schema/users.js";
import { type AuthVariables } from "../../lib/auth.js";
import {
  BillSplitSnapshotEntry,
  ResidentSnapshotEntry,
  computeBillParticipantShares,
  deriveBillStatus,
  ensureCurrentBillInstances,
  todayDateOnly,
} from "../../lib/households.js";
import { conflict, notFound, unprocessable } from "../../lib/errors.js";
import { requireGroupAdmin, requireGroupMember } from "../../lib/guards.js";
import { parseJson } from "../../lib/http.js";
import { isMoneyString } from "../../lib/money.js";

export const groupBills = new Hono<{ Variables: AuthVariables }>();

function parseResidentSnapshot(raw: unknown): ResidentSnapshotEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      userId: String(entry.userId),
      name: String(entry.name ?? ""),
      avatarUrl: typeof entry.avatarUrl === "string" ? entry.avatarUrl : null,
      roomLabel: typeof entry.roomLabel === "string" ? entry.roomLabel : null,
      moveInDate: typeof entry.moveInDate === "string" ? entry.moveInDate : null,
      moveOutDate: typeof entry.moveOutDate === "string" ? entry.moveOutDate : null,
      status:
        entry.status === "left" || entry.status === "leaving" || entry.status === "active"
          ? entry.status
          : "active",
    }));
}

function parseSplitSnapshot(raw: unknown): BillSplitSnapshotEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      userId: String(entry.userId),
      weight: Number(entry.weight ?? 1) || 1,
      roomLabel: typeof entry.roomLabel === "string" ? entry.roomLabel : null,
      splitInput: typeof entry.splitInput === "string" ? entry.splitInput : null,
    }));
}

async function presentBills(rows: Array<{
  bill: typeof billInstances.$inferSelect;
  template: typeof billTemplates.$inferSelect;
}>) {
  const userIds = Array.from(
    new Set(
      rows.flatMap(({ bill }) => [
        bill.defaultPayerUserId,
        bill.actualPayerUserId,
      ]).filter((id): id is string => !!id),
    ),
  );
  const payerRows = userIds.length
    ? await db.select().from(users).where(inArray(users.id, userIds))
    : [];
  const payerById = new Map(payerRows.map((row) => [row.id, row]));

  return rows.map(({ bill, template }) => {
    const residents = parseResidentSnapshot(bill.residentSnapshot);
    return {
      id: bill.id,
      templateId: bill.templateId,
      label: bill.label,
      billKind: template.billKind,
      amount: bill.amount,
      status: deriveBillStatus(bill),
      dueDate: bill.dueDate,
      periodStart: bill.periodStart,
      periodEnd: bill.periodEnd,
      defaultPayer: bill.defaultPayerUserId
        ? payerById.get(bill.defaultPayerUserId)
          ? {
              id: bill.defaultPayerUserId,
              name: payerById.get(bill.defaultPayerUserId)!.name,
              avatarUrl: payerById.get(bill.defaultPayerUserId)!.avatarUrl,
            }
          : null
        : null,
      actualPayer: bill.actualPayerUserId
        ? payerById.get(bill.actualPayerUserId)
          ? {
              id: bill.actualPayerUserId,
              name: payerById.get(bill.actualPayerUserId)!.name,
              avatarUrl: payerById.get(bill.actualPayerUserId)!.avatarUrl,
            }
          : null
        : null,
      residentCount: residents.length,
      residents,
      proofFileId: bill.proofFileId,
      generatedExpenseId: bill.generatedExpenseId,
      createdAt: bill.createdAt.toISOString(),
      updatedAt: bill.updatedAt.toISOString(),
    };
  });
}

async function assertProofFileAccessible(fileId: string | null | undefined, actorId: string, groupId: string) {
  if (!fileId) return;
  const [file] = await db
    .select()
    .from(uploadedFiles)
    .where(eq(uploadedFiles.id, fileId))
    .limit(1);
  if (!file) throw notFound("File not found");
  if (file.ownerId !== actorId && file.groupId !== groupId) {
    throw notFound("File not found");
  }
}

groupBills.get("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  await ensureCurrentBillInstances(groupId);

  const status = c.req.query("status");
  const rows = await db
    .select({
      bill: billInstances,
      template: billTemplates,
    })
    .from(billInstances)
    .innerJoin(billTemplates, eq(billTemplates.id, billInstances.templateId))
    .where(eq(billInstances.groupId, groupId))
    .orderBy(asc(billInstances.dueDate), asc(billInstances.createdAt));

  const filtered =
    status && ["scheduled", "due", "overdue", "paid", "skipped", "cancelled"].includes(status)
      ? rows.filter((row) => deriveBillStatus(row.bill) === status || row.bill.status === status)
      : rows;

  return c.json({ bills: await presentBills(filtered) });
});

const markPaidSchema = z.object({
  amount: z.string().optional(),
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  proofFileId: z.string().uuid().nullable().optional(),
});

groupBills.post("/:billId/mark-paid", async (c) => {
  const groupId = c.req.param("groupId")!;
  const billId = c.req.param("billId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  const body = await parseJson(c, markPaidSchema);

  const [row] = await db
    .select({
      bill: billInstances,
      template: billTemplates,
    })
    .from(billInstances)
    .innerJoin(billTemplates, eq(billTemplates.id, billInstances.templateId))
    .where(and(eq(billInstances.groupId, groupId), eq(billInstances.id, billId)))
    .limit(1);
  if (!row) throw notFound("Bill not found");
  if (row.bill.status === "paid" || row.bill.generatedExpenseId) {
    throw conflict("Bill is already paid", "BILL_ALREADY_PAID");
  }
  if (row.bill.status === "skipped" || row.bill.status === "cancelled") {
    throw unprocessable("Bill is not payable in its current state", "BILL_NOT_PAYABLE");
  }

  await assertProofFileAccessible(body.proofFileId, actor.id, groupId);

  const amount = body.amount ?? row.bill.amount ?? undefined;
  if (!amount || !isMoneyString(amount)) {
    throw unprocessable("A valid amount is required to mark this bill paid", "AMOUNT_REQUIRED");
  }
  const paidDate = body.paidDate ?? todayDateOnly();
  const splitSnapshot = parseSplitSnapshot(row.bill.splitSnapshot);
  const residents = parseResidentSnapshot(row.bill.residentSnapshot);
  if (residents.length === 0 || splitSnapshot.length === 0) {
    throw unprocessable("Bill has no resident snapshot to split against", "EMPTY_BILL_SNAPSHOT");
  }
  const shares = computeBillParticipantShares(amount, splitSnapshot);
  if (shares.length === 0) {
    throw unprocessable("Bill has no payable participants", "EMPTY_BILL_SHARES");
  }

  const tx = txClient();
  const result = await tx.transaction(async (tx2) => {
    const [expense] = await tx2
      .insert(expenses)
      .values({
        groupId,
        paidById: actor.id,
        amount,
        description: row.bill.label,
        categoryId: null,
        splitType: "exact",
        date: paidDate,
        notes: body.notes ?? row.template.notes ?? null,
        isRecurring: true,
        recurInterval: row.template.cadence,
        recurAnchor: row.bill.periodStart,
        createdById: actor.id,
      })
      .returning();
    if (!expense) throw new Error("expense insert returned no row");

    await tx2.insert(expenseParticipants).values(
      shares.map((share) => ({
        expenseId: expense.id,
        userId: share.userId,
        shareAmount: share.shareAmount,
        splitInput: share.splitInput,
      })),
    );

    const [updatedBill] = await tx2
      .update(billInstances)
      .set({
        status: "paid",
        amount,
        actualPayerUserId: actor.id,
        paidAt: new Date(`${paidDate}T00:00:00Z`),
        proofFileId: body.proofFileId ?? row.bill.proofFileId ?? null,
        generatedExpenseId: expense.id,
        updatedAt: new Date(),
      })
      .where(eq(billInstances.id, billId))
      .returning();
    if (!updatedBill) throw new Error("bill update returned no row");

    return { bill: updatedBill, expenseId: expense.id };
  });

  const [updatedRow] = await db
    .select({
      bill: billInstances,
      template: billTemplates,
    })
    .from(billInstances)
    .innerJoin(billTemplates, eq(billTemplates.id, billInstances.templateId))
    .where(eq(billInstances.id, billId))
    .limit(1);

  return c.json({
    bill: (await presentBills([updatedRow!]))[0],
    expenseId: result.expenseId,
  });
});

groupBills.post("/:billId/skip", async (c) => {
  const groupId = c.req.param("groupId")!;
  const billId = c.req.param("billId")!;
  const actor = c.get("user");
  await requireGroupAdmin(groupId, actor.id);

  const [bill] = await db
    .update(billInstances)
    .set({ status: "skipped", updatedAt: new Date() })
    .where(and(eq(billInstances.groupId, groupId), eq(billInstances.id, billId)))
    .returning();
  if (!bill) throw notFound("Bill not found");

  return c.json({ bill });
});

const attachProofSchema = z.object({
  proofFileId: z.string().uuid(),
});

groupBills.post("/:billId/attach-proof", async (c) => {
  const groupId = c.req.param("groupId")!;
  const billId = c.req.param("billId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  const { proofFileId } = await parseJson(c, attachProofSchema);
  await assertProofFileAccessible(proofFileId, actor.id, groupId);

  const [bill] = await db
    .update(billInstances)
    .set({ proofFileId, updatedAt: new Date() })
    .where(and(eq(billInstances.groupId, groupId), eq(billInstances.id, billId)))
    .returning();
  if (!bill) throw notFound("Bill not found");

  return c.json({ bill });
});

import { Hono } from "hono";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { settlements, type Settlement } from "../../db/schema/settlements.js";
import { groupMembers } from "../../db/schema/groups.js";
import { users } from "../../db/schema/users.js";
import { type AuthVariables } from "../../lib/auth.js";
import { parseJson } from "../../lib/http.js";
import {
  forbidden,
  notFound,
  unprocessable,
  validationError,
} from "../../lib/errors.js";
import { requireGroupMember } from "../../lib/guards.js";
import { isMoneyString, parseMoneyToCents } from "../../lib/money.js";
import { isDateOnly } from "../../lib/date-utils.js";
import { buildPaginationMeta, parsePagination } from "../../lib/pagination.js";
import { recordAudit } from "../../lib/audit.js";
import { notify } from "../../lib/notify.js";
import { toSettlementResponse, toUserMini } from "../../lib/presenters.js";
import {
  centsToMoney,
  computePairwiseCents,
  computeUserNetCents,
  simplifyTransfers,
} from "../../lib/balances.js";

export const groupSettlements = new Hono<{ Variables: AuthVariables }>();

// ---------- helpers --------------------------------------------------------

async function loadUserMini(ids: string[]) {
  if (ids.length === 0) return new Map<string, { id: string; name: string; avatarUrl: string | null }>();
  const rows = await db
    .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

async function presentSettlement(s: Settlement) {
  const u = await loadUserMini([s.paidById, s.paidToId]);
  return toSettlementResponse(s, u.get(s.paidById)!, u.get(s.paidToId)!);
}

async function buildSuggestionList(groupId: string, viewerId?: string) {
  const nets = await computeUserNetCents(groupId);
  const edges = simplifyTransfers(nets);
  const userById = await loadUserMini(
    Array.from(new Set(edges.flatMap((e) => [e.fromId, e.toId]))),
  );
  const totalCents = edges.reduce((a, e) => a + e.cents, 0);

  const suggestions = edges.map((e) => {
    const from = userById.get(e.fromId)!;
    const to = userById.get(e.toId)!;
    const direction: "you_pay" | "you_receive" | "other" =
      viewerId === e.fromId
        ? "you_pay"
        : viewerId === e.toId
          ? "you_receive"
          : "other";
    return {
      from: toUserMini(from),
      to: toUserMini(to),
      amount: centsToMoney(e.cents),
      direction,
      involvesYou: direction !== "other",
      summary:
        direction === "you_pay"
          ? `Pay ${to.name} ${centsToMoney(e.cents)}`
          : direction === "you_receive"
            ? `Receive ${centsToMoney(e.cents)} from ${from.name}`
            : `${from.name} pays ${to.name} ${centsToMoney(e.cents)}`,
    };
  });

  return {
    groupId,
    asOf: new Date().toISOString(),
    transactionCount: edges.length,
    totalAmount: centsToMoney(totalCents),
    suggestions,
    yourSuggestions: suggestions.filter((s) => s.involvesYou),
  };
}

async function createSettlementCore(
  groupId: string,
  actorId: string,
  actorName: string,
  input: {
    paidById: string;
    paidToId: string;
    amount: string;
    date: string;
    notes: string | null;
  },
): Promise<Settlement> {
  // Membership of both parties.
  const memberRows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        inArray(groupMembers.userId, [input.paidById, input.paidToId]),
      ),
    );
  if (memberRows.length < 2) {
    throw unprocessable("Both users must be group members");
  }

  // Auto-confirm if actor is the receiver — they're acknowledging payment.
  const autoConfirm = actorId === input.paidToId;

  const [created] = await db
    .insert(settlements)
    .values({
      groupId,
      paidById: input.paidById,
      paidToId: input.paidToId,
      amount: input.amount,
      date: input.date,
      notes: input.notes,
      status: autoConfirm ? "confirmed" : "pending",
      reviewedAt: autoConfirm ? new Date() : null,
    })
    .returning();
  if (!created) throw new Error("settlement insert returned nothing");

  await recordAudit({
    groupId,
    actorId,
    action: "created",
    resourceType: "settlement",
    resourceId: created.id,
    summary: `${actorName} recorded a payment of ${input.amount}`,
    after: created as unknown as Record<string, unknown>,
  });

  if (!autoConfirm) {
    await notify({
      kind: "settlement_request",
      settlementId: created.id,
      groupId,
      recipientId: input.paidToId,
    });
  }

  return created;
}

// ---------- /suggestions ---------------------------------------------------

groupSettlements.get("/suggestions", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  c.header("Cache-Control", "no-store");
  return c.json(await buildSuggestionList(groupId, actor.id));
});

const suggestionRecordSchema = z.object({
  paidById: z.string().uuid(),
  paidToId: z.string().uuid(),
  amount: z.string().optional(),
  date: z.string().optional(),
  notes: z.string().nullable().optional(),
});

groupSettlements.post("/suggestions/record", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  const body = await parseJson(c, suggestionRecordSchema);
  if (body.paidById === body.paidToId) {
    throw unprocessable("Cannot record a settlement to yourself");
  }

  const suggestions = await buildSuggestionList(groupId, actor.id);
  // Match by directional pair: we recommend X→Y for $A; an actual settlement
  // X→Y is valid for any amount up to A.
  const match = suggestions.suggestions.find(
    (s) => s.from.id === body.paidById && s.to.id === body.paidToId,
  );
  if (!match) throw unprocessable("Suggestion not found", "SUGGESTION_NOT_FOUND");

  const amount = body.amount ?? match.amount;
  if (!isMoneyString(amount)) throw validationError({ amount: "Invalid money" });
  if (parseMoneyToCents(amount) > parseMoneyToCents(match.amount)) {
    throw unprocessable("Amount exceeds suggested settlement");
  }
  const date = body.date ?? new Date().toISOString().slice(0, 10);
  if (!isDateOnly(date)) throw validationError({ date: "Must be YYYY-MM-DD" });

  const created = await createSettlementCore(groupId, actor.id, actor.name, {
    paidById: body.paidById,
    paidToId: body.paidToId,
    amount,
    date,
    notes: body.notes ?? "Recorded from settlement suggestion",
  });

  const post = await buildSuggestionList(groupId, actor.id);
  return c.json(
    {
      settlement: await presentSettlement(created),
      previousSuggestion: match,
      settlementSuggestions: post,
    },
    201,
  );
});

// ---------- /settle-with/:userId -------------------------------------------

groupSettlements.post("/settle-with/:userId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const otherId = c.req.param("userId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  if (otherId === actor.id) {
    throw unprocessable("Cannot settle with yourself");
  }
  await requireGroupMember(groupId, otherId);

  const edges = await computePairwiseCents(groupId);
  // Net between actor and other.
  let net = 0;
  for (const e of edges) {
    if (e.fromId === actor.id && e.toId === otherId) net += e.cents; // actor owes other
    else if (e.fromId === otherId && e.toId === actor.id) net -= e.cents;
  }
  if (net === 0) {
    throw unprocessable("Net balance is already zero");
  }
  const paidById = net > 0 ? actor.id : otherId;
  const paidToId = net > 0 ? otherId : actor.id;

  const created = await createSettlementCore(groupId, actor.id, actor.name, {
    paidById,
    paidToId,
    amount: centsToMoney(Math.abs(net)),
    date: new Date().toISOString().slice(0, 10),
    notes: "One-click settle",
  });
  const settlement = await presentSettlement(created);

  const inc = c.req.query("include");
  const wrap =
    c.req.query("includeSuggestions") === "true" || inc === "suggestions";
  if (wrap) {
    return c.json(
      {
        settlement,
        settlementSuggestions: await buildSuggestionList(groupId, actor.id),
      },
      201,
    );
  }
  return c.json(settlement, 201);
});

// ---------- POST / (create) ------------------------------------------------

const createSchema = z.object({
  paidById: z.string().uuid(),
  paidToId: z.string().uuid(),
  amount: z.string(),
  date: z.string(),
  notes: z.string().nullable().optional(),
});

groupSettlements.post("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  const body = await parseJson(c, createSchema);
  if (!isMoneyString(body.amount)) throw validationError({ amount: "Invalid money" });
  if (!isDateOnly(body.date)) throw validationError({ date: "Must be YYYY-MM-DD" });
  if (body.paidById === body.paidToId) {
    throw unprocessable("Cannot settle with yourself");
  }

  const created = await createSettlementCore(groupId, actor.id, actor.name, {
    paidById: body.paidById,
    paidToId: body.paidToId,
    amount: body.amount,
    date: body.date,
    notes: body.notes ?? null,
  });
  const settlement = await presentSettlement(created);

  const inc = c.req.query("include");
  const wrap =
    c.req.query("includeSuggestions") === "true" || inc === "suggestions";
  if (wrap) {
    return c.json(
      {
        settlement,
        settlementSuggestions: await buildSuggestionList(groupId, actor.id),
      },
      201,
    );
  }
  return c.json(settlement, 201);
});

// ---------- CSV export -----------------------------------------------------

groupSettlements.get("/export.csv", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  const { filters, sortCol, orderDir } = buildSettlementFilters(c, groupId);
  const rows = await db
    .select()
    .from(settlements)
    .where(and(...filters))
    .orderBy(orderDir(sortCol))
    .limit(10_000);

  const userById = await loadUserMini(
    Array.from(new Set(rows.flatMap((r) => [r.paidById, r.paidToId]))),
  );
  const header = ["Date", "Paid By", "Paid To", "Amount", "Notes", "Created At"];
  const lines = [header.map(csvField).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        userById.get(r.paidById)?.name ?? "",
        userById.get(r.paidToId)?.name ?? "",
        r.amount,
        r.notes ?? "",
        r.createdAt.toISOString(),
      ]
        .map(csvField)
        .join(","),
    );
  }
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="settlements-${groupId}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv"`,
  );
  return c.body(lines.join("\n"));
});

// ---------- GET / list -----------------------------------------------------

const STATUS_VALUES = ["pending", "confirmed", "disputed"] as const;
const SETT_SORTS = { date: settlements.date, amount: settlements.amount };

function buildSettlementFilters(
  c: import("hono").Context,
  groupId: string,
) {
  const filters = [eq(settlements.groupId, groupId)];

  const userId = c.req.query("userId");
  if (userId) {
    filters.push(
      sql`(${settlements.paidById} = ${userId} OR ${settlements.paidToId} = ${userId})`,
    );
  }

  const status = c.req.query("status");
  if (status && (STATUS_VALUES as readonly string[]).includes(status)) {
    filters.push(eq(settlements.status, status as (typeof STATUS_VALUES)[number]));
  }

  const from = c.req.query("from");
  if (from && isDateOnly(from)) filters.push(gte(settlements.date, from));
  const to = c.req.query("to");
  if (to && isDateOnly(to)) filters.push(lte(settlements.date, to));

  const sort = (c.req.query("sort") ?? "date") as keyof typeof SETT_SORTS;
  const orderDir = c.req.query("order") === "asc" ? asc : desc;
  return { filters, sortCol: SETT_SORTS[sort] ?? SETT_SORTS.date, orderDir };
}

groupSettlements.get("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const { page, limit } = parsePagination(c);
  const { filters, sortCol, orderDir } = buildSettlementFilters(c, groupId);

  const [{ total }] = (await db
    .select({ total: sql<number>`count(*)::int` })
    .from(settlements)
    .where(and(...filters))) as [{ total: number }];

  const rows = await db
    .select()
    .from(settlements)
    .where(and(...filters))
    .orderBy(orderDir(sortCol))
    .offset((page - 1) * limit)
    .limit(limit);

  const userById = await loadUserMini(
    Array.from(new Set(rows.flatMap((r) => [r.paidById, r.paidToId]))),
  );
  return c.json({
    data: rows.map((r) =>
      toSettlementResponse(r, userById.get(r.paidById)!, userById.get(r.paidToId)!),
    ),
    meta: buildPaginationMeta(total, page, limit),
  });
});

// ---------- /confirm /dispute /delete --------------------------------------

groupSettlements.patch("/:settlementId/confirm", async (c) => {
  const groupId = c.req.param("groupId")!;
  const settlementId = c.req.param("settlementId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const [s] = await db
    .select()
    .from(settlements)
    .where(and(eq(settlements.id, settlementId), eq(settlements.groupId, groupId)))
    .limit(1);
  if (!s) throw notFound("Settlement not found");
  if (s.paidToId !== actor.id) {
    throw forbidden("Only the payment receiver can confirm");
  }
  if (s.status !== "pending") {
    throw unprocessable("Settlement already reviewed");
  }

  const [updated] = await db
    .update(settlements)
    .set({ status: "confirmed", reviewedAt: new Date() })
    .where(eq(settlements.id, settlementId))
    .returning();

  await recordAudit({
    groupId,
    actorId: actor.id,
    action: "updated",
    resourceType: "settlement",
    resourceId: settlementId,
    summary: `${actor.name} confirmed a payment of ${s.amount}`,
    before: s as unknown as Record<string, unknown>,
    after: updated as unknown as Record<string, unknown>,
    changedFields: [
      { field: "status", before: s.status, after: "confirmed" },
    ],
  });
  await notify({
    kind: "settlement_confirmed",
    settlementId,
    groupId,
    recipientId: s.paidById,
  });

  return c.json(await presentSettlement(updated!));
});

const disputeSchema = z.object({ notes: z.string().trim().optional() });

groupSettlements.patch("/:settlementId/dispute", async (c) => {
  const groupId = c.req.param("groupId")!;
  const settlementId = c.req.param("settlementId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  const body = await parseJson(c, disputeSchema);

  const [s] = await db
    .select()
    .from(settlements)
    .where(and(eq(settlements.id, settlementId), eq(settlements.groupId, groupId)))
    .limit(1);
  if (!s) throw notFound("Settlement not found");
  if (s.paidToId !== actor.id) {
    throw forbidden("Only the payment receiver can dispute");
  }
  if (s.status !== "pending") {
    throw unprocessable("Settlement already reviewed");
  }

  const reviewNotes = body.notes && body.notes.trim() ? body.notes.trim() : null;
  const [updated] = await db
    .update(settlements)
    .set({ status: "disputed", reviewedAt: new Date(), reviewNotes })
    .where(eq(settlements.id, settlementId))
    .returning();

  await recordAudit({
    groupId,
    actorId: actor.id,
    action: "updated",
    resourceType: "settlement",
    resourceId: settlementId,
    summary: `${actor.name} disputed a payment of ${s.amount}`,
    before: s as unknown as Record<string, unknown>,
    after: updated as unknown as Record<string, unknown>,
    changedFields: [{ field: "status", before: s.status, after: "disputed" }],
  });
  await notify({
    kind: "settlement_disputed",
    settlementId,
    groupId,
    recipientId: s.paidById,
  });

  return c.json(await presentSettlement(updated!));
});

groupSettlements.delete("/:settlementId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const settlementId = c.req.param("settlementId")!;
  const actor = c.get("user");
  const member = await requireGroupMember(groupId, actor.id);

  const [s] = await db
    .select()
    .from(settlements)
    .where(and(eq(settlements.id, settlementId), eq(settlements.groupId, groupId)))
    .limit(1);
  if (!s) throw notFound("Settlement not found");

  const allowed =
    s.paidById === actor.id ||
    (s.status === "disputed" && s.paidToId === actor.id) ||
    member.role === "admin";
  if (!allowed) throw forbidden("Not allowed to delete this settlement");

  await db.delete(settlements).where(eq(settlements.id, settlementId));

  await recordAudit({
    groupId,
    actorId: actor.id,
    action: "deleted",
    resourceType: "settlement",
    resourceId: settlementId,
    summary: `${actor.name} deleted a payment of ${s.amount}`,
    before: s as unknown as Record<string, unknown>,
  });

  return c.body(null, 204);
});

// ---------- csv helper -----------------------------------------------------

function csvField(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

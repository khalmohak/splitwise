import { Hono } from "hono";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { budgets, type Budget } from "../../db/schema/budgets.js";
import { categories, type Category } from "../../db/schema/categories.js";
import { expenses } from "../../db/schema/expenses.js";
import { users, type User } from "../../db/schema/users.js";
import { type AuthVariables } from "../../lib/auth.js";
import { parseJson } from "../../lib/http.js";
import { notFound, validationError } from "../../lib/errors.js";
import { requireGroupAdmin, requireGroupMember } from "../../lib/guards.js";
import { isMonthString, isDateOnly } from "../../lib/date-utils.js";
import { centsToMoney } from "../../lib/balances.js";
import { parseMoneyToCents } from "../../lib/money.js";

export const groupBudgets = new Hono<{ Variables: AuthVariables }>();

type BudgetResponse = {
  id: string;
  groupId: string;
  month: string;
  category: { id: string; name: string; icon: string | null; color: string | null } | null;
  amount: string;
  spent: string;
  remaining: string;
  usedPct: string;
  status: "ok" | "warning" | "over";
  createdBy: { id: string; name?: string };
  createdAt: string;
  updatedAt: string;
};

// Compute spent cents per (categoryId|null, month) for a group.
async function computeBudgetSpend(
  groupId: string,
  month: string,
): Promise<{ overall: number; byCategory: Map<string, number> }> {
  const monthStart = `${month}-01`;
  // Last day of month — naive month-end via Date.
  const [y, m] = month.split("-").map(Number);
  const endDate = new Date(Date.UTC(y!, m!, 0));
  const monthEnd = endDate.toISOString().slice(0, 10);

  if (!isDateOnly(monthStart) || !isDateOnly(monthEnd)) {
    throw validationError({ month: "Bad month" });
  }

  const rows = await db
    .select({
      categoryId: expenses.categoryId,
      total: sql<string>`SUM(${expenses.amount})::text`,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.groupId, groupId),
        gte(expenses.date, monthStart),
        lte(expenses.date, monthEnd),
      ),
    )
    .groupBy(expenses.categoryId);

  let overall = 0;
  const byCategory = new Map<string, number>();
  for (const r of rows) {
    const cents = r.total ? parseMoneyToCents(r.total.includes(".") ? r.total : `${r.total}.00`) : 0;
    overall += cents;
    if (r.categoryId) byCategory.set(r.categoryId, cents);
  }
  return { overall, byCategory };
}

function statusFor(usedPct: number): "ok" | "warning" | "over" {
  if (usedPct > 100) return "over";
  if (usedPct >= 80) return "warning";
  return "ok";
}

function presentBudget(
  b: Budget,
  cat: Category | null,
  creator: User | null,
  spentCents: number,
): BudgetResponse {
  const amountCents = parseMoneyToCents(b.amount);
  const remaining = amountCents - spentCents;
  const usedPct = amountCents > 0 ? (spentCents * 100) / amountCents : 0;
  return {
    id: b.id,
    groupId: b.groupId,
    month: b.month,
    category: cat
      ? { id: cat.id, name: cat.name, icon: cat.icon, color: cat.color }
      : null,
    amount: b.amount,
    spent: centsToMoney(spentCents),
    remaining: centsToMoney(remaining),
    usedPct: usedPct.toFixed(2),
    status: statusFor(usedPct),
    createdBy: { id: b.createdById, name: creator?.name },
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

// GET / — list budgets for a month.
groupBudgets.get("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const month = c.req.query("month");
  if (month !== undefined && !isMonthString(month)) {
    throw validationError({ month: "Must be YYYY-MM" });
  }
  const m = month ?? new Date().toISOString().slice(0, 7);

  const rows = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.groupId, groupId), eq(budgets.month, m)));

  const spend = await computeBudgetSpend(groupId, m);

  const catIds = rows.map((r) => r.categoryId).filter((x): x is string => !!x);
  const cats = catIds.length
    ? await db.select().from(categories).where(inArray(categories.id, catIds))
    : [];
  const catById = new Map(cats.map((c) => [c.id, c]));

  const userIds = Array.from(new Set(rows.map((r) => r.createdById)));
  const userRows = userIds.length
    ? await db.select().from(users).where(inArray(users.id, userIds))
    : [];
  const userById = new Map(userRows.map((u) => [u.id, u]));

  const data = rows.map((b) => {
    const cat = b.categoryId ? catById.get(b.categoryId) ?? null : null;
    const spentCents = b.categoryId
      ? spend.byCategory.get(b.categoryId) ?? 0
      : spend.overall;
    return presentBudget(b, cat, userById.get(b.createdById) ?? null, spentCents);
  });

  return c.json({ data });
});

// PUT / — upsert budget for (groupId, categoryId|null, month).
const upsertSchema = z.object({
  month: z.string(),
  categoryId: z.string().uuid().nullable(),
  amount: z.string(),
});

groupBudgets.put("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupAdmin(groupId, actor.id);
  const body = await parseJson(c, upsertSchema);
  if (!isMonthString(body.month)) throw validationError({ month: "Must be YYYY-MM" });

  // Verify category belongs to group (or is a system category).
  if (body.categoryId) {
    const [cat] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, body.categoryId))
      .limit(1);
    if (!cat) throw notFound("Category not found");
    if (cat.groupId && cat.groupId !== groupId) throw notFound("Category not in this group");
  }

  // Manual upsert — Drizzle's onConflict needs a real unique constraint name.
  const existing = await db
    .select()
    .from(budgets)
    .where(
      and(
        eq(budgets.groupId, groupId),
        eq(budgets.month, body.month),
        body.categoryId == null
          ? isNull(budgets.categoryId)
          : eq(budgets.categoryId, body.categoryId),
      ),
    )
    .limit(1);

  let row: Budget;
  if (existing[0]) {
    const [updated] = await db
      .update(budgets)
      .set({ amount: body.amount, updatedAt: new Date() })
      .where(eq(budgets.id, existing[0].id))
      .returning();
    row = updated!;
  } else {
    const [created] = await db
      .insert(budgets)
      .values({
        groupId,
        categoryId: body.categoryId,
        month: body.month,
        amount: body.amount,
        createdById: actor.id,
      })
      .returning();
    row = created!;
  }

  const spend = await computeBudgetSpend(groupId, body.month);
  const cat = row.categoryId
    ? (
        await db.select().from(categories).where(eq(categories.id, row.categoryId)).limit(1)
      )[0] ?? null
    : null;
  const [creator] = await db
    .select()
    .from(users)
    .where(eq(users.id, row.createdById))
    .limit(1);

  const spentCents = row.categoryId
    ? spend.byCategory.get(row.categoryId) ?? 0
    : spend.overall;

  return c.json(presentBudget(row, cat, creator ?? null, spentCents));
});

groupBudgets.delete("/:budgetId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const budgetId = c.req.param("budgetId")!;
  const actor = c.get("user");
  await requireGroupAdmin(groupId, actor.id);

  const deleted = await db
    .delete(budgets)
    .where(and(eq(budgets.id, budgetId), eq(budgets.groupId, groupId)))
    .returning({ id: budgets.id });
  if (deleted.length === 0) throw notFound("Budget not found");
  return c.body(null, 204);
});

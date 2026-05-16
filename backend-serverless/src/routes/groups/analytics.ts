import { Hono } from "hono";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { expenses } from "../../db/schema/expenses.js";
import { expenseParticipants } from "../../db/schema/expense-participants.js";
import { categories } from "../../db/schema/categories.js";
import { tags as tagsTable, expenseTags } from "../../db/schema/tags.js";
import { groupMembers } from "../../db/schema/groups.js";
import { users } from "../../db/schema/users.js";
import { type AuthVariables } from "../../lib/auth.js";
import { requireGroupMember } from "../../lib/guards.js";
import { centsToMoney } from "../../lib/balances.js";
import { parseMoneyToCents } from "../../lib/money.js";
import { isDateOnly, getCurrentMonthDateRange, dateRangeKey } from "../../lib/date-utils.js";

export const groupAnalytics = new Hono<{ Variables: AuthVariables }>();

// ---------- helpers --------------------------------------------------------

function parsePeriod(c: import("hono").Context): { from: string; to: string } {
  const fromQ = c.req.query("from");
  const toQ = c.req.query("to");
  const def = getCurrentMonthDateRange();
  const from = fromQ && isDateOnly(fromQ) ? fromQ : def.from;
  const to = toQ && isDateOnly(toQ) ? toQ : def.to;
  return { from, to };
}

function parseBy(c: import("hono").Context): "day" | "week" | "month" {
  const b = c.req.query("by");
  return b === "day" || b === "week" || b === "month" ? b : "month";
}

function decimalToCents(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const s = typeof v === "number" ? String(v) : v;
  if (!s.includes(".")) return parseMoneyToCents(`${s}.00`);
  const [w, f = "00"] = s.split(".");
  return parseMoneyToCents(`${w}.${(f + "00").slice(0, 2)}`);
}

async function expensesInPeriod(groupId: string, from: string, to: string) {
  return db
    .select()
    .from(expenses)
    .where(
      and(eq(expenses.groupId, groupId), gte(expenses.date, from), lte(expenses.date, to)),
    );
}

function previousPeriod(from: string, to: string): { from: string; to: string } {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  const lenDays = Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1;
  const prevTo = new Date(f.getTime() - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - (lenDays - 1) * 86_400_000);
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  };
}

function directionOf(changeCents: number): "up" | "down" | "stable" {
  return changeCents > 0 ? "up" : changeCents < 0 ? "down" : "stable";
}

function pct(num: number, denom: number): number {
  return denom > 0 ? (num * 100) / denom : 0;
}

// ---------- /summary -------------------------------------------------------

groupAnalytics.get("/summary", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const { from, to } = parsePeriod(c);
  const rows = await expensesInPeriod(groupId, from, to);

  const totalCents = rows.reduce((a, r) => a + decimalToCents(r.amount), 0);
  const expenseCount = rows.length;
  const avgCents = expenseCount > 0 ? Math.round(totalCents / expenseCount) : 0;

  // vsLastPeriod.
  const prev = previousPeriod(from, to);
  const prevRows = await expensesInPeriod(groupId, prev.from, prev.to);
  const prevCents = prevRows.reduce((a, r) => a + decimalToCents(r.amount), 0);
  const changeCents = totalCents - prevCents;

  // byCategory.
  const byCatMap = new Map<string | null, { total: number; count: number }>();
  for (const r of rows) {
    const k = r.categoryId;
    const cur = byCatMap.get(k) ?? { total: 0, count: 0 };
    cur.total += decimalToCents(r.amount);
    cur.count += 1;
    byCatMap.set(k, cur);
  }
  const catIds = Array.from(byCatMap.keys()).filter((x): x is string => !!x);
  const cats = catIds.length
    ? await db.select().from(categories).where(inArray(categories.id, catIds))
    : [];
  const catById = new Map(cats.map((c) => [c.id, c]));

  const byCategory = Array.from(byCatMap.entries())
    .map(([id, v]) => {
      const cat = id ? catById.get(id) : null;
      return {
        categoryId: id,
        name: cat?.name ?? "Uncategorized",
        icon: cat?.icon ?? null,
        color: cat?.color ?? null,
        total: centsToMoney(v.total),
        count: v.count,
        pct: pct(v.total, totalCents).toFixed(2),
      };
    })
    .sort((a, b) => decimalToCents(b.total) - decimalToCents(a.total));

  // byMember: paid, owes (sum of shares as a participant in this period), net.
  const ids = rows.map((r) => r.id);
  const parts = ids.length
    ? await db
        .select()
        .from(expenseParticipants)
        .where(inArray(expenseParticipants.expenseId, ids))
    : [];

  const memberAgg = new Map<
    string,
    { paid: number; owes: number; expenseCount: number }
  >();
  for (const r of rows) {
    const cur = memberAgg.get(r.paidById) ?? { paid: 0, owes: 0, expenseCount: 0 };
    cur.paid += decimalToCents(r.amount);
    cur.expenseCount += 1;
    memberAgg.set(r.paidById, cur);
  }
  for (const p of parts) {
    const cur = memberAgg.get(p.userId) ?? { paid: 0, owes: 0, expenseCount: 0 };
    cur.owes += decimalToCents(p.shareAmount);
    memberAgg.set(p.userId, cur);
  }

  const memberIds = Array.from(memberAgg.keys());
  const memberUsers = memberIds.length
    ? await db.select().from(users).where(inArray(users.id, memberIds))
    : [];
  const userById = new Map(memberUsers.map((u) => [u.id, u]));

  const byMember = memberIds.map((id) => {
    const v = memberAgg.get(id)!;
    const u = userById.get(id);
    return {
      userId: id,
      name: u?.name ?? "",
      avatarUrl: u?.avatarUrl ?? null,
      paid: centsToMoney(v.paid),
      owes: centsToMoney(v.owes),
      net: centsToMoney(v.paid - v.owes),
      expenseCount: v.expenseCount,
    };
  });

  // topExpenses: top 5 by amount.
  const sorted = [...rows].sort((a, b) => decimalToCents(b.amount) - decimalToCents(a.amount));
  const topExpenses = sorted.slice(0, 5).map((r) => ({
    id: r.id,
    description: r.description,
    amount: r.amount,
    date: r.date,
    category: r.categoryId ? catById.get(r.categoryId) ?? null : null,
  }));

  return c.json({
    period: { from, to },
    totalSpend: centsToMoney(totalCents),
    expenseCount,
    avgExpenseAmount: centsToMoney(avgCents),
    vsLastPeriod: {
      period: prev,
      totalSpend: centsToMoney(prevCents),
      changeAmount: centsToMoney(changeCents),
      changePct: pct(changeCents, prevCents).toFixed(2),
      direction: directionOf(changeCents),
    },
    byCategory,
    byMember,
    topExpenses,
  });
});

// ---------- /comparison ----------------------------------------------------

groupAnalytics.get("/comparison", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const { from, to } = parsePeriod(c);
  const prev = previousPeriod(from, to);

  const [cur, pv] = await Promise.all([
    expensesInPeriod(groupId, from, to),
    expensesInPeriod(groupId, prev.from, prev.to),
  ]);
  const curCents = cur.reduce((a, r) => a + decimalToCents(r.amount), 0);
  const pvCents = pv.reduce((a, r) => a + decimalToCents(r.amount), 0);
  const change = curCents - pvCents;

  return c.json({
    current: {
      period: { from, to },
      totalSpend: centsToMoney(curCents),
      expenseCount: cur.length,
      avgExpenseAmount: centsToMoney(cur.length ? Math.round(curCents / cur.length) : 0),
    },
    previous: {
      period: prev,
      totalSpend: centsToMoney(pvCents),
      expenseCount: pv.length,
      avgExpenseAmount: centsToMoney(pv.length ? Math.round(pvCents / pv.length) : 0),
    },
    changeAmount: centsToMoney(change),
    changePct: pct(change, pvCents).toFixed(2),
    direction: directionOf(change),
  });
});

// ---------- /trends --------------------------------------------------------

groupAnalytics.get("/trends", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const { from, to } = parsePeriod(c);
  const by = parseBy(c);
  const categoryId = c.req.query("categoryId");
  const memberId = c.req.query("memberId");

  const filters = [
    eq(expenses.groupId, groupId),
    gte(expenses.date, from),
    lte(expenses.date, to),
  ];
  if (categoryId) filters.push(eq(expenses.categoryId, categoryId));
  if (memberId) filters.push(eq(expenses.paidById, memberId));

  const rows = await db.select().from(expenses).where(and(...filters));

  const bucketTotals = new Map<string, { total: number; count: number; cats: Map<string | null, { total: number; count: number }> }>();
  for (const r of rows) {
    const key = dateRangeKey(r.date, by);
    const slot = bucketTotals.get(key) ?? {
      total: 0,
      count: 0,
      cats: new Map(),
    };
    const cents = decimalToCents(r.amount);
    slot.total += cents;
    slot.count += 1;
    const k = r.categoryId;
    const cs = slot.cats.get(k) ?? { total: 0, count: 0 };
    cs.total += cents;
    cs.count += 1;
    slot.cats.set(k, cs);
    bucketTotals.set(key, slot);
  }

  const catIds = Array.from(
    new Set(
      rows.map((r) => r.categoryId).filter((x): x is string => !!x),
    ),
  );
  const cats = catIds.length
    ? await db.select().from(categories).where(inArray(categories.id, catIds))
    : [];
  const catById = new Map(cats.map((c) => [c.id, c]));

  const buckets = Array.from(bucketTotals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, slot]) => ({
      key,
      label: key,
      total: centsToMoney(slot.total),
      expenseCount: slot.count,
      byCategory: Array.from(slot.cats.entries()).map(([id, v]) => {
        const cat = id ? catById.get(id) : null;
        return {
          categoryId: id,
          name: cat?.name ?? "Uncategorized",
          icon: cat?.icon ?? null,
          color: cat?.color ?? null,
          total: centsToMoney(v.total),
          expenseCount: v.count,
        };
      }),
    }));

  return c.json({ by, period: { from, to }, buckets });
});

// ---------- /categories ----------------------------------------------------

groupAnalytics.get("/categories", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const { from, to } = parsePeriod(c);
  const rows = await expensesInPeriod(groupId, from, to);
  const totalCents = rows.reduce((a, r) => a + decimalToCents(r.amount), 0);

  const catAgg = new Map<
    string | null,
    { total: number; count: number; payers: Map<string, { paid: number; owes: number }> }
  >();

  const ids = rows.map((r) => r.id);
  const parts = ids.length
    ? await db
        .select()
        .from(expenseParticipants)
        .where(inArray(expenseParticipants.expenseId, ids))
    : [];

  const expenseById = new Map(rows.map((r) => [r.id, r]));
  const partsByExpense = new Map<string, typeof parts>();
  for (const p of parts) {
    const list = partsByExpense.get(p.expenseId) ?? [];
    list.push(p);
    partsByExpense.set(p.expenseId, list);
  }

  for (const r of rows) {
    const slot = catAgg.get(r.categoryId) ?? {
      total: 0,
      count: 0,
      payers: new Map<string, { paid: number; owes: number }>(),
    };
    slot.total += decimalToCents(r.amount);
    slot.count += 1;
    const payerEntry = slot.payers.get(r.paidById) ?? { paid: 0, owes: 0 };
    payerEntry.paid += decimalToCents(r.amount);
    slot.payers.set(r.paidById, payerEntry);
    for (const p of partsByExpense.get(r.id) ?? []) {
      const pe = slot.payers.get(p.userId) ?? { paid: 0, owes: 0 };
      pe.owes += decimalToCents(p.shareAmount);
      slot.payers.set(p.userId, pe);
    }
    catAgg.set(r.categoryId, slot);
  }

  const catIds = Array.from(catAgg.keys()).filter((x): x is string => !!x);
  const cats = catIds.length
    ? await db.select().from(categories).where(inArray(categories.id, catIds))
    : [];
  const catById = new Map(cats.map((c) => [c.id, c]));

  const allUserIds = Array.from(
    new Set(
      Array.from(catAgg.values())
        .flatMap((s) => Array.from(s.payers.keys())),
    ),
  );
  const allUsers = allUserIds.length
    ? await db.select().from(users).where(inArray(users.id, allUserIds))
    : [];
  const userById = new Map(allUsers.map((u) => [u.id, u]));

  const out = Array.from(catAgg.entries()).map(([id, slot]) => {
    const cat = id ? catById.get(id) : null;
    const topSpenders = Array.from(slot.payers.entries())
      .sort((a, b) => b[1].paid - a[1].paid)
      .slice(0, 3)
      .map(([uid, v]) => {
        const u = userById.get(uid);
        return {
          userId: uid,
          name: u?.name ?? "",
          avatarUrl: u?.avatarUrl ?? null,
          paid: centsToMoney(v.paid),
          owes: centsToMoney(v.owes),
        };
      });
    return {
      categoryId: id,
      name: cat?.name ?? "Uncategorized",
      icon: cat?.icon ?? null,
      color: cat?.color ?? null,
      total: centsToMoney(slot.total),
      count: slot.count,
      pct: pct(slot.total, totalCents).toFixed(2),
      expenseCount: slot.count,
      avgPerExpense: centsToMoney(slot.count ? Math.round(slot.total / slot.count) : 0),
      topSpenders,
      monthlyAvg: centsToMoney(slot.total),
      trend: "stable" as const,
      changePct: "0.00",
    };
  });

  out.sort(
    (a, b) => decimalToCents(b.total) - decimalToCents(a.total),
  );

  return c.json({ period: { from, to }, categories: out });
});

// ---------- /categories/trends --------------------------------------------

groupAnalytics.get("/categories/trends", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const { from, to } = parsePeriod(c);
  const by = parseBy(c);
  const rows = await expensesInPeriod(groupId, from, to);

  const byCat = new Map<
    string | null,
    {
      total: number;
      buckets: Map<string, { total: number; count: number }>;
    }
  >();
  for (const r of rows) {
    const slot = byCat.get(r.categoryId) ?? { total: 0, buckets: new Map() };
    const cents = decimalToCents(r.amount);
    slot.total += cents;
    const key = dateRangeKey(r.date, by);
    const b = slot.buckets.get(key) ?? { total: 0, count: 0 };
    b.total += cents;
    b.count += 1;
    slot.buckets.set(key, b);
    byCat.set(r.categoryId, slot);
  }

  const catIds = Array.from(byCat.keys()).filter((x): x is string => !!x);
  const cats = catIds.length
    ? await db.select().from(categories).where(inArray(categories.id, catIds))
    : [];
  const catById = new Map(cats.map((c) => [c.id, c]));

  return c.json({
    by,
    period: { from, to },
    categories: Array.from(byCat.entries()).map(([id, slot]) => {
      const cat = id ? catById.get(id) : null;
      return {
        category: {
          id,
          name: cat?.name ?? "Uncategorized",
          icon: cat?.icon ?? null,
          color: cat?.color ?? null,
        },
        total: centsToMoney(slot.total),
        trend: "stable" as const,
        changePct: "0.00",
        buckets: Array.from(slot.buckets.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, v]) => ({
            key,
            label: key,
            total: centsToMoney(v.total),
            expenseCount: v.count,
          })),
      };
    }),
  });
});

// ---------- /members ------------------------------------------------------

groupAnalytics.get("/members", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const { from, to } = parsePeriod(c);
  const rows = await expensesInPeriod(groupId, from, to);
  const totalCents = rows.reduce((a, r) => a + decimalToCents(r.amount), 0);

  const memberAgg = new Map<
    string,
    { paid: number; owes: number; expenseCount: number; cats: Map<string | null, { total: number; count: number }> }
  >();
  const ids = rows.map((r) => r.id);
  const parts = ids.length
    ? await db
        .select()
        .from(expenseParticipants)
        .where(inArray(expenseParticipants.expenseId, ids))
    : [];
  const expenseById = new Map(rows.map((r) => [r.id, r]));

  for (const r of rows) {
    const slot = memberAgg.get(r.paidById) ?? {
      paid: 0,
      owes: 0,
      expenseCount: 0,
      cats: new Map(),
    };
    slot.paid += decimalToCents(r.amount);
    slot.expenseCount += 1;
    const cs = slot.cats.get(r.categoryId) ?? { total: 0, count: 0 };
    cs.total += decimalToCents(r.amount);
    cs.count += 1;
    slot.cats.set(r.categoryId, cs);
    memberAgg.set(r.paidById, slot);
  }
  for (const p of parts) {
    const slot = memberAgg.get(p.userId) ?? {
      paid: 0,
      owes: 0,
      expenseCount: 0,
      cats: new Map(),
    };
    slot.owes += decimalToCents(p.shareAmount);
    memberAgg.set(p.userId, slot);
  }

  // Include all group members in output, even those with zero spend.
  const mems = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  for (const m of mems) {
    if (!memberAgg.has(m.userId)) {
      memberAgg.set(m.userId, { paid: 0, owes: 0, expenseCount: 0, cats: new Map() });
    }
  }

  const memberIds = Array.from(memberAgg.keys());
  const memberUsers = memberIds.length
    ? await db.select().from(users).where(inArray(users.id, memberIds))
    : [];
  const userById = new Map(memberUsers.map((u) => [u.id, u]));

  const catIds = Array.from(
    new Set(
      Array.from(memberAgg.values()).flatMap((s) =>
        Array.from(s.cats.keys()).filter((x): x is string => !!x),
      ),
    ),
  );
  const cats = catIds.length
    ? await db.select().from(categories).where(inArray(categories.id, catIds))
    : [];
  const catById = new Map(cats.map((c) => [c.id, c]));

  const equalShare = mems.length > 0 ? Math.round(totalCents / mems.length) : 0;

  return c.json({
    period: { from, to },
    groupTotal: centsToMoney(totalCents),
    equalShare: centsToMoney(equalShare),
    members: memberIds.map((id) => {
      const v = memberAgg.get(id)!;
      const u = userById.get(id);
      const topCategories = Array.from(v.cats.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 3)
        .map(([cid, c]) => {
          const cat = cid ? catById.get(cid) : null;
          return {
            categoryId: cid,
            name: cat?.name ?? "Uncategorized",
            icon: cat?.icon ?? null,
            total: centsToMoney(c.total),
            expenseCount: c.count,
          };
        });
      const fairness = equalShare > 0 ? v.owes / equalShare : 0;
      return {
        userId: id,
        name: u?.name ?? "",
        avatarUrl: u?.avatarUrl ?? null,
        paid: centsToMoney(v.paid),
        owes: centsToMoney(v.owes),
        net: centsToMoney(v.paid - v.owes),
        expenseCount: v.expenseCount,
        fairnessScore: fairness.toFixed(2),
        topCategories,
      };
    }),
  });
});

// ---------- /members/trends -----------------------------------------------

groupAnalytics.get("/members/trends", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const { from, to } = parsePeriod(c);
  const by = parseBy(c);
  const rows = await expensesInPeriod(groupId, from, to);
  const ids = rows.map((r) => r.id);
  const parts = ids.length
    ? await db
        .select()
        .from(expenseParticipants)
        .where(inArray(expenseParticipants.expenseId, ids))
    : [];
  const expenseDate = new Map(rows.map((r) => [r.id, r.date]));

  type Bucket = { paid: number; owes: number; expenseCount: number; net: number };
  const perMember = new Map<
    string,
    { paid: number; owes: number; net: number; buckets: Map<string, Bucket> }
  >();
  function add(id: string, key: string, paid: number, owes: number, expenseInc: number) {
    const m = perMember.get(id) ?? { paid: 0, owes: 0, net: 0, buckets: new Map() };
    m.paid += paid;
    m.owes += owes;
    m.net = m.paid - m.owes;
    const b = m.buckets.get(key) ?? { paid: 0, owes: 0, expenseCount: 0, net: 0 };
    b.paid += paid;
    b.owes += owes;
    b.expenseCount += expenseInc;
    b.net = b.paid - b.owes;
    m.buckets.set(key, b);
    perMember.set(id, m);
  }
  for (const r of rows) {
    add(r.paidById, dateRangeKey(r.date, by), decimalToCents(r.amount), 0, 1);
  }
  for (const p of parts) {
    const date = expenseDate.get(p.expenseId)!;
    add(p.userId, dateRangeKey(date, by), 0, decimalToCents(p.shareAmount), 0);
  }

  const memberIds = Array.from(perMember.keys());
  const userRows = memberIds.length
    ? await db.select().from(users).where(inArray(users.id, memberIds))
    : [];
  const userById = new Map(userRows.map((u) => [u.id, u]));

  return c.json({
    by,
    period: { from, to },
    members: memberIds.map((id) => {
      const m = perMember.get(id)!;
      const u = userById.get(id);
      return {
        user: {
          id,
          name: u?.name ?? "",
          avatarUrl: u?.avatarUrl ?? null,
        },
        paid: centsToMoney(m.paid),
        owes: centsToMoney(m.owes),
        net: centsToMoney(m.net),
        buckets: Array.from(m.buckets.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, b]) => ({
            key,
            label: key,
            paid: centsToMoney(b.paid),
            owes: centsToMoney(b.owes),
            net: centsToMoney(b.net),
            expenseCount: b.expenseCount,
          })),
      };
    }),
  });
});

// ---------- /tags ----------------------------------------------------------

groupAnalytics.get("/tags", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const { from, to } = parsePeriod(c);
  const rows = await expensesInPeriod(groupId, from, to);
  const ids = rows.map((r) => r.id);

  const linkRows = ids.length
    ? await db
        .select()
        .from(expenseTags)
        .where(inArray(expenseTags.expenseId, ids))
    : [];

  const expenseAmount = new Map(rows.map((r) => [r.id, decimalToCents(r.amount)]));
  const perTag = new Map<string, { total: number; count: number }>();
  for (const l of linkRows) {
    const slot = perTag.get(l.tagId) ?? { total: 0, count: 0 };
    slot.total += expenseAmount.get(l.expenseId) ?? 0;
    slot.count += 1;
    perTag.set(l.tagId, slot);
  }

  const tagIds = Array.from(perTag.keys());
  const tagRows = tagIds.length
    ? await db.select().from(tagsTable).where(inArray(tagsTable.id, tagIds))
    : [];
  const tagById = new Map(tagRows.map((t) => [t.id, t]));

  return c.json({
    period: { from, to },
    tags: tagIds.map((id) => {
      const t = tagById.get(id);
      const v = perTag.get(id)!;
      return {
        tagId: id,
        name: t?.name ?? "",
        color: t?.color ?? null,
        total: centsToMoney(v.total),
        expenseCount: v.count,
        byMember: [],
        byCategory: [],
      };
    }),
  });
});

// ---------- /patterns ------------------------------------------------------

groupAnalytics.get("/patterns", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const { from, to } = parsePeriod(c);
  const rows = await expensesInPeriod(groupId, from, to);

  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const byWeekday = new Map<number, { total: number; count: number }>();
  const byDayOfMonth = new Map<number, { total: number; count: number }>();
  const byDate = new Map<string, { total: number; count: number }>();
  let recurring = { total: 0, count: 0 };
  let oneOff = { total: 0, count: 0 };

  for (const r of rows) {
    const d = new Date(`${r.date}T00:00:00Z`);
    const cents = decimalToCents(r.amount);
    const wd = d.getUTCDay();
    const wkSlot = byWeekday.get(wd) ?? { total: 0, count: 0 };
    wkSlot.total += cents;
    wkSlot.count += 1;
    byWeekday.set(wd, wkSlot);

    const dom = d.getUTCDate();
    const domSlot = byDayOfMonth.get(dom) ?? { total: 0, count: 0 };
    domSlot.total += cents;
    domSlot.count += 1;
    byDayOfMonth.set(dom, domSlot);

    const dt = byDate.get(r.date) ?? { total: 0, count: 0 };
    dt.total += cents;
    dt.count += 1;
    byDate.set(r.date, dt);

    if (r.isRecurring) {
      recurring.total += cents;
      recurring.count += 1;
    } else {
      oneOff.total += cents;
      oneOff.count += 1;
    }
  }

  const totalCents = rows.reduce((a, r) => a + decimalToCents(r.amount), 0);

  return c.json({
    period: { from, to },
    byWeekday: WEEKDAYS.map((name, i) => {
      const v = byWeekday.get(i) ?? { total: 0, count: 0 };
      return {
        weekday: name,
        weekdayIndex: i,
        total: centsToMoney(v.total),
        expenseCount: v.count,
        avgPerExpense: centsToMoney(v.count ? Math.round(v.total / v.count) : 0),
        pct: pct(v.total, totalCents).toFixed(2),
      };
    }),
    byDayOfMonth: Array.from(byDayOfMonth.entries())
      .sort(([a], [b]) => a - b)
      .map(([day, v]) => ({
        day,
        total: centsToMoney(v.total),
        expenseCount: v.count,
        avgPerExpense: centsToMoney(v.count ? Math.round(v.total / v.count) : 0),
      })),
    highestSpendDays: Array.from(byDate.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([date, v]) => ({
        date,
        total: centsToMoney(v.total),
        expenseCount: v.count,
      })),
    recurringVsOneOff: [
      { type: "recurring" as const, total: centsToMoney(recurring.total), expenseCount: recurring.count },
      { type: "one_off" as const, total: centsToMoney(oneOff.total), expenseCount: oneOff.count },
    ],
  });
});

// ---------- /anomalies -----------------------------------------------------

groupAnalytics.get("/anomalies", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const { from, to } = parsePeriod(c);
  const rows = await expensesInPeriod(groupId, from, to);
  const prev = previousPeriod(from, to);
  const prevRows = await expensesInPeriod(groupId, prev.from, prev.to);

  // unusual expenses: amount > 3x category baseline.
  const baselineByCat = new Map<string | null, { total: number; count: number }>();
  for (const r of [...rows, ...prevRows]) {
    const s = baselineByCat.get(r.categoryId) ?? { total: 0, count: 0 };
    s.total += decimalToCents(r.amount);
    s.count += 1;
    baselineByCat.set(r.categoryId, s);
  }
  const catIds = Array.from(baselineByCat.keys()).filter((x): x is string => !!x);
  const cats = catIds.length
    ? await db.select().from(categories).where(inArray(categories.id, catIds))
    : [];
  const catById = new Map(cats.map((c) => [c.id, c]));

  const unusualExpenses: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const base = baselineByCat.get(r.categoryId);
    if (!base || base.count <= 1) continue;
    const avg = base.total / base.count;
    const cents = decimalToCents(r.amount);
    if (avg > 0 && cents > avg * 3) {
      unusualExpenses.push({
        id: r.id,
        description: r.description,
        amount: r.amount,
        date: r.date,
        category: r.categoryId ? catById.get(r.categoryId) ?? null : null,
        baselineAvg: centsToMoney(Math.round(avg)),
        multiplier: (cents / avg).toFixed(2),
        reason: `${(cents / avg).toFixed(1)}x average for this category`,
      });
    }
  }

  // category spikes.
  const prevByCat = new Map<string | null, number>();
  for (const r of prevRows) {
    prevByCat.set(
      r.categoryId,
      (prevByCat.get(r.categoryId) ?? 0) + decimalToCents(r.amount),
    );
  }
  const curByCat = new Map<string | null, number>();
  for (const r of rows) {
    curByCat.set(
      r.categoryId,
      (curByCat.get(r.categoryId) ?? 0) + decimalToCents(r.amount),
    );
  }
  const spikes: Array<Record<string, unknown>> = [];
  for (const [cid, cur] of curByCat) {
    const prev = prevByCat.get(cid) ?? 0;
    const change = cur - prev;
    if (prev > 0 && change / prev > 0.5) {
      const cat = cid ? catById.get(cid) : null;
      spikes.push({
        category: {
          id: cid,
          name: cat?.name ?? "Uncategorized",
        },
        currentTotal: centsToMoney(cur),
        previousTotal: centsToMoney(prev),
        changeAmount: centsToMoney(change),
        changePct: pct(change, prev).toFixed(2),
        direction: directionOf(change),
      });
    }
  }

  return c.json({ period: { from, to }, unusualExpenses, categorySpikes: spikes });
});

// ---------- /export.csv ----------------------------------------------------

groupAnalytics.get("/export.csv", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const { from, to } = parsePeriod(c);
  const rows = await expensesInPeriod(groupId, from, to);
  const totalCents = rows.reduce((a, r) => a + decimalToCents(r.amount), 0);

  // Recompute pieces inline to avoid re-fetching everything; this is the
  // shorter path versus calling our handler trio.
  const ids = rows.map((r) => r.id);
  const parts = ids.length
    ? await db
        .select()
        .from(expenseParticipants)
        .where(inArray(expenseParticipants.expenseId, ids))
    : [];

  const memberAgg = new Map<string, { paid: number; owes: number; count: number }>();
  const catAgg = new Map<string | null, { total: number; count: number }>();
  for (const r of rows) {
    const m = memberAgg.get(r.paidById) ?? { paid: 0, owes: 0, count: 0 };
    m.paid += decimalToCents(r.amount);
    m.count += 1;
    memberAgg.set(r.paidById, m);
    const cs = catAgg.get(r.categoryId) ?? { total: 0, count: 0 };
    cs.total += decimalToCents(r.amount);
    cs.count += 1;
    catAgg.set(r.categoryId, cs);
  }
  for (const p of parts) {
    const m = memberAgg.get(p.userId) ?? { paid: 0, owes: 0, count: 0 };
    m.owes += decimalToCents(p.shareAmount);
    memberAgg.set(p.userId, m);
  }

  const catIds = Array.from(catAgg.keys()).filter((x): x is string => !!x);
  const cats = catIds.length
    ? await db.select().from(categories).where(inArray(categories.id, catIds))
    : [];
  const catById = new Map(cats.map((c) => [c.id, c]));
  const memberIds = Array.from(memberAgg.keys());
  const userRows = memberIds.length
    ? await db.select().from(users).where(inArray(users.id, memberIds))
    : [];
  const userById = new Map(userRows.map((u) => [u.id, u]));

  const out: string[] = [];
  out.push(`Summary`);
  out.push(`Period,${from} to ${to}`);
  out.push(`Total spend,${centsToMoney(totalCents)}`);
  out.push(`Expense count,${rows.length}`);
  out.push("");
  out.push("By Category");
  out.push(["Category", "Total", "Count"].join(","));
  for (const [id, v] of catAgg) {
    const cat = id ? catById.get(id) : null;
    out.push([csvField(cat?.name ?? "Uncategorized"), centsToMoney(v.total), v.count].join(","));
  }
  out.push("");
  out.push("By Member");
  out.push(["Member", "Paid", "Owes", "Net", "Expense Count"].join(","));
  for (const [id, v] of memberAgg) {
    const u = userById.get(id);
    out.push(
      [
        csvField(u?.name ?? ""),
        centsToMoney(v.paid),
        centsToMoney(v.owes),
        centsToMoney(v.paid - v.owes),
        v.count,
      ].join(","),
    );
  }
  out.push("");
  out.push("Top Expenses");
  out.push(["Date", "Description", "Amount", "Category"].join(","));
  const top = [...rows]
    .sort((a, b) => decimalToCents(b.amount) - decimalToCents(a.amount))
    .slice(0, 20);
  for (const r of top) {
    out.push(
      [
        r.date,
        csvField(r.description),
        r.amount,
        csvField(r.categoryId ? catById.get(r.categoryId)?.name ?? "Uncategorized" : "Uncategorized"),
      ].join(","),
    );
  }

  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="group-analytics-${groupId}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv"`,
  );
  return c.body(out.join("\n"));
});

function csvField(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

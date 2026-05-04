import { GroupType } from "../entity/enums";
import { findRecentExpensesForGroups } from "../repositories/expense.repository";
import { getUserGroupRows } from "../repositories/group.repository";
import { findUserById } from "../repositories/user.repository";
import { queryRows } from "../repositories/analytics.repository";
import { getCurrentMonthDateRange, isDateOnly } from "../utils/date";
import { formatCents, parseMoneyToCents } from "../utils/money";
import { getMyGroupBalances, getSimplifiedGroupBalances } from "./balance.service";
import { requireGroupMember } from "./group-access.service";
import { getUserBalances } from "./user.service";

type Period = { from: string; to: string };
type TrendDirection = "up" | "down" | "stable";
type TimeGrain = "day" | "week" | "month";

const defaultPeriod = (period?: Partial<Period>): Period => {
  const current = getCurrentMonthDateRange();
  return { from: period?.from ?? current.from, to: period?.to ?? current.to };
};

const toUtcDate = (date: string): Date =>
  new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))));

const toDateOnly = (date: Date): string => date.toISOString().slice(0, 10);

const addDays = (date: string, days: number): string => {
  const next = toUtcDate(date);
  next.setUTCDate(next.getUTCDate() + days);
  return toDateOnly(next);
};

const daysInclusive = (period: Period): number =>
  Math.round((toUtcDate(period.to).getTime() - toUtcDate(period.from).getTime()) / 86_400_000) + 1;

const previousEquivalentPeriod = (period: Period): Period => {
  const days = daysInclusive(period);
  return {
    from: addDays(period.from, -days),
    to: addDays(period.from, -1),
  };
};

const pctChange = (currentCents: number, previousCents: number): string => {
  if (previousCents === 0) return currentCents === 0 ? "0.00" : "100.00";
  return (((currentCents - previousCents) / Math.abs(previousCents)) * 100).toFixed(2);
};

const trendDirection = (currentCents: number, previousCents: number): TrendDirection => {
  if (currentCents > previousCents) return "up";
  if (currentCents < previousCents) return "down";
  return "stable";
};

const comparisonPayload = (currentCents: number, previousCents: number) => ({
  totalSpend: formatCents(previousCents),
  changeAmount: formatCents(currentCents - previousCents),
  changePct: pctChange(currentCents, previousCents),
  direction: trendDirection(currentCents, previousCents),
});

const grainDateTrunc = (grain: TimeGrain): string =>
  grain === "day" ? "day" : grain === "week" ? "week" : "month";

const grainLabelExpression = (grain: TimeGrain): string => {
  if (grain === "day") return "to_char(date_trunc('day', e.date::timestamp), 'YYYY-MM-DD')";
  if (grain === "week") return "to_char(date_trunc('week', e.date::timestamp), 'IYYY-IW')";
  return "to_char(date_trunc('month', e.date::timestamp), 'YYYY-MM')";
};

const grainStartExpression = (grain: TimeGrain): string =>
  `date_trunc('${grainDateTrunc(grain)}', e.date::timestamp)::date`;

export const getGroupAnalyticsSummary = async (
  groupId: string,
  userId: string,
  periodInput?: Partial<Period>,
) => {
  await requireGroupMember(groupId, userId);
  const period = defaultPeriod(periodInput);
  const previousPeriod = previousEquivalentPeriod(period);
  const [totalRows, categoryRows, memberRows, topExpenses] = await Promise.all([
    queryRows<{ total: string | null; count: string }>(
      "SELECT SUM(amount)::text AS total, COUNT(*)::text AS count FROM expenses WHERE group_id = $1 AND date >= $2 AND date <= $3",
      [groupId, period.from, period.to],
    ),
    queryRows<{ category_id: string | null; name: string; icon: string | null; color: string | null; total: string; count: string }>(
      `SELECT c.id AS category_id, COALESCE(c.name, 'Uncategorized') AS name, c.icon, c.color,
        SUM(e.amount)::text AS total, COUNT(*)::text AS count
       FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.group_id = $1 AND e.date >= $2 AND e.date <= $3
       GROUP BY c.id, c.name, c.icon, c.color ORDER BY SUM(e.amount) DESC`,
      [groupId, period.from, period.to],
    ),
    queryRows<{ user_id: string; name: string; avatar_url: string | null; paid: string; owes: string; expense_count: string }>(
      `SELECT u.id AS user_id, u.name, u.avatar_url,
        COALESCE(SUM(CASE WHEN e.paid_by = u.id THEN e.amount ELSE 0 END), 0)::text AS paid,
        COALESCE(SUM(ep.share_amount), 0)::text AS owes,
        COUNT(DISTINCT CASE WHEN e.paid_by = u.id THEN e.id END)::text AS expense_count
       FROM group_members gm
       INNER JOIN users u ON u.id = gm.user_id
       LEFT JOIN expense_participants ep ON ep.user_id = u.id
       LEFT JOIN expenses e ON e.id = ep.expense_id AND e.group_id = gm.group_id AND e.date >= $2 AND e.date <= $3
       WHERE gm.group_id = $1
       GROUP BY u.id ORDER BY u.name ASC`,
      [groupId, period.from, period.to],
    ),
    queryRows<{ id: string; description: string; amount: string; date: string; category_name: string | null; category_icon: string | null }>(
      `SELECT e.id, e.description, e.amount::text AS amount, e.date::text AS date,
        c.name AS category_name, c.icon AS category_icon
       FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.group_id = $1 AND e.date >= $2 AND e.date <= $3
       ORDER BY e.amount DESC LIMIT 5`,
      [groupId, period.from, period.to],
    ),
  ]);
  const previousTotalRows = await queryRows<{ total: string | null; count: string }>(
    "SELECT SUM(amount)::text AS total, COUNT(*)::text AS count FROM expenses WHERE group_id = $1 AND date >= $2 AND date <= $3",
    [groupId, previousPeriod.from, previousPeriod.to],
  );
  const totalCents = parseMoneyToCents(totalRows[0]?.total ?? null);
  const previousTotalCents = parseMoneyToCents(previousTotalRows[0]?.total ?? null);
  const expenseCount = Number(totalRows[0]?.count ?? 0);
  return {
    period,
    totalSpend: formatCents(totalCents),
    expenseCount,
    avgExpenseAmount: formatCents(expenseCount ? Math.round(totalCents / expenseCount) : 0),
    vsLastPeriod: {
      period: previousPeriod,
      ...comparisonPayload(totalCents, previousTotalCents),
    },
    byCategory: categoryRows.map((row) => {
      const cents = parseMoneyToCents(row.total);
      return {
        categoryId: row.category_id,
        name: row.name,
        icon: row.icon,
        color: row.color,
        total: formatCents(cents),
        count: Number(row.count),
        pct: totalCents ? ((cents / totalCents) * 100).toFixed(2) : "0.00",
      };
    }),
    byMember: memberRows.map((row) => {
      const paid = parseMoneyToCents(row.paid);
      const owes = parseMoneyToCents(row.owes);
      return {
        userId: row.user_id,
        name: row.name,
        avatarUrl: row.avatar_url,
        paid: formatCents(paid),
        owes: formatCents(owes),
        net: formatCents(paid - owes),
        expenseCount: Number(row.expense_count),
      };
    }),
    topExpenses: topExpenses.map((expense) => ({
      id: expense.id,
      description: expense.description,
      amount: formatCents(parseMoneyToCents(expense.amount)),
      date: expense.date,
      category: { name: expense.category_name, icon: expense.category_icon },
    })),
  };
};

export const getGroupAnalyticsTrends = async (
  groupId: string,
  userId: string,
  input: { from: string; to: string; by: TimeGrain; categoryId?: string; memberId?: string },
) => {
  await requireGroupMember(groupId, userId);
  const labelExpression = grainLabelExpression(input.by);
  const startExpression = grainStartExpression(input.by);
  const rows = await queryRows<{ key: string; total: string; count: string }>(
    `SELECT ${labelExpression} AS key,
      ${startExpression}::text AS start_date,
      SUM(e.amount)::text AS total,
      COUNT(*)::text AS count
     FROM expenses e
     WHERE e.group_id = $1
      AND e.date >= $2
      AND e.date <= $3
      AND ($4::uuid IS NULL OR e.category_id = $4)
      AND (
        $5::uuid IS NULL
        OR e.paid_by = $5
        OR EXISTS (
          SELECT 1 FROM expense_participants ep
          WHERE ep.expense_id = e.id AND ep.user_id = $5
        )
      )
     GROUP BY key, start_date ORDER BY start_date ASC`,
    [groupId, input.from, input.to, input.categoryId ?? null, input.memberId ?? null],
  );
  const categoryRows = await queryRows<{
    key: string;
    category_id: string | null;
    name: string;
    icon: string | null;
    color: string | null;
    total: string;
    count: string;
  }>(
    `SELECT ${labelExpression} AS key,
      c.id AS category_id,
      COALESCE(c.name, 'Uncategorized') AS name,
      c.icon,
      c.color,
      SUM(e.amount)::text AS total,
      COUNT(*)::text AS count
     FROM expenses e
     LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.group_id = $1
      AND e.date >= $2
      AND e.date <= $3
      AND ($4::uuid IS NULL OR e.category_id = $4)
      AND (
        $5::uuid IS NULL
        OR e.paid_by = $5
        OR EXISTS (
          SELECT 1 FROM expense_participants ep
          WHERE ep.expense_id = e.id AND ep.user_id = $5
        )
      )
     GROUP BY key, c.id, c.name, c.icon, c.color
     ORDER BY key ASC, SUM(e.amount) DESC`,
    [groupId, input.from, input.to, input.categoryId ?? null, input.memberId ?? null],
  );
  const categoriesByKey = new Map<string, typeof categoryRows>();
  for (const row of categoryRows) {
    categoriesByKey.set(row.key, [...(categoriesByKey.get(row.key) ?? []), row]);
  }

  return {
    by: input.by,
    period: { from: input.from, to: input.to },
    buckets: rows.map((row) => ({
      label: row.key,
      key: row.key,
      total: formatCents(parseMoneyToCents(row.total)),
      expenseCount: Number(row.count),
      byCategory: (categoriesByKey.get(row.key) ?? []).map((category) => ({
        categoryId: category.category_id,
        name: category.name,
        icon: category.icon,
        color: category.color,
        total: formatCents(parseMoneyToCents(category.total)),
        expenseCount: Number(category.count),
      })),
    })),
  };
};

export const getGroupAnalyticsComparison = async (
  groupId: string,
  userId: string,
  periodInput?: Partial<Period>,
) => {
  await requireGroupMember(groupId, userId);
  const period = defaultPeriod(periodInput);
  const previousPeriod = previousEquivalentPeriod(period);
  const [currentRows, previousRows] = await Promise.all([
    queryRows<{ total: string | null; count: string }>(
      "SELECT SUM(amount)::text AS total, COUNT(*)::text AS count FROM expenses WHERE group_id = $1 AND date >= $2 AND date <= $3",
      [groupId, period.from, period.to],
    ),
    queryRows<{ total: string | null; count: string }>(
      "SELECT SUM(amount)::text AS total, COUNT(*)::text AS count FROM expenses WHERE group_id = $1 AND date >= $2 AND date <= $3",
      [groupId, previousPeriod.from, previousPeriod.to],
    ),
  ]);
  const currentCents = parseMoneyToCents(currentRows[0]?.total ?? null);
  const previousCents = parseMoneyToCents(previousRows[0]?.total ?? null);
  const currentCount = Number(currentRows[0]?.count ?? 0);
  const previousCount = Number(previousRows[0]?.count ?? 0);

  return {
    current: {
      period,
      totalSpend: formatCents(currentCents),
      expenseCount: currentCount,
      avgExpenseAmount: formatCents(currentCount ? Math.round(currentCents / currentCount) : 0),
    },
    previous: {
      period: previousPeriod,
      totalSpend: formatCents(previousCents),
      expenseCount: previousCount,
      avgExpenseAmount: formatCents(previousCount ? Math.round(previousCents / previousCount) : 0),
    },
    changeAmount: formatCents(currentCents - previousCents),
    changePct: pctChange(currentCents, previousCents),
    direction: trendDirection(currentCents, previousCents),
  };
};

export const getGroupAnalyticsCategories = async (groupId: string, userId: string, periodInput?: Partial<Period>) => {
  await requireGroupMember(groupId, userId);
  const summary = await getGroupAnalyticsSummary(groupId, userId, periodInput);
  const previousPeriod = previousEquivalentPeriod(summary.period);
  const [previousRows, topSpenderRows] = await Promise.all([
    queryRows<{ category_id: string | null; total: string }>(
      `SELECT e.category_id, SUM(e.amount)::text AS total
       FROM expenses e
       WHERE e.group_id = $1 AND e.date >= $2 AND e.date <= $3
       GROUP BY e.category_id`,
      [groupId, previousPeriod.from, previousPeriod.to],
    ),
    queryRows<{ category_id: string | null; user_id: string; name: string; avatar_url: string | null; paid: string; owes: string }>(
      `SELECT e.category_id, u.id AS user_id, u.name, u.avatar_url,
        SUM(CASE WHEN e.paid_by = u.id THEN e.amount ELSE 0 END)::text AS paid,
        SUM(COALESCE(ep.share_amount, 0))::text AS owes
       FROM group_members gm
       INNER JOIN users u ON u.id = gm.user_id
       LEFT JOIN expense_participants ep ON ep.user_id = u.id
       LEFT JOIN expenses e ON e.id = ep.expense_id AND e.group_id = gm.group_id AND e.date >= $2 AND e.date <= $3
       WHERE gm.group_id = $1 AND e.id IS NOT NULL
       GROUP BY e.category_id, u.id, u.name, u.avatar_url
       ORDER BY e.category_id, SUM(CASE WHEN e.paid_by = u.id THEN e.amount ELSE 0 END) DESC`,
      [groupId, summary.period.from, summary.period.to],
    ),
  ]);
  const previousByCategory = new Map(previousRows.map((row) => [row.category_id ?? "uncategorized", parseMoneyToCents(row.total)]));
  const topSpendersByCategory = new Map<string, typeof topSpenderRows>();
  for (const row of topSpenderRows) {
    const key = row.category_id ?? "uncategorized";
    topSpendersByCategory.set(key, [...(topSpendersByCategory.get(key) ?? []), row]);
  }
  return {
    period: summary.period,
    categories: summary.byCategory.map((category) => ({
      ...category,
      expenseCount: category.count,
      avgPerExpense: formatCents(category.count ? Math.round(parseMoneyToCents(category.total) / category.count) : 0),
      topSpenders: (topSpendersByCategory.get(category.categoryId ?? "uncategorized") ?? [])
        .slice(0, 3)
        .map((spender) => ({
          userId: spender.user_id,
          name: spender.name,
          avatarUrl: spender.avatar_url,
          paid: formatCents(parseMoneyToCents(spender.paid)),
          owes: formatCents(parseMoneyToCents(spender.owes)),
        })),
      monthlyAvg: formatCents(Math.round(parseMoneyToCents(category.total) / Math.max(1, Math.ceil(daysInclusive(summary.period) / 30)))),
      trend: trendDirection(
        parseMoneyToCents(category.total),
        previousByCategory.get(category.categoryId ?? "uncategorized") ?? 0,
      ),
      changePct: pctChange(
        parseMoneyToCents(category.total),
        previousByCategory.get(category.categoryId ?? "uncategorized") ?? 0,
      ),
    })),
  };
};

export const getGroupAnalyticsMembers = async (groupId: string, userId: string, periodInput?: Partial<Period>) => {
  await requireGroupMember(groupId, userId);
  const summary = await getGroupAnalyticsSummary(groupId, userId, periodInput);
  const groupTotalCents = parseMoneyToCents(summary.totalSpend);
  const equalShareCents = summary.byMember.length ? Math.round(groupTotalCents / summary.byMember.length) : 0;
  const topCategoryRows = await queryRows<{ user_id: string; category_id: string | null; name: string; icon: string | null; total: string; count: string }>(
    `SELECT ep.user_id, c.id AS category_id, COALESCE(c.name, 'Uncategorized') AS name, c.icon,
      SUM(ep.share_amount)::text AS total,
      COUNT(*)::text AS count
     FROM expense_participants ep
     INNER JOIN expenses e ON e.id = ep.expense_id
     LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.group_id = $1 AND e.date >= $2 AND e.date <= $3
     GROUP BY ep.user_id, c.id, c.name, c.icon
     ORDER BY ep.user_id, SUM(ep.share_amount) DESC`,
    [groupId, summary.period.from, summary.period.to],
  );
  const topCategoriesByUser = new Map<string, typeof topCategoryRows>();
  for (const row of topCategoryRows) {
    topCategoriesByUser.set(row.user_id, [...(topCategoriesByUser.get(row.user_id) ?? []), row]);
  }
  return {
    period: summary.period,
    groupTotal: summary.totalSpend,
    equalShare: formatCents(equalShareCents),
    members: summary.byMember.map((member) => ({
      ...member,
      fairnessScore: equalShareCents ? (parseMoneyToCents(member.paid) / equalShareCents).toFixed(2) : "0.00",
      topCategories: (topCategoriesByUser.get(member.userId) ?? []).slice(0, 3).map((category) => ({
        categoryId: category.category_id,
        name: category.name,
        icon: category.icon,
        total: formatCents(parseMoneyToCents(category.total)),
        expenseCount: Number(category.count),
      })),
    })),
  };
};

export const getGroupAnalyticsTags = async (groupId: string, userId: string, periodInput?: Partial<Period>) => {
  await requireGroupMember(groupId, userId);
  const period = defaultPeriod(periodInput);
  const rows = await queryRows<{ tag_id: string; name: string; color: string | null; total: string; count: string }>(
    `SELECT t.id AS tag_id, t.name, t.color, SUM(e.amount)::text AS total, COUNT(DISTINCT e.id)::text AS count
     FROM tags t
     INNER JOIN expense_tags et ON et.tag_id = t.id
     INNER JOIN expenses e ON e.id = et.expense_id
     WHERE t.group_id = $1 AND e.date >= $2 AND e.date <= $3
     GROUP BY t.id ORDER BY SUM(e.amount) DESC`,
    [groupId, period.from, period.to],
  );
  return {
    period,
    tags: rows.map((row) => ({
      tagId: row.tag_id,
      name: row.name,
      color: row.color,
      total: formatCents(parseMoneyToCents(row.total)),
      expenseCount: Number(row.count),
      byMember: [],
      byCategory: [],
    })),
  };
};

export const getGroupAnalyticsCategoryTrends = async (
  groupId: string,
  userId: string,
  input: { from: string; to: string; by: TimeGrain },
) => {
  await requireGroupMember(groupId, userId);
  const labelExpression = grainLabelExpression(input.by);
  const startExpression = grainStartExpression(input.by);
  const rows = await queryRows<{
    category_id: string | null;
    name: string;
    icon: string | null;
    color: string | null;
    key: string;
    start_date: string;
    total: string;
    count: string;
  }>(
    `SELECT c.id AS category_id,
      COALESCE(c.name, 'Uncategorized') AS name,
      c.icon,
      c.color,
      ${labelExpression} AS key,
      ${startExpression}::text AS start_date,
      SUM(e.amount)::text AS total,
      COUNT(*)::text AS count
     FROM expenses e
     LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.group_id = $1 AND e.date >= $2 AND e.date <= $3
     GROUP BY c.id, c.name, c.icon, c.color, key, start_date
     ORDER BY c.name ASC, start_date ASC`,
    [groupId, input.from, input.to],
  );
  const categories = new Map<
    string,
    {
      category: { id: string | null; name: string; icon: string | null; color: string | null };
      totalCents: number;
      buckets: { key: string; label: string; total: string; expenseCount: number }[];
    }
  >();

  for (const row of rows) {
    const key = row.category_id ?? "uncategorized";
    const existing =
      categories.get(key) ??
      {
        category: {
          id: row.category_id,
          name: row.name,
          icon: row.icon,
          color: row.color,
        },
        totalCents: 0,
        buckets: [],
      };
    const totalCents = parseMoneyToCents(row.total);
    existing.totalCents += totalCents;
    existing.buckets.push({
      key: row.key,
      label: row.key,
      total: formatCents(totalCents),
      expenseCount: Number(row.count),
    });
    categories.set(key, existing);
  }

  return {
    by: input.by,
    period: { from: input.from, to: input.to },
    categories: Array.from(categories.values())
      .map((category) => {
        const first = parseMoneyToCents(category.buckets[0]?.total ?? "0.00");
        const last = parseMoneyToCents(category.buckets[category.buckets.length - 1]?.total ?? "0.00");

        return {
          category: category.category,
          total: formatCents(category.totalCents),
          trend: trendDirection(last, first),
          changePct: pctChange(last, first),
          buckets: category.buckets,
        };
      })
      .sort((left, right) => parseMoneyToCents(right.total) - parseMoneyToCents(left.total)),
  };
};

export const getGroupAnalyticsMemberTrends = async (
  groupId: string,
  userId: string,
  input: { from: string; to: string; by: TimeGrain },
) => {
  await requireGroupMember(groupId, userId);
  const labelExpression = grainLabelExpression(input.by);
  const startExpression = grainStartExpression(input.by);
  const rows = await queryRows<{
    user_id: string;
    name: string;
    avatar_url: string | null;
    key: string;
    start_date: string;
    paid: string;
    owes: string;
    count: string;
  }>(
    `SELECT u.id AS user_id,
      u.name,
      u.avatar_url,
      ${labelExpression} AS key,
      ${startExpression}::text AS start_date,
      COALESCE(SUM(CASE WHEN e.paid_by = u.id THEN e.amount ELSE 0 END), 0)::text AS paid,
      COALESCE(SUM(ep.share_amount), 0)::text AS owes,
      COUNT(DISTINCT e.id)::text AS count
     FROM group_members gm
     INNER JOIN users u ON u.id = gm.user_id
     LEFT JOIN expense_participants ep ON ep.user_id = u.id
     LEFT JOIN expenses e ON e.id = ep.expense_id AND e.group_id = gm.group_id AND e.date >= $2 AND e.date <= $3
     WHERE gm.group_id = $1 AND e.id IS NOT NULL
     GROUP BY u.id, u.name, u.avatar_url, key, start_date
     ORDER BY u.name ASC, start_date ASC`,
    [groupId, input.from, input.to],
  );
  const members = new Map<
    string,
    {
      user: { id: string; name: string; avatarUrl: string | null };
      buckets: { key: string; label: string; paid: string; owes: string; net: string; expenseCount: number }[];
      paidCents: number;
      owesCents: number;
    }
  >();

  for (const row of rows) {
    const existing =
      members.get(row.user_id) ??
      {
        user: { id: row.user_id, name: row.name, avatarUrl: row.avatar_url },
        buckets: [],
        paidCents: 0,
        owesCents: 0,
      };
    const paidCents = parseMoneyToCents(row.paid);
    const owesCents = parseMoneyToCents(row.owes);
    existing.paidCents += paidCents;
    existing.owesCents += owesCents;
    existing.buckets.push({
      key: row.key,
      label: row.key,
      paid: formatCents(paidCents),
      owes: formatCents(owesCents),
      net: formatCents(paidCents - owesCents),
      expenseCount: Number(row.count),
    });
    members.set(row.user_id, existing);
  }

  return {
    by: input.by,
    period: { from: input.from, to: input.to },
    members: Array.from(members.values()).map((member) => ({
      user: member.user,
      paid: formatCents(member.paidCents),
      owes: formatCents(member.owesCents),
      net: formatCents(member.paidCents - member.owesCents),
      buckets: member.buckets,
    })),
  };
};

export const getGroupAnalyticsPatterns = async (
  groupId: string,
  userId: string,
  periodInput?: Partial<Period>,
) => {
  await requireGroupMember(groupId, userId);
  const period = defaultPeriod(periodInput);
  const [weekdayRows, dayRows, highestDays, recurringRows] = await Promise.all([
    queryRows<{ weekday: string; weekday_index: string; total: string; count: string }>(
      `SELECT TRIM(to_char(e.date::date, 'Day')) AS weekday,
        EXTRACT(ISODOW FROM e.date::date)::text AS weekday_index,
        SUM(e.amount)::text AS total,
        COUNT(*)::text AS count
       FROM expenses e
       WHERE e.group_id = $1 AND e.date >= $2 AND e.date <= $3
       GROUP BY weekday, weekday_index
       ORDER BY EXTRACT(ISODOW FROM e.date::date)::int ASC`,
      [groupId, period.from, period.to],
    ),
    queryRows<{ day_of_month: string; total: string; count: string }>(
      `SELECT EXTRACT(DAY FROM e.date::date)::text AS day_of_month,
        SUM(e.amount)::text AS total,
        COUNT(*)::text AS count
       FROM expenses e
       WHERE e.group_id = $1 AND e.date >= $2 AND e.date <= $3
       GROUP BY day_of_month
       ORDER BY EXTRACT(DAY FROM e.date::date)::int ASC`,
      [groupId, period.from, period.to],
    ),
    queryRows<{ date: string; total: string; count: string }>(
      `SELECT e.date::text AS date,
        SUM(e.amount)::text AS total,
        COUNT(*)::text AS count
       FROM expenses e
       WHERE e.group_id = $1 AND e.date >= $2 AND e.date <= $3
       GROUP BY e.date
       ORDER BY SUM(e.amount) DESC
       LIMIT 10`,
      [groupId, period.from, period.to],
    ),
    queryRows<{ kind: string; total: string; count: string }>(
      `SELECT CASE WHEN e.is_recurring THEN 'recurring' ELSE 'one_off' END AS kind,
        SUM(e.amount)::text AS total,
        COUNT(*)::text AS count
       FROM expenses e
       WHERE e.group_id = $1 AND e.date >= $2 AND e.date <= $3
       GROUP BY kind`,
      [groupId, period.from, period.to],
    ),
  ]);

  const weekdayTotalCents = weekdayRows.reduce((total, row) => total + parseMoneyToCents(row.total), 0);
  return {
    period,
    byWeekday: weekdayRows.map((row) => {
      const totalCents = parseMoneyToCents(row.total);
      const count = Number(row.count);

      return {
        weekday: row.weekday,
        weekdayIndex: Number(row.weekday_index),
        total: formatCents(totalCents),
        expenseCount: count,
        avgPerExpense: formatCents(count ? Math.round(totalCents / count) : 0),
        pct: weekdayTotalCents ? ((totalCents / weekdayTotalCents) * 100).toFixed(2) : "0.00",
      };
    }),
    byDayOfMonth: dayRows.map((row) => {
      const totalCents = parseMoneyToCents(row.total);
      const count = Number(row.count);

      return {
        day: Number(row.day_of_month),
        total: formatCents(totalCents),
        expenseCount: count,
        avgPerExpense: formatCents(count ? Math.round(totalCents / count) : 0),
      };
    }),
    highestSpendDays: highestDays.map((row) => ({
      date: row.date,
      total: formatCents(parseMoneyToCents(row.total)),
      expenseCount: Number(row.count),
    })),
    recurringVsOneOff: recurringRows.map((row) => ({
      type: row.kind,
      total: formatCents(parseMoneyToCents(row.total)),
      expenseCount: Number(row.count),
    })),
  };
};

export const getGroupAnalyticsAnomalies = async (
  groupId: string,
  userId: string,
  periodInput?: Partial<Period>,
) => {
  await requireGroupMember(groupId, userId);
  const period = defaultPeriod(periodInput);
  const previousPeriod = previousEquivalentPeriod(period);
  const [expenseRows, categoryCurrentRows, categoryPreviousRows] = await Promise.all([
    queryRows<{
      id: string;
      description: string;
      amount: string;
      date: string;
      category_id: string | null;
      category_name: string;
      avg_amount: string;
      expense_count: string;
    }>(
      `WITH category_stats AS (
        SELECT category_id, AVG(amount) AS avg_amount, COUNT(*) AS expense_count
        FROM expenses
        WHERE group_id = $1 AND date >= $2 AND date <= $3
        GROUP BY category_id
      )
      SELECT e.id,
        e.description,
        e.amount::text AS amount,
        e.date::text AS date,
        c.id AS category_id,
        COALESCE(c.name, 'Uncategorized') AS category_name,
        stats.avg_amount::text AS avg_amount,
        stats.expense_count::text AS expense_count
      FROM expenses e
      INNER JOIN category_stats stats
        ON COALESCE(stats.category_id::text, 'uncategorized') = COALESCE(e.category_id::text, 'uncategorized')
      LEFT JOIN categories c ON c.id = e.category_id
      WHERE e.group_id = $1
        AND e.date >= $2
        AND e.date <= $3
        AND stats.expense_count >= 3
        AND e.amount >= stats.avg_amount * 2
      ORDER BY e.amount DESC
      LIMIT 20`,
      [groupId, period.from, period.to],
    ),
    queryRows<{ category_id: string | null; name: string; total: string }>(
      `SELECT e.category_id, COALESCE(c.name, 'Uncategorized') AS name, SUM(e.amount)::text AS total
       FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.group_id = $1 AND e.date >= $2 AND e.date <= $3
       GROUP BY e.category_id, c.name`,
      [groupId, period.from, period.to],
    ),
    queryRows<{ category_id: string | null; total: string }>(
      `SELECT e.category_id, SUM(e.amount)::text AS total
       FROM expenses e
       WHERE e.group_id = $1 AND e.date >= $2 AND e.date <= $3
       GROUP BY e.category_id`,
      [groupId, previousPeriod.from, previousPeriod.to],
    ),
  ]);
  const previousByCategory = new Map(categoryPreviousRows.map((row) => [row.category_id ?? "uncategorized", parseMoneyToCents(row.total)]));

  return {
    period,
    unusualExpenses: expenseRows.map((expense) => {
      const amountCents = parseMoneyToCents(expense.amount);
      const avgCents = parseMoneyToCents(expense.avg_amount);

      return {
        id: expense.id,
        description: expense.description,
        amount: formatCents(amountCents),
        date: expense.date,
        category: {
          id: expense.category_id,
          name: expense.category_name,
        },
        baselineAvg: formatCents(avgCents),
        multiplier: avgCents ? (amountCents / avgCents).toFixed(2) : "0.00",
        reason: `Expense is at least 2x the category average for this period`,
      };
    }),
    categorySpikes: categoryCurrentRows
      .map((row) => {
        const currentCents = parseMoneyToCents(row.total);
        const previousCents = previousByCategory.get(row.category_id ?? "uncategorized") ?? 0;

        return {
          category: { id: row.category_id, name: row.name },
          currentTotal: formatCents(currentCents),
          previousTotal: formatCents(previousCents),
          changeAmount: formatCents(currentCents - previousCents),
          changePct: pctChange(currentCents, previousCents),
          direction: trendDirection(currentCents, previousCents),
        };
      })
      .filter((row) => row.direction === "up" && Number(row.changePct) >= 50)
      .sort((left, right) => Number(right.changePct) - Number(left.changePct)),
  };
};

export const getUserDashboard = async (userId: string) => {
  const [user, groups, balanceSummary] = await Promise.all([
    findUserById(userId),
    getUserGroupRows(userId),
    getUserBalances(userId),
  ]);
  const recentExpenses = await findRecentExpensesForGroups(groups.map((group) => group.id), 10);
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const balanceByGroup = new Map<string, number>();

  for (const person of balanceSummary.byPerson) {
    for (const breakdown of person.breakdown) {
      balanceByGroup.set(
        breakdown.groupId,
        (balanceByGroup.get(breakdown.groupId) ?? 0) + parseMoneyToCents(breakdown.amount),
      );
    }
  }

  return {
    user: { id: userId, name: user?.name ?? "", avatarUrl: user?.avatarUrl ?? null },
    balanceSummary: {
      totalOwed: balanceSummary.totalOwed,
      totalYouOwe: balanceSummary.totalYouOwe,
      net: balanceSummary.net,
    },
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      type: group.type as GroupType,
      yourBalance: formatCents(balanceByGroup.get(group.id) ?? 0),
      memberCount: Number(group.member_count),
    })),
    recentActivity: recentExpenses.map((expense) => ({
      type: "expense_created",
      actor: { name: expense.paidByUser.name },
      summary: `${expense.paidByUser.name} added ${expense.description}`,
      group: { name: groupById.get(expense.groupId)?.name ?? "" },
      createdAt: expense.createdAt.toISOString(),
    })),
    upcomingRecurring: recentExpenses
      .filter((expense) => expense.isRecurring)
      .slice(0, 3)
      .map((expense) => ({
        expenseId: expense.id,
        description: expense.description,
        amount: expense.amount,
        recurAnchor: expense.recurAnchor,
        groupName: groupById.get(expense.groupId)?.name ?? "",
      })),
  };
};

export const getGroupDashboard = async (groupId: string, userId: string) => {
  const [summary, groupRows] = await Promise.all([
    getGroupAnalyticsSummary(groupId, userId),
    getUserGroupRows(userId),
  ]);
  const group = groupRows.find((row) => row.id === groupId);
  const [simplified, myBalance] = await Promise.all([
    getSimplifiedGroupBalances(groupId, userId),
    getMyGroupBalances(groupId, userId),
  ]);
  return {
    group: {
      id: groupId,
      name: group?.name ?? "",
      type: group?.type ?? GroupType.HOUSEHOLD,
      memberCount: summary.byMember.length,
    },
    balances: { simplified: simplified.balances, myBalance },
    thisMonth: {
      total: summary.totalSpend,
      expenseCount: summary.expenseCount,
      vsLastMonth: { changeAmount: summary.totalSpend, changePct: "0.00", direction: "up" },
    },
    recentExpenses: summary.topExpenses,
    recentActivity: [],
  };
};

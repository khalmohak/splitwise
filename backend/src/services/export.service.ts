import type { Expense } from "../entity/Expense";
import type { Settlement } from "../entity/Settlement";
import { listExpenses, type ExpenseListFilters } from "../repositories/expense.repository";
import { listSettlements, type SettlementFilters } from "../repositories/settlement.repository";
import { buildCsv } from "../utils/csv";
import {
  getGroupAnalyticsSummary,
  getGroupAnalyticsTags,
} from "./analytics.service";
import { requireGroupMember } from "./group-access.service";
import { getUserAnalytics, getUserBalances } from "./user.service";

export const EXPORT_MAX_ROWS = 10_000;

type Period = { from: string; to: string };

const todayFilenameSuffix = (): string => new Date().toISOString().slice(0, 10);

const participantsCsv = (expense: Expense): string =>
  (expense.participants ?? [])
    .map((p) => `${p.user.name}:${p.shareAmount}`)
    .join("; ");

const tagsCsv = (expense: Expense): string =>
  (expense.tags ?? [])
    .map((t) => t.name)
    .join("; ");

const recurringCsv = (expense: Expense): string => {
  if (!expense.isRecurring) return "no";
  const parts = [expense.recurInterval ?? "", expense.recurAnchor ?? ""].filter(Boolean);
  return parts.length ? `yes (${parts.join(", ")})` : "yes";
};

export const exportGroupExpensesCsv = async (
  groupId: string,
  userId: string,
  filters: ExpenseListFilters,
  sort: "date" | "amount" | "createdAt",
  order: "ASC" | "DESC",
): Promise<{ filename: string; csv: string }> => {
  await requireGroupMember(groupId, userId);
  const [expenses] = await listExpenses(
    groupId,
    filters,
    { skip: 0, limit: EXPORT_MAX_ROWS },
    sort,
    order,
  );

  const rows: (string | number | null | undefined)[][] = [
    [
      "Date",
      "Description",
      "Category",
      "Tags",
      "Amount",
      "Paid By",
      "Split Type",
      "Participants",
      "Notes",
      "Recurring",
      "Created At",
    ],
    ...expenses.map((e) => [
      e.date,
      e.description,
      e.category?.name ?? "",
      tagsCsv(e),
      e.amount,
      e.paidByUser.name,
      e.splitType,
      participantsCsv(e),
      e.notes ?? "",
      recurringCsv(e),
      e.createdAt.toISOString(),
    ]),
  ];

  return {
    filename: `expenses-${groupId}-${todayFilenameSuffix()}.csv`,
    csv: buildCsv(rows),
  };
};

export const exportGroupSettlementsCsv = async (
  groupId: string,
  userId: string,
  filters: SettlementFilters,
  sort: "date" | "amount",
  order: "ASC" | "DESC",
): Promise<{ filename: string; csv: string }> => {
  await requireGroupMember(groupId, userId);
  const [settlements] = await listSettlements(
    groupId,
    filters,
    { skip: 0, limit: EXPORT_MAX_ROWS },
    sort,
    order,
  );

  const rows: (string | number | null | undefined)[][] = [
    ["Date", "Paid By", "Paid To", "Amount", "Notes", "Created At"],
    ...settlements.map((s: Settlement) => [
      s.date,
      s.paidByUser.name,
      s.paidToUser.name,
      s.amount,
      s.notes ?? "",
      s.createdAt.toISOString(),
    ]),
  ];

  return {
    filename: `settlements-${groupId}-${todayFilenameSuffix()}.csv`,
    csv: buildCsv(rows),
  };
};

export const exportGroupAnalyticsCsv = async (
  groupId: string,
  userId: string,
  period: Period,
): Promise<{ filename: string; csv: string }> => {
  const [summary, tagsData] = await Promise.all([
    getGroupAnalyticsSummary(groupId, userId, period),
    getGroupAnalyticsTags(groupId, userId, period),
  ]);

  const rows: (string | number | null | undefined)[][] = [
    ["Section", "Period From", "Period To", "Total Spend", "Expense Count", "Avg Expense"],
    [
      "Summary",
      summary.period.from,
      summary.period.to,
      summary.totalSpend,
      summary.expenseCount,
      summary.avgExpenseAmount,
    ],
    [],
    ["Section", "Category", "Total", "Count", "% of Total"],
    ...summary.byCategory.map((c) => [
      "By Category",
      c.name,
      c.total,
      c.count,
      c.pct,
    ]),
    [],
    ["Section", "Name", "Paid", "Owes", "Net", "Expense Count"],
    ...summary.byMember.map((m) => [
      "By Member",
      m.name,
      m.paid,
      m.owes,
      m.net,
      m.expenseCount,
    ]),
    [],
    ["Section", "Tag", "Total", "Expense Count"],
    ...tagsData.tags.map((t) => ["By Tag", t.name, t.total, t.expenseCount]),
    [],
    ["Section", "Description", "Amount", "Date", "Category"],
    ...summary.topExpenses.map((e) => [
      "Top Expenses",
      e.description,
      e.amount,
      e.date,
      e.category?.name ?? "",
    ]),
  ];

  return {
    filename: `group-analytics-${groupId}-${todayFilenameSuffix()}.csv`,
    csv: buildCsv(rows),
  };
};

export const exportUserAnalyticsCsv = async (
  userId: string,
  period: Period,
): Promise<{ filename: string; csv: string }> => {
  const data = await getUserAnalytics(userId, period);

  const rows: (string | number | null | undefined)[][] = [
    ["Section", "Period From", "Period To", "Total Paid", "Total Owed", "Net"],
    [
      "Summary",
      data.period.from,
      data.period.to,
      data.totalPaid,
      data.totalOwed,
      data.net,
    ],
    [],
    ["Section", "Group", "Type", "Paid", "Owed"],
    ...data.byGroup.map((g) => [
      "By Group",
      g.groupName,
      g.type,
      g.paid,
      g.owed,
    ]),
    [],
    ["Section", "Category", "Paid", "Owed"],
    ...data.byCategory.map((c) => [
      "By Category",
      c.name,
      c.paid,
      c.owed,
    ]),
  ];

  return {
    filename: `user-analytics-me-${todayFilenameSuffix()}.csv`,
    csv: buildCsv(rows),
  };
};

export const exportUserBalancesCsv = async (userId: string): Promise<{ filename: string; csv: string }> => {
  const data = await getUserBalances(userId);

  const rows: (string | number | null | undefined)[][] = [
    ["Person", "Net (Person Total)", "Group", "Amount In Group"],
  ];

  for (const person of data.byPerson) {
    if (person.breakdown.length === 0) {
      rows.push([person.user.name, person.netAmount, "", ""]);
    } else {
      for (const b of person.breakdown) {
        rows.push([person.user.name, person.netAmount, b.groupName, b.amount]);
      }
    }
  }

  return {
    filename: `my-balances-me-${todayFilenameSuffix()}.csv`,
    csv: buildCsv(rows),
  };
};

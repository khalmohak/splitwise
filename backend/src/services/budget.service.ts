import type { Budget } from "../entity/Budget";
import {
  createBudget,
  deleteBudgetRecord,
  findBudgetById,
  findBudgetByScope,
  listBudgetsForGroup,
  saveBudget,
} from "../repositories/budget.repository";
import { findCategoryById } from "../repositories/category.repository";
import { queryRows } from "../repositories/analytics.repository";
import { HttpError } from "../utils/http-error";
import { formatCents, isMoneyString, parseMoneyToCents } from "../utils/money";
import { requireGroupAdmin, requireGroupMember } from "./group-access.service";

export type BudgetInput = {
  month: string;
  categoryId: string | null;
  amount: string;
};

const isMonth = (value: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

const validateBudgetInput = async (groupId: string, input: BudgetInput): Promise<void> => {
  if (!isMonth(input.month)) {
    throw new HttpError(400, "Validation failed", "VALIDATION_ERROR", {
      month: "Month must be YYYY-MM",
    });
  }

  if (!isMoneyString(input.amount) || parseMoneyToCents(input.amount) <= 0) {
    throw new HttpError(400, "Validation failed", "VALIDATION_ERROR", {
      amount: "Amount must be a positive string with 2 decimals",
    });
  }

  if (input.categoryId) {
    const category = await findCategoryById(input.categoryId);
    if (!category || (category.groupId !== null && category.groupId !== groupId)) {
      throw new HttpError(404, "Resource not found", "NOT_FOUND");
    }
  }
};

const spentRowsForBudgets = async (groupId: string, budgets: Budget[]) => {
  if (budgets.length === 0) return new Map<string, number>();
  const months = Array.from(new Set(budgets.map((budget) => budget.month)));
  const rows = await queryRows<{
    month: string;
    category_id: string | null;
    total: string;
  }>(
    `SELECT to_char(date_trunc('month', e.date::timestamp), 'YYYY-MM') AS month,
      e.category_id,
      SUM(e.amount)::text AS total
     FROM expenses e
     WHERE e.group_id = $1
      AND to_char(date_trunc('month', e.date::timestamp), 'YYYY-MM') = ANY($2::text[])
     GROUP BY month, e.category_id`,
    [groupId, months],
  );
  const byScope = new Map<string, number>();
  const monthTotals = new Map<string, number>();

  for (const row of rows) {
    const totalCents = parseMoneyToCents(row.total);
    byScope.set(`${row.month}:${row.category_id ?? "all"}`, totalCents);
    monthTotals.set(row.month, (monthTotals.get(row.month) ?? 0) + totalCents);
  }

  for (const [month, totalCents] of monthTotals) {
    byScope.set(`${month}:all`, totalCents);
  }

  return byScope;
};

const toBudgetResponse = (budget: Budget, spentCents: number) => {
  const budgetCents = parseMoneyToCents(budget.amount);
  const remainingCents = budgetCents - spentCents;

  return {
    id: budget.id,
    groupId: budget.groupId,
    month: budget.month,
    category: budget.category
      ? {
          id: budget.category.id,
          name: budget.category.name,
          icon: budget.category.icon,
          color: budget.category.color,
        }
      : null,
    amount: budget.amount,
    spent: formatCents(spentCents),
    remaining: formatCents(remainingCents),
    usedPct: budgetCents ? ((spentCents / budgetCents) * 100).toFixed(2) : "0.00",
    status: spentCents > budgetCents ? "over" : spentCents >= budgetCents * 0.8 ? "warning" : "ok",
    createdBy: budget.createdByUser
      ? {
          id: budget.createdById,
          name: budget.createdByUser.name,
        }
      : { id: budget.createdById },
    createdAt: budget.createdAt.toISOString(),
    updatedAt: budget.updatedAt.toISOString(),
  };
};

export const getGroupBudgets = async (
  groupId: string,
  userId: string,
  month?: string,
) => {
  await requireGroupMember(groupId, userId);
  if (month && !isMonth(month)) {
    throw new HttpError(400, "Validation failed", "VALIDATION_ERROR", {
      month: "Month must be YYYY-MM",
    });
  }

  const budgets = await listBudgetsForGroup(groupId, month);
  const spentByScope = await spentRowsForBudgets(groupId, budgets);

  return {
    data: budgets.map((budget) =>
      toBudgetResponse(
        budget,
        spentByScope.get(`${budget.month}:${budget.categoryId ?? "all"}`) ?? 0,
      ),
    ),
  };
};

export const upsertGroupBudget = async (
  groupId: string,
  userId: string,
  input: BudgetInput,
) => {
  await requireGroupAdmin(groupId, userId);
  await validateBudgetInput(groupId, input);

  const existing = await findBudgetByScope(groupId, input.month, input.categoryId);
  const budget = existing ?? await createBudget({
    groupId,
    categoryId: input.categoryId,
    month: input.month,
    amount: input.amount,
    createdById: userId,
  });

  if (existing) {
    budget.amount = input.amount;
    await saveBudget(budget);
  }

  const saved = await findBudgetById(groupId, budget.id);
  const spent = await spentRowsForBudgets(groupId, saved ? [saved] : []);

  return toBudgetResponse(
    saved ?? budget,
    spent.get(`${input.month}:${input.categoryId ?? "all"}`) ?? 0,
  );
};

export const deleteGroupBudget = async (
  groupId: string,
  userId: string,
  budgetId: string,
): Promise<void> => {
  await requireGroupAdmin(groupId, userId);
  const budget = await findBudgetById(groupId, budgetId);
  if (!budget) throw new HttpError(404, "Resource not found", "NOT_FOUND");
  await deleteBudgetRecord(budget.id);
};

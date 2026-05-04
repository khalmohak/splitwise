import { FindOptionsWhere, In } from "typeorm";

import { AppDataSource } from "../data-source";
import { Expense } from "../entity/Expense";
import { ExpenseParticipant } from "../entity/ExpenseParticipant";
import { SplitType } from "../entity/enums";

export type ExpenseListFilters = {
  categoryId?: string;
  tagId?: string;
  paidById?: string;
  involvesId?: string;
  splitType?: SplitType;
  from?: string;
  to?: string;
  q?: string;
  isRecurring?: boolean;
};

export const createExpenseRecord = async (expense: Partial<Expense>): Promise<Expense> =>
  AppDataSource.getRepository(Expense).save(AppDataSource.getRepository(Expense).create(expense));

export const saveExpense = async (expense: Expense): Promise<Expense> =>
  AppDataSource.getRepository(Expense).save(expense);

export const replaceExpenseParticipants = async (
  expenseId: string,
  participants: { userId: string; shareAmount: string; splitInput: string | null }[],
): Promise<void> => {
  await AppDataSource.getRepository(ExpenseParticipant).delete({ expenseId });
  await AppDataSource.getRepository(ExpenseParticipant).save(
    participants.map((participant) =>
      AppDataSource.getRepository(ExpenseParticipant).create({
        expenseId,
        ...participant,
      }),
    ),
  );
};

export const findExpenseDetail = async (
  groupId: string,
  expenseId: string,
): Promise<Expense | null> =>
  AppDataSource.getRepository(Expense).findOne({
    where: { id: expenseId, groupId },
    relations: [
      "paidByUser",
      "category",
      "tags",
      "participants",
      "participants.user",
      "createdByUser",
    ],
  });

export const listExpenses = async (
  groupId: string,
  filters: ExpenseListFilters,
  pagination: { skip: number; limit: number },
  sort: "date" | "amount" | "createdAt",
  order: "ASC" | "DESC",
): Promise<[Expense[], number]> => {
  const qb = AppDataSource.getRepository(Expense)
    .createQueryBuilder("expense")
    .leftJoinAndSelect("expense.paidByUser", "paidByUser")
    .leftJoinAndSelect("expense.category", "category")
    .leftJoinAndSelect("expense.tags", "tag")
    .leftJoinAndSelect("expense.participants", "participant")
    .leftJoinAndSelect("participant.user", "participantUser")
    .where("expense.group_id = :groupId", { groupId });

  if (filters.categoryId) qb.andWhere("expense.category_id = :categoryId", { categoryId: filters.categoryId });
  if (filters.tagId) qb.andWhere("tag.id = :tagId", { tagId: filters.tagId });
  if (filters.paidById) qb.andWhere("expense.paid_by = :paidById", { paidById: filters.paidById });
  if (filters.involvesId) {
    qb.andWhere("(expense.paid_by = :involvesId OR participant.user_id = :involvesId)", {
      involvesId: filters.involvesId,
    });
  }
  if (filters.splitType) qb.andWhere("expense.split_type = :splitType", { splitType: filters.splitType });
  if (filters.from) qb.andWhere("expense.date >= :from", { from: filters.from });
  if (filters.to) qb.andWhere("expense.date <= :to", { to: filters.to });
  if (filters.q) qb.andWhere("expense.description ILIKE :q", { q: `%${filters.q}%` });
  if (filters.isRecurring !== undefined) {
    qb.andWhere("expense.is_recurring = :isRecurring", { isRecurring: filters.isRecurring });
  }

  const sortColumn =
    sort === "amount" ? "expense.amount" : sort === "createdAt" ? "expense.createdAt" : "expense.date";

  return qb
    .orderBy(sortColumn, order)
    .addOrderBy("expense.id", "DESC")
    .skip(pagination.skip)
    .take(pagination.limit)
    .getManyAndCount();
};

export const deleteExpense = async (expenseId: string): Promise<void> => {
  await AppDataSource.query("DELETE FROM expense_tags WHERE expense_id = $1", [expenseId]);
  await AppDataSource.getRepository(ExpenseParticipant).delete({ expenseId });
  await AppDataSource.getRepository(Expense).delete({ id: expenseId });
};

export const countExpensesUsingTags = async (tagIds: string[]): Promise<number> =>
  tagIds.length === 0
    ? 0
    : AppDataSource.getRepository(Expense)
        .createQueryBuilder("expense")
        .innerJoin("expense.tags", "tag")
        .where("tag.id IN (:...tagIds)", { tagIds })
        .getCount();

export const countExpenses = async (where: FindOptionsWhere<Expense>): Promise<number> =>
  AppDataSource.getRepository(Expense).count({ where });

export const findRecentExpensesForGroups = async (
  groupIds: string[],
  limit: number,
): Promise<Expense[]> =>
  groupIds.length === 0
    ? []
    : AppDataSource.getRepository(Expense).find({
        where: { groupId: In(groupIds) },
        relations: ["paidByUser", "category", "tags", "participants", "participants.user"],
        order: { createdAt: "DESC" },
        take: limit,
      });

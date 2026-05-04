import { AppDataSource } from "../data-source";
import { Budget } from "../entity/Budget";

export const findBudgetById = async (
  groupId: string,
  budgetId: string,
): Promise<Budget | null> =>
  AppDataSource.getRepository(Budget).findOne({
    where: { id: budgetId, groupId },
    relations: ["category", "createdByUser"],
  });

export const findBudgetByScope = async (
  groupId: string,
  month: string,
  categoryId: string | null,
): Promise<Budget | null> => {
  const qb = AppDataSource.getRepository(Budget)
    .createQueryBuilder("budget")
    .leftJoinAndSelect("budget.category", "category")
    .leftJoinAndSelect("budget.createdByUser", "createdByUser")
    .where("budget.group_id = :groupId", { groupId })
    .andWhere("budget.month = :month", { month });

  if (categoryId === null) {
    qb.andWhere("budget.category_id IS NULL");
  } else {
    qb.andWhere("budget.category_id = :categoryId", { categoryId });
  }

  return qb.getOne();
};

export const listBudgetsForGroup = async (
  groupId: string,
  month?: string,
): Promise<Budget[]> => {
  const qb = AppDataSource.getRepository(Budget)
    .createQueryBuilder("budget")
    .leftJoinAndSelect("budget.category", "category")
    .leftJoinAndSelect("budget.createdByUser", "createdByUser")
    .where("budget.group_id = :groupId", { groupId })
    .orderBy("budget.month", "DESC")
    .addOrderBy("category.name", "ASC");

  if (month) {
    qb.andWhere("budget.month = :month", { month });
  }

  return qb.getMany();
};

export const saveBudget = async (budget: Budget): Promise<Budget> =>
  AppDataSource.getRepository(Budget).save(budget);

export const createBudget = async (input: Partial<Budget>): Promise<Budget> =>
  AppDataSource.getRepository(Budget).save(
    AppDataSource.getRepository(Budget).create(input),
  );

export const deleteBudgetRecord = async (budgetId: string): Promise<void> => {
  await AppDataSource.getRepository(Budget).delete({ id: budgetId });
};

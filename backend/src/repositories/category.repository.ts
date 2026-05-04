import { IsNull } from "typeorm";

import { AppDataSource } from "../data-source";
import { Category } from "../entity/Category";

export const listSystemCategories = async (): Promise<Category[]> =>
  AppDataSource.getRepository(Category).find({
    where: { groupId: IsNull() },
    order: { name: "ASC" },
  });

export const listCategoriesForGroup = async (groupId: string): Promise<Category[]> =>
  AppDataSource.getRepository(Category).find({
    where: [{ groupId: IsNull() }, { groupId }],
    order: { groupId: "ASC", name: "ASC" },
  });

export const findCategoryById = async (categoryId: string): Promise<Category | null> =>
  AppDataSource.getRepository(Category).findOne({ where: { id: categoryId } });

export const createCategory = async (input: {
  groupId: string;
  name: string;
  icon: string | null;
  color: string | null;
}): Promise<Category> =>
  AppDataSource.getRepository(Category).save(
    AppDataSource.getRepository(Category).create(input),
  );

export const saveCategory = async (category: Category): Promise<Category> =>
  AppDataSource.getRepository(Category).save(category);

export const nullCategoryExpenses = async (categoryId: string): Promise<void> => {
  await AppDataSource.query("UPDATE expenses SET category_id = NULL WHERE category_id = $1", [
    categoryId,
  ]);
};

export const deleteCategory = async (categoryId: string): Promise<void> => {
  await AppDataSource.getRepository(Category).delete({ id: categoryId });
};

import {
  createCategory,
  deleteCategory,
  findCategoryById,
  listCategoriesForGroup,
  listSystemCategories,
  nullCategoryExpenses,
  saveCategory,
} from "../repositories/category.repository";
import { HttpError } from "../utils/http-error";
import { requireGroupAdmin, requireGroupMember } from "./group-access.service";
import { toCategoryResponse } from "./presenters";

export const getSystemCategories = async () =>
  (await listSystemCategories()).map(toCategoryResponse);

export const getGroupCategories = async (groupId: string, userId: string) => {
  await requireGroupMember(groupId, userId);
  return (await listCategoriesForGroup(groupId)).map(toCategoryResponse);
};

export const createGroupCategory = async (
  groupId: string,
  userId: string,
  input: { name: string; icon: string | null; color: string | null },
) => {
  await requireGroupAdmin(groupId, userId);
  return toCategoryResponse(await createCategory({ groupId, ...input }));
};

export const updateGroupCategory = async (
  groupId: string,
  userId: string,
  categoryId: string,
  input: { name?: string; icon?: string | null; color?: string | null },
) => {
  await requireGroupAdmin(groupId, userId);
  const category = await findCategoryById(categoryId);

  if (!category || category.groupId !== groupId) {
    throw new HttpError(404, "Resource not found", "NOT_FOUND");
  }

  if (input.name !== undefined) category.name = input.name;
  if (input.icon !== undefined) category.icon = input.icon;
  if (input.color !== undefined) category.color = input.color;

  return toCategoryResponse(await saveCategory(category));
};

export const deleteGroupCategory = async (
  groupId: string,
  userId: string,
  categoryId: string,
): Promise<void> => {
  await requireGroupAdmin(groupId, userId);
  const category = await findCategoryById(categoryId);

  if (!category || category.groupId !== groupId) {
    throw new HttpError(404, "Resource not found", "NOT_FOUND");
  }

  await nullCategoryExpenses(categoryId);
  await deleteCategory(categoryId);
};

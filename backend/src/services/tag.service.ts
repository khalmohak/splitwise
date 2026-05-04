import {
  createTag,
  deleteTag,
  detachTagFromExpenses,
  findTagById,
  listTagsWithExpenseCount,
  saveTag,
} from "../repositories/tag.repository";
import { HttpError } from "../utils/http-error";
import { requireGroupAdmin, requireGroupMember } from "./group-access.service";
import { toTagResponse } from "./presenters";

export const getGroupTags = async (groupId: string, userId: string) => {
  await requireGroupMember(groupId, userId);
  return (await listTagsWithExpenseCount(groupId)).map((tag) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color,
    expenseCount: Number(tag.expense_count),
  }));
};

export const createGroupTag = async (
  groupId: string,
  userId: string,
  input: { name: string; color: string | null },
) => {
  await requireGroupMember(groupId, userId);
  return toTagResponse(await createTag({ groupId, ...input }), 0);
};

export const updateGroupTag = async (
  groupId: string,
  userId: string,
  tagId: string,
  input: { name?: string; color?: string | null },
) => {
  await requireGroupAdmin(groupId, userId);
  const tag = await findTagById(tagId);

  if (!tag || tag.groupId !== groupId) {
    throw new HttpError(404, "Resource not found", "NOT_FOUND");
  }

  if (input.name !== undefined) tag.name = input.name;
  if (input.color !== undefined) tag.color = input.color;

  return toTagResponse(await saveTag(tag));
};

export const deleteGroupTag = async (
  groupId: string,
  userId: string,
  tagId: string,
): Promise<void> => {
  await requireGroupAdmin(groupId, userId);
  const tag = await findTagById(tagId);

  if (!tag || tag.groupId !== groupId) {
    throw new HttpError(404, "Resource not found", "NOT_FOUND");
  }

  await detachTagFromExpenses(tagId);
  await deleteTag(tagId);
};

import { AppDataSource } from "../data-source";
import { Tag } from "../entity/Tag";

export type TagWithExpenseCountRow = {
  id: string;
  name: string;
  color: string | null;
  expense_count: string;
};

export const listTagsWithExpenseCount = async (
  groupId: string,
): Promise<TagWithExpenseCountRow[]> =>
  AppDataSource.query(
    `
      SELECT tag.id, tag.name, tag.color, COUNT(expense_tag.expense_id)::text AS expense_count
      FROM tags tag
      LEFT JOIN expense_tags expense_tag ON expense_tag.tag_id = tag.id
      WHERE tag.group_id = $1
      GROUP BY tag.id
      ORDER BY tag.name ASC
    `,
    [groupId],
  );

export const findTagById = async (tagId: string): Promise<Tag | null> =>
  AppDataSource.getRepository(Tag).findOne({ where: { id: tagId } });

export const findTagsByIds = async (tagIds: string[]): Promise<Tag[]> =>
  tagIds.length === 0
    ? []
    : AppDataSource.getRepository(Tag)
        .createQueryBuilder("tag")
        .where("tag.id IN (:...tagIds)", { tagIds })
        .getMany();

export const createTag = async (input: {
  groupId: string;
  name: string;
  color: string | null;
}): Promise<Tag> =>
  AppDataSource.getRepository(Tag).save(AppDataSource.getRepository(Tag).create(input));

export const saveTag = async (tag: Tag): Promise<Tag> =>
  AppDataSource.getRepository(Tag).save(tag);

export const detachTagFromExpenses = async (tagId: string): Promise<void> => {
  await AppDataSource.query("DELETE FROM expense_tags WHERE tag_id = $1", [tagId]);
};

export const deleteTag = async (tagId: string): Promise<void> => {
  await AppDataSource.getRepository(Tag).delete({ id: tagId });
};

import { In } from "typeorm";

import { AppDataSource } from "../data-source";
import { Category } from "../entity/Category";
import { Expense } from "../entity/Expense";
import { Group } from "../entity/Group";
import { GroupMember } from "../entity/GroupMember";
import { GroupType, MemberRole } from "../entity/enums";
import { Settlement } from "../entity/Settlement";
import { Tag } from "../entity/Tag";

export type UserGroupListRow = {
  id: string;
  name: string;
  type: GroupType;
  description: string | null;
  member_count: string;
  your_role: MemberRole;
  last_activity_at: Date | null;
};

export const findGroupById = async (groupId: string): Promise<Group | null> =>
  AppDataSource.getRepository(Group).findOne({ where: { id: groupId } });

export const findGroupWithCreator = async (groupId: string): Promise<Group | null> =>
  AppDataSource.getRepository(Group).findOne({
    where: { id: groupId },
    relations: ["createdByUser"],
  });

export const createGroup = async (input: {
  name: string;
  description: string | null;
  type: GroupType;
  createdById: string;
}): Promise<Group> =>
  AppDataSource.getRepository(Group).save(
    AppDataSource.getRepository(Group).create(input),
  );

export const saveGroup = async (group: Group): Promise<Group> =>
  AppDataSource.getRepository(Group).save(group);

export const findMembership = async (
  groupId: string,
  userId: string,
): Promise<GroupMember | null> =>
  AppDataSource.getRepository(GroupMember).findOne({
    where: { groupId, userId },
    relations: ["user"],
  });

export const listGroupMembers = async (groupId: string): Promise<GroupMember[]> =>
  AppDataSource.getRepository(GroupMember).find({
    where: { groupId },
    relations: ["user"],
    order: { joinedAt: "ASC" },
  });

export const countGroupAdmins = async (groupId: string): Promise<number> =>
  AppDataSource.getRepository(GroupMember).count({
    where: { groupId, role: MemberRole.ADMIN },
  });

export const addGroupMember = async (input: {
  groupId: string;
  userId: string;
  role: MemberRole;
}): Promise<GroupMember> =>
  AppDataSource.getRepository(GroupMember).save(
    AppDataSource.getRepository(GroupMember).create(input),
  );

export const saveGroupMember = async (member: GroupMember): Promise<GroupMember> =>
  AppDataSource.getRepository(GroupMember).save(member);

export const removeGroupMember = async (groupId: string, userId: string): Promise<void> => {
  await AppDataSource.getRepository(GroupMember).delete({ groupId, userId });
};

export const getUserGroupRows = async (
  userId: string,
  type?: GroupType,
): Promise<UserGroupListRow[]> =>
  AppDataSource.query(
    `
      SELECT
        "group".id,
        "group".name,
        "group".type,
        "group".description,
        COUNT(DISTINCT all_members.user_id)::text AS member_count,
        current_member.role AS your_role,
        GREATEST(
          "group".updated_at,
          COALESCE(MAX(expense.created_at), 'epoch'::timestamp),
          COALESCE(MAX(settlement.created_at), 'epoch'::timestamp)
        ) AS last_activity_at
      FROM groups "group"
      INNER JOIN group_members current_member
        ON current_member.group_id = "group".id
        AND current_member.user_id = $1
      LEFT JOIN group_members all_members ON all_members.group_id = "group".id
      LEFT JOIN expenses expense ON expense.group_id = "group".id
      LEFT JOIN settlements settlement ON settlement.group_id = "group".id
      WHERE ($2::text IS NULL OR "group".type::text = $2)
      GROUP BY "group".id, current_member.role
      ORDER BY last_activity_at DESC
    `,
    [userId, type ?? null],
  );

export const deleteGroupCascade = async (groupId: string): Promise<void> => {
  const expenses = await AppDataSource.getRepository(Expense).find({
    select: ["id"],
    where: { groupId },
  });
  const expenseIds = expenses.map((expense) => expense.id);

  if (expenseIds.length > 0) {
    await AppDataSource.query(
      "DELETE FROM expense_tags WHERE expense_id = ANY($1::uuid[])",
      [expenseIds],
    );
    await AppDataSource.query(
      "DELETE FROM expense_participants WHERE expense_id = ANY($1::uuid[])",
      [expenseIds],
    );
  }

  await AppDataSource.getRepository(Settlement).delete({ groupId });
  await AppDataSource.getRepository(Expense).delete({ groupId });
  await AppDataSource.getRepository(Tag).delete({ groupId });
  await AppDataSource.getRepository(Category).delete({ groupId });
  await AppDataSource.getRepository(GroupMember).delete({ groupId });
  await AppDataSource.getRepository(Group).delete({ id: groupId });
};

export const findGroupMembersByIds = async (
  groupId: string,
  userIds: string[],
): Promise<GroupMember[]> =>
  userIds.length === 0
    ? []
    : AppDataSource.getRepository(GroupMember).find({
        where: { groupId, userId: In(userIds) },
        relations: ["user"],
      });

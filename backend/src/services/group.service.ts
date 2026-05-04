import { GroupType, MemberRole } from "../entity/enums";
import {
  addGroupMember,
  createGroup,
  deleteGroupCascade,
  findGroupWithCreator,
  findMembership,
  getUserGroupRows,
  listGroupMembers,
  removeGroupMember,
  saveGroup,
  saveGroupMember,
} from "../repositories/group.repository";
import { findUserByEmail } from "../repositories/user.repository";
import { HttpError } from "../utils/http-error";
import { formatCents, parseMoneyToCents } from "../utils/money";
import { getUserBalanceRows } from "../repositories/user-balances.repository";
import { hasOutstandingBalance } from "./balance.service";
import {
  isOnlyAdmin,
  requireGroup,
  requireGroupAdmin,
  requireGroupMember,
} from "./group-access.service";
import { toGroupDetailResponse, toMemberResponse } from "./presenters";
import { sendEmailSafely } from "./email.service";
import { addedToGroupEmail, groupCreatedEmail } from "./email-templates";

export const createGroupForUser = async (
  userId: string,
  input: { name: string; description: string | null; type: GroupType },
) => {
  const group = await createGroup({ ...input, createdById: userId });
  const member = await addGroupMember({
    groupId: group.id,
    userId,
    role: MemberRole.ADMIN,
  });
  const groupWithCreator = (await findGroupWithCreator(group.id))!;
  const response = toGroupDetailResponse(groupWithCreator, [{ ...member, user: groupWithCreator.createdByUser }]);

  sendEmailSafely({
    to: groupWithCreator.createdByUser.email,
    ...groupCreatedEmail({
      name: groupWithCreator.createdByUser.name,
      groupName: groupWithCreator.name,
    }),
  });

  return response;
};

export const listGroupsForUser = async (userId: string, type?: GroupType) => {
  const [rows, balanceRows] = await Promise.all([
    getUserGroupRows(userId, type),
    getUserBalanceRows(userId, type),
  ]);
  const balanceByGroup = new Map<string, number>();

  for (const row of balanceRows) {
    balanceByGroup.set(
      row.group_id,
      (balanceByGroup.get(row.group_id) ?? 0) + parseMoneyToCents(row.amount),
    );
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
    memberCount: Number(row.member_count),
    yourRole: row.your_role,
    yourBalance: formatCents(balanceByGroup.get(row.id) ?? 0),
    lastActivityAt: row.last_activity_at?.toISOString?.() ?? null,
  }));
};

export const getGroupDetail = async (groupId: string, userId: string) => {
  await requireGroupMember(groupId, userId);
  const group = await findGroupWithCreator(groupId);

  if (!group) {
    throw new HttpError(404, "Resource not found", "NOT_FOUND");
  }

  return toGroupDetailResponse(group, await listGroupMembers(groupId));
};

export const updateGroup = async (
  groupId: string,
  userId: string,
  input: { name?: string; description?: string | null },
) => {
  await requireGroupAdmin(groupId, userId);
  const group = await requireGroup(groupId);

  if (input.name !== undefined) {
    group.name = input.name;
  }

  if (input.description !== undefined) {
    group.description = input.description;
  }

  await saveGroup(group);
  return getGroupDetail(groupId, userId);
};

export const deleteGroup = async (groupId: string, userId: string): Promise<void> => {
  await requireGroupAdmin(groupId, userId);

  if (await hasOutstandingBalance(groupId)) {
    throw new HttpError(
      422,
      "Outstanding balances exist",
      "UNSETTLED_BALANCES",
    );
  }

  await deleteGroupCascade(groupId);
};

export const addMember = async (
  groupId: string,
  userId: string,
  input: { email: string; role: MemberRole },
) => {
  await requireGroupAdmin(groupId, userId);
  const user = await findUserByEmail(input.email);

  if (!user) {
    throw new HttpError(404, "Resource not found", "NOT_FOUND");
  }

  if (await findMembership(groupId, user.id)) {
    throw new HttpError(409, "User is already a member", "CONFLICT");
  }

  await addGroupMember({ groupId, userId: user.id, role: input.role });
  const group = await requireGroup(groupId);

  sendEmailSafely({
    to: user.email,
    ...addedToGroupEmail({
      name: user.name,
      groupName: group.name,
      role: input.role,
    }),
  });

  return (await listGroupMembers(groupId)).map(toMemberResponse);
};

export const updateMemberRole = async (
  groupId: string,
  actorId: string,
  targetUserId: string,
  role: MemberRole,
) => {
  await requireGroupAdmin(groupId, actorId);
  const member = await requireGroupMember(groupId, targetUserId);

  if (
    actorId === targetUserId &&
    role === MemberRole.MEMBER &&
    (await isOnlyAdmin(groupId, member))
  ) {
    throw new HttpError(403, "Cannot demote yourself as the only admin", "FORBIDDEN");
  }

  member.role = role;
  return toMemberResponse(await saveGroupMember(member));
};

export const removeMember = async (
  groupId: string,
  actorId: string,
  targetUserId: string,
): Promise<void> => {
  const actor = await requireGroupMember(groupId, actorId);
  const target = await requireGroupMember(groupId, targetUserId);

  if (actorId !== targetUserId && actor.role !== MemberRole.ADMIN) {
    throw new HttpError(403, "Cannot remove another member", "FORBIDDEN");
  }

  if (actorId === targetUserId && (await isOnlyAdmin(groupId, target))) {
    throw new HttpError(403, "Cannot remove yourself as the only admin", "FORBIDDEN");
  }

  if (await hasOutstandingBalance(groupId, targetUserId)) {
    throw new HttpError(
      422,
      "Member has outstanding debts",
      "UNSETTLED_BALANCES",
    );
  }

  await removeGroupMember(groupId, targetUserId);
};

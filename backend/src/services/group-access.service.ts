import type { Group } from "../entity/Group";
import type { GroupMember } from "../entity/GroupMember";
import { MemberRole } from "../entity/enums";
import {
  countGroupAdmins,
  findGroupById,
  findMembership,
} from "../repositories/group.repository";
import { HttpError } from "../utils/http-error";

export const requireGroup = async (groupId: string): Promise<Group> => {
  const group = await findGroupById(groupId);

  if (!group) {
    throw new HttpError(404, "Resource not found", "NOT_FOUND");
  }

  return group;
};

export const requireGroupMember = async (
  groupId: string,
  userId: string,
): Promise<GroupMember> => {
  await requireGroup(groupId);
  const membership = await findMembership(groupId, userId);

  if (!membership) {
    throw new HttpError(404, "Resource not found", "NOT_FOUND");
  }

  return membership;
};

export const requireGroupAdmin = async (
  groupId: string,
  userId: string,
): Promise<GroupMember> => {
  const membership = await requireGroupMember(groupId, userId);

  if (membership.role !== MemberRole.ADMIN) {
    throw new HttpError(403, "Admin role required", "FORBIDDEN");
  }

  return membership;
};

export const isGroupAdmin = async (
  groupId: string,
  userId: string,
): Promise<boolean> => {
  const membership = await findMembership(groupId, userId);

  return membership?.role === MemberRole.ADMIN;
};

export const isOnlyAdmin = async (
  groupId: string,
  membership: GroupMember,
): Promise<boolean> =>
  membership.role === MemberRole.ADMIN && (await countGroupAdmins(groupId)) <= 1;

import type { Category } from "../entity/Category";
import type { Expense } from "../entity/Expense";
import type { Group } from "../entity/Group";
import type { GroupMember } from "../entity/GroupMember";
import type { Settlement } from "../entity/Settlement";
import type { Tag } from "../entity/Tag";
import type { User } from "../entity/User";

export const toUserSummary = (user: User) => ({
  id: user.id,
  name: user.name,
  avatarUrl: user.avatarUrl,
});

export const toCategoryResponse = (category: Category) => ({
  id: category.id,
  name: category.name,
  icon: category.icon,
  color: category.color,
  groupId: category.groupId,
});

export const toTagResponse = (tag: Tag, expenseCount = 0) => ({
  id: tag.id,
  name: tag.name,
  color: tag.color,
  expenseCount,
});

export const toMemberResponse = (member: GroupMember) => ({
  userId: member.userId,
  name: member.user.name,
  email: member.user.email,
  avatarUrl: member.user.avatarUrl,
  role: member.role,
  joinedAt: member.joinedAt.toISOString(),
});

export const toGroupDetailResponse = (group: Group, members: GroupMember[]) => ({
  id: group.id,
  name: group.name,
  type: group.type,
  description: group.description,
  createdBy: {
    id: group.createdById,
    name: group.createdByUser?.name,
  },
  members: members.map(toMemberResponse),
  createdAt: group.createdAt.toISOString(),
  updatedAt: group.updatedAt.toISOString(),
});

export const toExpenseResponse = (
  expense: Expense,
  myShare?: string,
  includeDetail = false,
) => ({
  id: expense.id,
  description: expense.description,
  amount: expense.amount,
  date: expense.date,
  splitType: expense.splitType,
  ...(includeDetail ? { notes: expense.notes } : {}),
  paidBy: toUserSummary(expense.paidByUser),
  category: expense.category ? toCategoryResponse(expense.category) : null,
  tags: (expense.tags ?? []).map((tag) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color,
  })),
  ...(myShare !== undefined ? { myShare } : {}),
  participants: (expense.participants ?? []).map((participant) => ({
    userId: participant.userId,
    name: participant.user.name,
    avatarUrl: participant.user.avatarUrl,
    shareAmount: participant.shareAmount,
    ...(includeDetail ? { splitInput: participant.splitInput } : {}),
  })),
  isRecurring: expense.isRecurring,
  ...(includeDetail
    ? {
        recurInterval: expense.recurInterval,
        recurAnchor: expense.recurAnchor,
        createdBy: {
          id: expense.createdById,
          name: expense.createdByUser.name,
        },
        updatedAt: expense.updatedAt.toISOString(),
      }
    : {}),
  createdAt: expense.createdAt.toISOString(),
});

export const toSettlementResponse = (settlement: Settlement) => ({
  id: settlement.id,
  paidBy: toUserSummary(settlement.paidByUser),
  paidTo: toUserSummary(settlement.paidToUser),
  amount: settlement.amount,
  date: settlement.date,
  notes: settlement.notes,
  createdAt: settlement.createdAt.toISOString(),
});

import { findRecentExpensesForGroups } from "../repositories/expense.repository";
import { getUserGroupRows } from "../repositories/group.repository";
import { findRecentSettlementsForGroups } from "../repositories/settlement.repository";
import { findRecentAuditLogsForGroups } from "../repositories/audit-log.repository";
import { requireGroupMember } from "./group-access.service";
import { buildPaginationMeta, type PaginationParams } from "../utils/pagination";
import { toAuditLogResponse } from "./audit-log.service";

type ActivityGroupInfo = {
  id: string;
  name: string;
  type: string;
};

const buildActivity = async (
  groupIds: string[],
  pagination: PaginationParams,
  groupInfoById = new Map<string, ActivityGroupInfo>(),
) => {
  const [expenses, settlements, auditLogs] = await Promise.all([
    findRecentExpensesForGroups(groupIds, 200),
    findRecentSettlementsForGroups(groupIds, 200),
    findRecentAuditLogsForGroups(groupIds, 200),
  ]);
  const includeGroup = groupInfoById.size > 0;
  const items = [
    ...expenses.map((expense) => ({
      id: expense.id,
      type: "expense_created",
      actor: { id: expense.paidById, name: expense.paidByUser.name, avatarUrl: expense.paidByUser.avatarUrl },
      summary: `${expense.paidByUser.name} added ${expense.description}`,
      payload: { expenseId: expense.id, description: expense.description, amount: expense.amount },
      createdAt: expense.createdAt.toISOString(),
      ...(includeGroup ? { group: groupInfoById.get(expense.groupId) } : {}),
    })),
    ...settlements.map((settlement) => ({
      id: settlement.id,
      type: "settlement_created",
      actor: { id: settlement.paidById, name: settlement.paidByUser.name, avatarUrl: settlement.paidByUser.avatarUrl },
      summary: `${settlement.paidByUser.name} paid ${settlement.paidToUser.name} ${settlement.amount}`,
      payload: { settlementId: settlement.id, paidTo: { id: settlement.paidToId, name: settlement.paidToUser.name }, amount: settlement.amount },
      createdAt: settlement.createdAt.toISOString(),
      ...(includeGroup ? { group: groupInfoById.get(settlement.groupId) } : {}),
    })),
    ...auditLogs.map((auditLog) => {
      const item = toAuditLogResponse(auditLog);

      return {
        ...item,
        payload: {
          resource: item.resource,
          changedFields: item.changedFields,
        },
        ...(includeGroup ? { group: groupInfoById.get(auditLog.groupId) } : {}),
      };
    }),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return {
    data: items.slice(pagination.skip, pagination.skip + pagination.limit),
    meta: buildPaginationMeta(items.length, pagination.page, pagination.limit),
  };
};

export const getGroupActivity = async (groupId: string, userId: string, pagination: PaginationParams) => {
  await requireGroupMember(groupId, userId);
  return buildActivity([groupId], pagination);
};

export const getUserActivity = async (userId: string, pagination: PaginationParams, groupId?: string) => {
  const groups = await getUserGroupRows(userId);
  const groupIds = groupId ? [groupId] : groups.map((group) => group.id);
  const groupInfoById = new Map(
    groups.map((group) => [
      group.id,
      {
        id: group.id,
        name: group.name,
        type: group.type,
      },
    ]),
  );
  return buildActivity(groupIds, pagination, groupInfoById);
};

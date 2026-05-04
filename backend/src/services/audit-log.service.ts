import {
  AuditAction,
  AuditResourceType,
  type AuditChange,
  type AuditLog,
} from "../entity/AuditLog";
import type { Expense } from "../entity/Expense";
import type { Settlement } from "../entity/Settlement";
import {
  createAuditLogRecord,
  listAuditLogs,
  type AuditLogFilters,
} from "../repositories/audit-log.repository";
import { findUserById } from "../repositories/user.repository";
import { buildPaginationMeta, type PaginationParams } from "../utils/pagination";
import { requireGroupMember } from "./group-access.service";
import { toUserSummary } from "./presenters";

type AuditSnapshot = Record<string, unknown>;

const orderedStringify = (value: unknown): string => JSON.stringify(value);

const buildChanges = (
  before: AuditSnapshot,
  after: AuditSnapshot,
): AuditChange[] =>
  Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((field) => orderedStringify(before[field]) !== orderedStringify(after[field]))
    .map((field) => ({
      field,
      before: before[field] ?? null,
      after: after[field] ?? null,
    }));

const resourceName = (
  resourceType: AuditResourceType,
  snapshot: AuditSnapshot | null,
): string => {
  if (resourceType === AuditResourceType.EXPENSE) {
    return typeof snapshot?.description === "string" ? snapshot.description : "expense";
  }

  return "settlement";
};

const buildSummary = (input: {
  actorName: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  before: AuditSnapshot | null;
  after: AuditSnapshot | null;
  changedFields: AuditChange[] | null;
}): string => {
  const snapshot = input.after ?? input.before;
  const name = resourceName(input.resourceType, snapshot);

  if (input.action === AuditAction.CREATED) {
    return input.resourceType === AuditResourceType.EXPENSE
      ? `${input.actorName} added ${name}`
      : `${input.actorName} recorded a settlement`;
  }

  if (input.action === AuditAction.DELETED) {
    return input.resourceType === AuditResourceType.EXPENSE
      ? `${input.actorName} deleted ${name}`
      : `${input.actorName} deleted a settlement`;
  }

  const changed = input.changedFields ?? [];
  const amountChange = changed.find((change) => change.field === "amount");
  if (input.resourceType === AuditResourceType.EXPENSE && amountChange) {
    return `${input.actorName} changed ${name} amount from ${String(amountChange.before)} to ${String(amountChange.after)}`;
  }

  const fields = changed.map((change) => change.field).join(", ");
  return input.resourceType === AuditResourceType.EXPENSE
    ? `${input.actorName} updated ${name}${fields ? ` (${fields})` : ""}`
    : `${input.actorName} updated a settlement${fields ? ` (${fields})` : ""}`;
};

const sortByName = <T extends { name: string }>(items: T[]): T[] =>
  [...items].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );

export const snapshotExpense = (expense: Expense): AuditSnapshot => ({
  id: expense.id,
  description: expense.description,
  amount: expense.amount,
  date: expense.date,
  splitType: expense.splitType,
  notes: expense.notes,
  isRecurring: expense.isRecurring,
  recurInterval: expense.recurInterval,
  recurAnchor: expense.recurAnchor,
  paidBy: expense.paidByUser
    ? toUserSummary(expense.paidByUser)
    : { id: expense.paidById },
  category: expense.category
    ? {
        id: expense.category.id,
        name: expense.category.name,
        icon: expense.category.icon,
        color: expense.category.color,
      }
    : null,
  tags: sortByName(
    (expense.tags ?? []).map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
    })),
  ),
  participants: sortByName(
    (expense.participants ?? []).map((participant) => ({
      userId: participant.userId,
      name: participant.user?.name ?? "",
      avatarUrl: participant.user?.avatarUrl ?? null,
      shareAmount: participant.shareAmount,
      splitInput: participant.splitInput,
    })),
  ),
});

export const snapshotSettlement = (settlement: Settlement): AuditSnapshot => ({
  id: settlement.id,
  paidBy: settlement.paidByUser
    ? toUserSummary(settlement.paidByUser)
    : { id: settlement.paidById },
  paidTo: settlement.paidToUser
    ? toUserSummary(settlement.paidToUser)
    : { id: settlement.paidToId },
  amount: settlement.amount,
  date: settlement.date,
  notes: settlement.notes,
});

export const recordAuditLog = async (input: {
  groupId: string;
  actorId: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  before: AuditSnapshot | null;
  after: AuditSnapshot | null;
}): Promise<void> => {
  const actor = await findUserById(input.actorId);
  const changedFields =
    input.before && input.after ? buildChanges(input.before, input.after) : null;

  if (input.action === AuditAction.UPDATED && changedFields?.length === 0) {
    return;
  }

  const summary = buildSummary({
    actorName: actor?.name ?? "Someone",
    action: input.action,
    resourceType: input.resourceType,
    before: input.before,
    after: input.after,
    changedFields,
  });

  await createAuditLogRecord({
    ...input,
    summary,
    changedFields,
  });
};

export const toAuditLogResponse = (auditLog: AuditLog) => ({
  id: auditLog.id,
  type: `${auditLog.resourceType}_${auditLog.action}`,
  action: auditLog.action,
  resource: {
    type: auditLog.resourceType,
    id: auditLog.resourceId,
  },
  actor: auditLog.actor ? toUserSummary(auditLog.actor) : { id: auditLog.actorId },
  summary: auditLog.summary,
  before: auditLog.before,
  after: auditLog.after,
  changedFields: auditLog.changedFields ?? [],
  createdAt: auditLog.createdAt.toISOString(),
});

export const getGroupAuditLogs = async (
  groupId: string,
  userId: string,
  filters: AuditLogFilters,
  pagination: PaginationParams,
) => {
  await requireGroupMember(groupId, userId);
  const [auditLogs, total] = await listAuditLogs(groupId, filters, pagination);

  return {
    data: auditLogs.map(toAuditLogResponse),
    meta: buildPaginationMeta(total, pagination.page, pagination.limit),
  };
};

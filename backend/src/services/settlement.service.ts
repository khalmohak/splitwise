import {
  findGroupMembersByIds,
  getUserGroupRows,
} from "../repositories/group.repository";
import { AuditAction, AuditResourceType } from "../entity/AuditLog";
import type { GroupType } from "../entity/enums";
import {
  createSettlementRecord,
  deleteSettlementRecord,
  findSettlementDetail,
  listSettlements,
  type SettlementFilters,
} from "../repositories/settlement.repository";
import { HttpError } from "../utils/http-error";
import { buildPaginationMeta, type PaginationParams } from "../utils/pagination";
import { formatCents, isMoneyString, parseMoneyToCents } from "../utils/money";
import { isDateOnly } from "../utils/date";
import {
  getMyGroupBalances,
  getSimplifiedGroupBalances,
  type BalanceEntry,
} from "./balance.service";
import { isGroupAdmin, requireGroupMember } from "./group-access.service";
import { toSettlementResponse } from "./presenters";
import {
  recordAuditLog,
  snapshotSettlement,
} from "./audit-log.service";

export type SettlementInput = {
  paidById: string;
  paidToId: string;
  amount: string;
  date: string;
  notes: string | null;
};

export type SuggestedSettlementInput = {
  paidById: string;
  paidToId: string;
  amount?: string;
  date?: string;
  notes?: string | null;
};

export const createSettlement = async (
  groupId: string,
  actorId: string,
  input: SettlementInput,
) => {
  await requireGroupMember(groupId, actorId);
  if (!isMoneyString(input.amount) || parseMoneyToCents(input.amount) <= 0) {
    throw new HttpError(400, "Validation failed", "VALIDATION_ERROR", {
      amount: "Amount must be a positive string with 2 decimals",
    });
  }
  if (!isDateOnly(input.date)) {
    throw new HttpError(400, "Validation failed", "VALIDATION_ERROR", {
      date: "Date must be in YYYY-MM-DD format",
    });
  }
  const members = await findGroupMembersByIds(groupId, [input.paidById, input.paidToId]);
  if (members.length !== 2 || input.paidById === input.paidToId) {
    throw new HttpError(422, "Both users must be group members", "UNPROCESSABLE");
  }
  const settlement = await createSettlementRecord({
    groupId,
    paidById: input.paidById,
    paidToId: input.paidToId,
    amount: input.amount,
    date: input.date,
    notes: input.notes,
  });
  const createdSettlement = (await findSettlementDetail(groupId, settlement.id))!;
  await recordAuditLog({
    groupId,
    actorId,
    action: AuditAction.CREATED,
    resourceType: AuditResourceType.SETTLEMENT,
    resourceId: createdSettlement.id,
    before: null,
    after: snapshotSettlement(createdSettlement),
  });
  return toSettlementResponse(createdSettlement);
};

export const settleWithUser = async (
  groupId: string,
  actorId: string,
  targetUserId: string,
) => {
  const balances = await getMyGroupBalances(groupId, actorId);
  const detail = balances.detail.find((row) => row.user.id === targetUserId);
  if (!detail || parseMoneyToCents(detail.net) === 0) {
    throw new HttpError(422, "Net balance is already zero", "UNPROCESSABLE");
  }
  const netCents = parseMoneyToCents(detail.net);
  return createSettlement(groupId, actorId, {
    paidById: netCents < 0 ? actorId : targetUserId,
    paidToId: netCents < 0 ? targetUserId : actorId,
    amount: formatCents(Math.abs(netCents)),
    date: new Date().toISOString().slice(0, 10),
    notes: "One-click settle",
  });
};

const suggestionSummary = (
  balance: BalanceEntry,
  viewerId: string,
): { direction: "you_pay" | "you_receive" | "other"; summary: string } => {
  if (balance.from.id === viewerId) {
    return {
      direction: "you_pay",
      summary: `Pay ${balance.to.name} ${balance.amount}`,
    };
  }

  if (balance.to.id === viewerId) {
    return {
      direction: "you_receive",
      summary: `${balance.from.name} pays you ${balance.amount}`,
    };
  }

  return {
    direction: "other",
    summary: `${balance.from.name} pays ${balance.to.name} ${balance.amount}`,
  };
};

const toSettlementSuggestion = (balance: BalanceEntry, viewerId: string) => {
  const summary = suggestionSummary(balance, viewerId);

  return {
    from: balance.from,
    to: balance.to,
    amount: balance.amount,
    direction: summary.direction,
    involvesYou: balance.from.id === viewerId || balance.to.id === viewerId,
    summary: summary.summary,
  };
};

export const getGroupSettlementSuggestions = async (
  groupId: string,
  userId: string,
) => {
  const simplified = await getSimplifiedGroupBalances(groupId, userId);
  const suggestions = simplified.balances.map((balance) =>
    toSettlementSuggestion(balance, userId),
  );
  const totalAmountCents = suggestions.reduce(
    (total, suggestion) => total + parseMoneyToCents(suggestion.amount),
    0,
  );

  return {
    groupId,
    asOf: simplified.asOf,
    transactionCount: suggestions.length,
    totalAmount: formatCents(totalAmountCents),
    suggestions,
    yourSuggestions: suggestions.filter((suggestion) => suggestion.involvesYou),
  };
};

export const recordSuggestedSettlement = async (
  groupId: string,
  actorId: string,
  input: SuggestedSettlementInput,
) => {
  await requireGroupMember(groupId, actorId);

  if (input.paidById === input.paidToId) {
    throw new HttpError(422, "Both users must be different group members", "UNPROCESSABLE");
  }

  if (input.amount !== undefined && (!isMoneyString(input.amount) || parseMoneyToCents(input.amount) <= 0)) {
    throw new HttpError(400, "Validation failed", "VALIDATION_ERROR", {
      amount: "Amount must be a positive string with 2 decimals",
    });
  }

  if (input.date !== undefined && !isDateOnly(input.date)) {
    throw new HttpError(400, "Validation failed", "VALIDATION_ERROR", {
      date: "Date must be in YYYY-MM-DD format",
    });
  }

  const currentSuggestions = await getGroupSettlementSuggestions(groupId, actorId);
  const suggestion = currentSuggestions.suggestions.find(
    (candidate) =>
      candidate.from.id === input.paidById &&
      candidate.to.id === input.paidToId,
  );

  if (!suggestion) {
    throw new HttpError(
      422,
      "No current settlement suggestion exists for these users",
      "SUGGESTION_NOT_FOUND",
    );
  }

  const suggestedAmountCents = parseMoneyToCents(suggestion.amount);
  const requestedAmountCents = input.amount === undefined
    ? suggestedAmountCents
    : parseMoneyToCents(input.amount);

  if (requestedAmountCents > suggestedAmountCents) {
    throw new HttpError(
      422,
      "Settlement amount exceeds the current suggestion",
      "UNPROCESSABLE",
    );
  }

  const settlement = await createSettlement(groupId, actorId, {
    paidById: input.paidById,
    paidToId: input.paidToId,
    amount: formatCents(requestedAmountCents),
    date: input.date ?? new Date().toISOString().slice(0, 10),
    notes: input.notes ?? "Recorded from settlement suggestion",
  });

  return {
    settlement,
    previousSuggestion: suggestion,
    settlementSuggestions: await getGroupSettlementSuggestions(groupId, actorId),
  };
};

export const getUserSettlementSuggestions = async (
  userId: string,
  type?: GroupType,
) => {
  const groups = await getUserGroupRows(userId, type);
  const suggestionsByGroup = await Promise.all(
    groups.map(async (group) => ({
      group,
      suggestions: await getGroupSettlementSuggestions(group.id, userId),
    })),
  );
  const groupsWithSuggestions = suggestionsByGroup
    .map(({ group, suggestions }) => ({
      group: {
        id: group.id,
        name: group.name,
        type: group.type,
      },
      suggestions: suggestions.yourSuggestions,
    }))
    .filter((group) => group.suggestions.length > 0);
  const totals = groupsWithSuggestions
    .flatMap((group) => group.suggestions)
    .reduce(
      (total, suggestion) => {
        const amountCents = parseMoneyToCents(suggestion.amount);

        if (suggestion.direction === "you_pay") {
          total.youPay += amountCents;
        } else if (suggestion.direction === "you_receive") {
          total.youReceive += amountCents;
        }

        return total;
      },
      { youPay: 0, youReceive: 0 },
    );

  return {
    asOf: new Date().toISOString(),
    totalYouPay: formatCents(totals.youPay),
    totalYouReceive: formatCents(totals.youReceive),
    net: formatCents(totals.youReceive - totals.youPay),
    groupCount: groupsWithSuggestions.length,
    transactionCount: groupsWithSuggestions.reduce(
      (count, group) => count + group.suggestions.length,
      0,
    ),
    groups: groupsWithSuggestions,
  };
};

export const getSettlements = async (
  groupId: string,
  actorId: string,
  filters: SettlementFilters,
  pagination: PaginationParams,
  sort: "date" | "amount",
  order: "ASC" | "DESC",
) => {
  await requireGroupMember(groupId, actorId);
  const [settlements, total] = await listSettlements(groupId, filters, pagination, sort, order);
  return {
    data: settlements.map(toSettlementResponse),
    meta: buildPaginationMeta(total, pagination.page, pagination.limit),
  };
};

export const deleteSettlement = async (
  groupId: string,
  actorId: string,
  settlementId: string,
): Promise<void> => {
  const settlement = await findSettlementDetail(groupId, settlementId);
  if (!settlement) throw new HttpError(404, "Resource not found", "NOT_FOUND");
  if (settlement.paidById !== actorId && !(await isGroupAdmin(groupId, actorId))) {
    throw new HttpError(403, "Not allowed to delete this settlement", "FORBIDDEN");
  }
  const before = snapshotSettlement(settlement);
  await deleteSettlementRecord(settlementId);
  await recordAuditLog({
    groupId,
    actorId,
    action: AuditAction.DELETED,
    resourceType: AuditResourceType.SETTLEMENT,
    resourceId: settlementId,
    before,
    after: null,
  });
};

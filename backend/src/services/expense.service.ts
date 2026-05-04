import { RecurInterval, SplitType } from "../entity/enums";
import { AuditAction, AuditResourceType } from "../entity/AuditLog";
import type { Expense } from "../entity/Expense";
import {
  createExpenseRecord,
  deleteExpense as deleteExpenseRecord,
  findExpenseDetail,
  listExpenses,
  replaceExpenseParticipants,
  saveExpense,
} from "../repositories/expense.repository";
import { findCategoryById } from "../repositories/category.repository";
import { findGroupMembersByIds } from "../repositories/group.repository";
import { findTagsByIds } from "../repositories/tag.repository";
import { HttpError } from "../utils/http-error";
import { buildPaginationMeta, type PaginationParams } from "../utils/pagination";
import { formatCents, isMoneyString, parseMoneyToCents } from "../utils/money";
import { isDateOnly } from "../utils/date";
import { isGroupAdmin, requireGroup, requireGroupMember } from "./group-access.service";
import { toExpenseResponse } from "./presenters";
import { sendEmailSafely } from "./email.service";
import { expenseCreatedEmail } from "./email-templates";
import {
  recordAuditLog,
  snapshotExpense,
} from "./audit-log.service";

export type ExpenseParticipantInput = {
  userId: string;
  shareAmount?: string;
  splitInput?: string;
};

export type ExpenseInput = {
  description: string;
  amount: string;
  paidById: string;
  date: string;
  categoryId: string | null;
  splitType: SplitType;
  participants: ExpenseParticipantInput[];
  tagIds: string[];
  notes: string | null;
  isRecurring: boolean;
  recurInterval: RecurInterval | null;
  recurAnchor: string | null;
};

type ComputedSplit = {
  userId: string;
  name: string;
  shareAmount: string;
  splitInput: string | null;
};

const assertDate = (field: string, value: string | null): void => {
  if (value !== null && !isDateOnly(value)) {
    throw new HttpError(400, "Validation failed", "VALIDATION_ERROR", {
      [field]: "Date must be in YYYY-MM-DD format",
    });
  }
};

const computeShares = (
  amountCents: number,
  splitType: SplitType,
  participants: { userId: string; name: string; shareAmount?: string; splitInput?: string }[],
): ComputedSplit[] => {
  if (participants.length === 0) {
    throw new HttpError(400, "Validation failed", "VALIDATION_ERROR", {
      participants: "At least one participant is required",
    });
  }

  if (splitType === SplitType.EQUAL) {
    let remaining = amountCents;
    return participants.map((participant, index) => {
      const shareCents =
        index === participants.length - 1 ? remaining : Math.round(amountCents / participants.length);
      remaining -= shareCents;
      return {
        userId: participant.userId,
        name: participant.name,
        shareAmount: formatCents(shareCents),
        splitInput: null,
      };
    });
  }

  if (splitType === SplitType.EXACT) {
    const splits = participants.map((participant) => {
      if (!isMoneyString(participant.shareAmount)) {
        throw new HttpError(400, "Validation failed", "VALIDATION_ERROR", {
          participants: "Exact splits require shareAmount with 2 decimals",
        });
      }
      return {
        userId: participant.userId,
        name: participant.name,
        shareAmount: participant.shareAmount,
        splitInput: participant.shareAmount,
      };
    });
    const total = splits.reduce((sum, split) => sum + parseMoneyToCents(split.shareAmount), 0);
    if (total !== amountCents) {
      throw new HttpError(422, "Split amounts must sum to total", "UNPROCESSABLE");
    }
    return splits;
  }

  const weights = participants.map((participant) => {
    const input = Number(participant.splitInput);
    if (!Number.isFinite(input) || input <= 0) {
      throw new HttpError(400, "Validation failed", "VALIDATION_ERROR", {
        participants: "Split input must be a positive number",
      });
    }
    if (splitType === SplitType.SHARES && !Number.isInteger(input)) {
      throw new HttpError(400, "Validation failed", "VALIDATION_ERROR", {
        participants: "Share split input must be a positive integer",
      });
    }
    return input;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (splitType === SplitType.PERCENTAGE && Math.round(totalWeight * 10000) !== 1000000) {
    throw new HttpError(422, "Percentage split must sum to 100", "UNPROCESSABLE");
  }
  let remaining = amountCents;
  return participants.map((participant, index) => {
    const shareCents =
      index === participants.length - 1 ? remaining : Math.round((amountCents * weights[index]) / totalWeight);
    remaining -= shareCents;
    return {
      userId: participant.userId,
      name: participant.name,
      shareAmount: formatCents(shareCents),
      splitInput: participant.splitInput ?? null,
    };
  });
};

export const previewExpense = async (
  groupId: string,
  userId: string,
  input: ExpenseInput,
): Promise<{ amount: string; splitType: SplitType; splits: ComputedSplit[] }> => {
  await requireGroupMember(groupId, userId);
  assertDate("date", input.date);
  assertDate("recurAnchor", input.recurAnchor);
  const amountCents = parseMoneyToCents(input.amount);
  if (amountCents <= 0 || !isMoneyString(input.amount)) {
    throw new HttpError(400, "Validation failed", "VALIDATION_ERROR", {
      amount: "Amount must be a positive string with 2 decimals",
    });
  }
  const ids = Array.from(new Set([input.paidById, ...input.participants.map((p) => p.userId)]));
  const members = await findGroupMembersByIds(groupId, ids);
  if (members.length !== ids.length) {
    throw new HttpError(422, "Participant not a group member", "UNPROCESSABLE");
  }
  const memberById = new Map(members.map((member) => [member.userId, member]));
  const splits = computeShares(
    amountCents,
    input.splitType,
    input.participants.map((participant) => ({
      ...participant,
      name: memberById.get(participant.userId)!.user.name,
    })),
  );
  return { amount: input.amount, splitType: input.splitType, splits };
};

const validateCategoryAndTags = async (groupId: string, input: ExpenseInput) => {
  if (input.categoryId) {
    const category = await findCategoryById(input.categoryId);
    if (!category || (category.groupId !== null && category.groupId !== groupId)) {
      throw new HttpError(404, "Resource not found", "NOT_FOUND");
    }
  }
  const tags = await findTagsByIds(input.tagIds);
  if (tags.length !== input.tagIds.length || tags.some((tag) => tag.groupId !== groupId)) {
    throw new HttpError(404, "Resource not found", "NOT_FOUND");
  }
  return tags;
};

const sendExpenseCreatedEmails = async (
  groupId: string,
  actorId: string,
  expense: Expense,
): Promise<void> => {
  const group = await requireGroup(groupId);
  const recipientById = new Map<
    string,
    {
      email: string;
      name: string;
      shareAmount: string;
    }
  >();

  for (const participant of expense.participants ?? []) {
    recipientById.set(participant.userId, {
      email: participant.user.email,
      name: participant.user.name,
      shareAmount: participant.shareAmount,
    });
  }

  if (!recipientById.has(expense.paidById)) {
    recipientById.set(expense.paidById, {
      email: expense.paidByUser.email,
      name: expense.paidByUser.name,
      shareAmount: "0.00",
    });
  }

  for (const [recipientId, recipient] of recipientById) {
    if (recipientId === actorId) {
      continue;
    }

    sendEmailSafely({
      to: recipient.email,
      ...expenseCreatedEmail({
        recipientName: recipient.name,
        groupName: group.name,
        description: expense.description,
        amount: expense.amount,
        paidByName: expense.paidByUser.name,
        date: expense.date,
        yourShare: recipient.shareAmount,
      }),
    });
  }
};

export const createExpense = async (groupId: string, userId: string, input: ExpenseInput) => {
  const preview = await previewExpense(groupId, userId, input);
  const tags = await validateCategoryAndTags(groupId, input);
  const expense = await createExpenseRecord({
    groupId,
    paidById: input.paidById,
    amount: input.amount,
    description: input.description,
    categoryId: input.categoryId,
    splitType: input.splitType,
    date: input.date,
    notes: input.notes,
    isRecurring: input.isRecurring,
    recurInterval: input.isRecurring ? input.recurInterval : null,
    recurAnchor: input.isRecurring ? input.recurAnchor : null,
    createdById: userId,
    tags,
  });
  await replaceExpenseParticipants(
    expense.id,
    preview.splits.map((split) => ({
      userId: split.userId,
      shareAmount: split.shareAmount,
      splitInput: split.splitInput,
    })),
  );
  const createdExpense = await findExpenseDetail(groupId, expense.id);

  if (createdExpense) {
    await recordAuditLog({
      groupId,
      actorId: userId,
      action: AuditAction.CREATED,
      resourceType: AuditResourceType.EXPENSE,
      resourceId: createdExpense.id,
      before: null,
      after: snapshotExpense(createdExpense),
    });
    await sendExpenseCreatedEmails(groupId, userId, createdExpense);
  }

  return getExpenseDetail(groupId, userId, expense.id);
};

export const getExpenseDetail = async (groupId: string, userId: string, expenseId: string) => {
  await requireGroupMember(groupId, userId);
  const expense = await findExpenseDetail(groupId, expenseId);
  if (!expense) throw new HttpError(404, "Resource not found", "NOT_FOUND");
  const myShare = expense.participants.find((participant) => participant.userId === userId)?.shareAmount ?? "0.00";
  return toExpenseResponse(expense, myShare, true);
};

export const getExpenses = async (
  groupId: string,
  userId: string,
  filters: Parameters<typeof listExpenses>[1],
  pagination: PaginationParams,
  sort: "date" | "amount" | "createdAt",
  order: "ASC" | "DESC",
) => {
  await requireGroupMember(groupId, userId);
  const [expenses, total] = await listExpenses(groupId, filters, pagination, sort, order);
  return {
    data: expenses.map((expense) =>
      toExpenseResponse(
        expense,
        expense.participants.find((participant) => participant.userId === userId)?.shareAmount ?? "0.00",
      ),
    ),
    meta: buildPaginationMeta(total, pagination.page, pagination.limit),
  };
};

export const updateExpense = async (
  groupId: string,
  userId: string,
  expenseId: string,
  input: ExpenseInput,
) => {
  const existing = await findExpenseDetail(groupId, expenseId);
  if (!existing) throw new HttpError(404, "Resource not found", "NOT_FOUND");
  if (existing.createdById !== userId && !(await isGroupAdmin(groupId, userId))) {
    throw new HttpError(403, "Not allowed to edit this expense", "FORBIDDEN");
  }
  const before = snapshotExpense(existing);
  const preview = await previewExpense(groupId, userId, input);
  const tags = await validateCategoryAndTags(groupId, input);
  Object.assign(existing, {
    paidById: input.paidById,
    amount: input.amount,
    description: input.description,
    categoryId: input.categoryId,
    splitType: input.splitType,
    date: input.date,
    notes: input.notes,
    isRecurring: input.isRecurring,
    recurInterval: input.isRecurring ? input.recurInterval : null,
    recurAnchor: input.isRecurring ? input.recurAnchor : null,
    tags,
  } satisfies Partial<Expense>);
  await saveExpense(existing);
  await replaceExpenseParticipants(
    expenseId,
    preview.splits.map((split) => ({
      userId: split.userId,
      shareAmount: split.shareAmount,
      splitInput: split.splitInput,
    })),
  );
  const updated = await findExpenseDetail(groupId, expenseId);
  if (updated) {
    await recordAuditLog({
      groupId,
      actorId: userId,
      action: AuditAction.UPDATED,
      resourceType: AuditResourceType.EXPENSE,
      resourceId: expenseId,
      before,
      after: snapshotExpense(updated),
    });
  }
  return getExpenseDetail(groupId, userId, expenseId);
};

export const deleteExpense = async (
  groupId: string,
  userId: string,
  expenseId: string,
): Promise<void> => {
  const expense = await findExpenseDetail(groupId, expenseId);
  if (!expense) throw new HttpError(404, "Resource not found", "NOT_FOUND");
  if (expense.createdById !== userId && !(await isGroupAdmin(groupId, userId))) {
    throw new HttpError(403, "Not allowed to delete this expense", "FORBIDDEN");
  }
  const before = snapshotExpense(expense);
  await deleteExpenseRecord(expenseId);
  await recordAuditLog({
    groupId,
    actorId: userId,
    action: AuditAction.DELETED,
    resourceType: AuditResourceType.EXPENSE,
    resourceId: expenseId,
    before,
    after: null,
  });
};

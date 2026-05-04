import type { Request, Response } from "express";

import { RecurInterval, SplitType } from "../entity/enums";
import {
  createExpense,
  deleteExpense,
  getExpenseDetail,
  getExpenses,
  previewExpense,
  updateExpense,
  type ExpenseInput,
} from "../services/expense.service";
import { isDateOnly } from "../utils/date";
import { validationError } from "../utils/http-error";
import { parsePagination } from "../utils/pagination";
import { getTrimmedString, isRecord } from "../utils/request";

const parseSplitType = (value: unknown): SplitType => {
  if (
    value === SplitType.EQUAL ||
    value === SplitType.EXACT ||
    value === SplitType.PERCENTAGE ||
    value === SplitType.SHARES
  ) {
    return value;
  }
  throw validationError({ splitType: "Invalid split type" });
};

const parseOptionalDate = (query: Record<string, unknown>, field: "from" | "to"): string | undefined => {
  if (query[field] === undefined) return undefined;
  if (typeof query[field] === "string" && isDateOnly(query[field])) return query[field];
  throw validationError({ [field]: "Date must be in YYYY-MM-DD format" });
};

const parseExpenseBody = (body: unknown): ExpenseInput => {
  if (!isRecord(body)) throw validationError({ body: "Request body must be an object" });
  const description = getTrimmedString(body, "description");
  if (!description) throw validationError({ description: "Description is required" });
  if (typeof body.amount !== "string") throw validationError({ amount: "Amount is required" });
  if (typeof body.paidById !== "string") throw validationError({ paidById: "Paid by is required" });
  if (typeof body.date !== "string" || !isDateOnly(body.date)) throw validationError({ date: "Date must be YYYY-MM-DD" });
  if (!Array.isArray(body.participants)) throw validationError({ participants: "Participants are required" });
  const isRecurring = body.isRecurring === true;
  const recurInterval = body.recurInterval ?? null;
  if (
    recurInterval !== null &&
    recurInterval !== RecurInterval.WEEKLY &&
    recurInterval !== RecurInterval.MONTHLY &&
    recurInterval !== RecurInterval.YEARLY
  ) {
    throw validationError({ recurInterval: "Invalid recurring interval" });
  }
  const recurAnchor = typeof body.recurAnchor === "string" ? body.recurAnchor : null;
  if (isRecurring && (!recurInterval || !recurAnchor || !isDateOnly(recurAnchor))) {
    throw validationError({ recurAnchor: "Recurring expenses require recurInterval and recurAnchor" });
  }
  const tagIds = Array.isArray(body.tagIds) ? body.tagIds : [];
  if (!tagIds.every((tagId) => typeof tagId === "string")) {
    throw validationError({ tagIds: "Tag IDs must be strings" });
  }
  return {
    description,
    amount: body.amount,
    paidById: body.paidById,
    date: body.date,
    categoryId: typeof body.categoryId === "string" ? body.categoryId : null,
    splitType: parseSplitType(body.splitType),
    participants: body.participants.map((participant) => {
      if (!isRecord(participant) || typeof participant.userId !== "string") {
        throw validationError({ participants: "Each participant requires userId" });
      }
      return {
        userId: participant.userId,
        shareAmount: typeof participant.shareAmount === "string" ? participant.shareAmount : undefined,
        splitInput: typeof participant.splitInput === "string" ? participant.splitInput : undefined,
      };
    }),
    tagIds,
    notes: typeof body.notes === "string" ? body.notes : null,
    isRecurring,
    recurInterval: isRecurring ? recurInterval : null,
    recurAnchor: isRecurring ? recurAnchor : null,
  };
};

const parseExpenseFilters = (req: Request) => ({
  categoryId: typeof req.query.categoryId === "string" ? req.query.categoryId : undefined,
  tagId: typeof req.query.tagId === "string" ? req.query.tagId : undefined,
  paidById: typeof req.query.paidById === "string" ? req.query.paidById : undefined,
  involvesId: typeof req.query.involvesId === "string" ? req.query.involvesId : undefined,
  splitType: req.query.splitType === undefined ? undefined : parseSplitType(req.query.splitType),
  from: parseOptionalDate(req.query, "from"),
  to: parseOptionalDate(req.query, "to"),
  q: typeof req.query.q === "string" ? req.query.q : undefined,
});

export const createExpenseHandler = async (req: Request, res: Response): Promise<void> => {
  res.status(201).json(await createExpense(req.params.groupId as string, req.auth!.user.id, parseExpenseBody(req.body)));
};

export const previewExpenseHandler = async (req: Request, res: Response): Promise<void> => {
  res.json(await previewExpense(req.params.groupId as string, req.auth!.user.id, parseExpenseBody(req.body)));
};

export const listExpensesHandler = async (req: Request, res: Response): Promise<void> => {
  const sort = req.query.sort === "amount" || req.query.sort === "createdAt" ? req.query.sort : "date";
  const order = req.query.order === "asc" ? "ASC" : "DESC";
  res.json(
    await getExpenses(
      req.params.groupId as string,
      req.auth!.user.id,
      parseExpenseFilters(req),
      parsePagination(req.query),
      sort,
      order,
    ),
  );
};

export const getExpenseHandler = async (req: Request, res: Response): Promise<void> => {
  res.json(await getExpenseDetail(req.params.groupId as string, req.auth!.user.id, req.params.expenseId as string));
};

export const updateExpenseHandler = async (req: Request, res: Response): Promise<void> => {
  res.json(await updateExpense(req.params.groupId as string, req.auth!.user.id, req.params.expenseId as string, parseExpenseBody(req.body)));
};

export const deleteExpenseHandler = async (req: Request, res: Response): Promise<void> => {
  await deleteExpense(req.params.groupId as string, req.auth!.user.id, req.params.expenseId as string);
  res.status(204).send();
};

export const listRecurringExpensesHandler = async (req: Request, res: Response): Promise<void> => {
  res.json(
    await getExpenses(
      req.params.groupId as string,
      req.auth!.user.id,
      { ...parseExpenseFilters(req), isRecurring: true },
      parsePagination(req.query),
      "date",
      "DESC",
    ),
  );
};

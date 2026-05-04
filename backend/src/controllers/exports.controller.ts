import type { Request, Response } from "express";

import { SplitType } from "../entity/enums";
import {
  exportGroupAnalyticsCsv,
  exportGroupExpensesCsv,
  exportGroupSettlementsCsv,
  exportUserAnalyticsCsv,
  exportUserBalancesCsv,
} from "../services/export.service";
import { getCurrentMonthDateRange, isDateOnly } from "../utils/date";
import { validationError } from "../utils/http-error";
import { sendCsv } from "../utils/csv";

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

const parsePeriod = (req: Request): { from: string; to: string } => {
  const defaults = getCurrentMonthDateRange();
  const from = req.query.from ?? defaults.from;
  const to = req.query.to ?? defaults.to;

  if (typeof from !== "string" || !isDateOnly(from)) {
    throw validationError({ from: "Date must be YYYY-MM-DD" });
  }

  if (typeof to !== "string" || !isDateOnly(to)) {
    throw validationError({ to: "Date must be YYYY-MM-DD" });
  }

  return { from, to };
};

const parseDateQuery = (value: unknown, field: "from" | "to"): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === "string" && isDateOnly(value)) return value;
  throw validationError({ [field]: "Date must be in YYYY-MM-DD format" });
};

const parseSettlementFilters = (req: Request) => ({
  userId: typeof req.query.userId === "string" ? req.query.userId : undefined,
  from: parseDateQuery(req.query.from, "from"),
  to: parseDateQuery(req.query.to, "to"),
});

const parseUserAnalyticsPeriod = (req: Request): { from: string; to: string } => {
  const defaultPeriod = getCurrentMonthDateRange();
  const from =
    req.query.from === undefined
      ? defaultPeriod.from
      : typeof req.query.from === "string" && isDateOnly(req.query.from)
        ? req.query.from
        : null;
  const to =
    req.query.to === undefined
      ? defaultPeriod.to
      : typeof req.query.to === "string" && isDateOnly(req.query.to)
        ? req.query.to
        : null;

  if (from === null) {
    throw validationError({ from: "Date must be in YYYY-MM-DD format" });
  }
  if (to === null) {
    throw validationError({ to: "Date must be in YYYY-MM-DD format" });
  }
  if (from > to) {
    throw validationError({ from: "From date must be before or equal to to date" });
  }
  return { from, to };
};

export const exportGroupExpensesHandler = async (req: Request, res: Response): Promise<void> => {
  const sort = req.query.sort === "amount" || req.query.sort === "createdAt" ? req.query.sort : "date";
  const order = req.query.order === "asc" ? "ASC" : "DESC";
  const { filename, csv } = await exportGroupExpensesCsv(
    req.params.groupId as string,
    req.auth!.user.id,
    parseExpenseFilters(req),
    sort,
    order,
  );
  sendCsv(res, filename, csv);
};

export const exportGroupSettlementsHandler = async (req: Request, res: Response): Promise<void> => {
  const { filename, csv } = await exportGroupSettlementsCsv(
    req.params.groupId as string,
    req.auth!.user.id,
    parseSettlementFilters(req),
    req.query.sort === "amount" ? "amount" : "date",
    req.query.order === "asc" ? "ASC" : "DESC",
  );
  sendCsv(res, filename, csv);
};

export const exportGroupAnalyticsHandler = async (req: Request, res: Response): Promise<void> => {
  const { filename, csv } = await exportGroupAnalyticsCsv(
    req.params.groupId as string,
    req.auth!.user.id,
    parsePeriod(req),
  );
  sendCsv(res, filename, csv);
};

export const exportUserAnalyticsHandler = async (req: Request, res: Response): Promise<void> => {
  const { filename, csv } = await exportUserAnalyticsCsv(req.auth!.user.id, parseUserAnalyticsPeriod(req));
  sendCsv(res, filename, csv);
};

export const exportUserBalancesHandler = async (req: Request, res: Response): Promise<void> => {
  const { filename, csv } = await exportUserBalancesCsv(req.auth!.user.id);
  sendCsv(res, filename, csv);
};

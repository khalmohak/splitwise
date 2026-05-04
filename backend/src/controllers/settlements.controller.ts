import type { Request, Response } from "express";

import {
  createSettlement,
  deleteSettlement,
  getGroupSettlementSuggestions,
  getSettlements,
  recordSuggestedSettlement,
  settleWithUser,
  type SuggestedSettlementInput,
  type SettlementInput,
} from "../services/settlement.service";
import { isDateOnly } from "../utils/date";
import { validationError } from "../utils/http-error";
import { parsePagination } from "../utils/pagination";
import { isRecord } from "../utils/request";

const parseSettlementBody = (body: unknown): SettlementInput => {
  if (!isRecord(body)) throw validationError({ body: "Request body must be an object" });
  if (typeof body.paidById !== "string") throw validationError({ paidById: "Paid by is required" });
  if (typeof body.paidToId !== "string") throw validationError({ paidToId: "Paid to is required" });
  if (typeof body.amount !== "string") throw validationError({ amount: "Amount is required" });
  if (typeof body.date !== "string" || !isDateOnly(body.date)) {
    throw validationError({ date: "Date must be in YYYY-MM-DD format" });
  }
  return {
    paidById: body.paidById,
    paidToId: body.paidToId,
    amount: body.amount,
    date: body.date,
    notes: typeof body.notes === "string" ? body.notes : null,
  };
};

const parseSuggestedSettlementBody = (body: unknown): SuggestedSettlementInput => {
  if (!isRecord(body)) throw validationError({ body: "Request body must be an object" });
  if (typeof body.paidById !== "string") throw validationError({ paidById: "Paid by is required" });
  if (typeof body.paidToId !== "string") throw validationError({ paidToId: "Paid to is required" });
  if (body.amount !== undefined && typeof body.amount !== "string") {
    throw validationError({ amount: "Amount must be a money string" });
  }
  if (body.date !== undefined && (typeof body.date !== "string" || !isDateOnly(body.date))) {
    throw validationError({ date: "Date must be in YYYY-MM-DD format" });
  }

  return {
    paidById: body.paidById,
    paidToId: body.paidToId,
    amount: typeof body.amount === "string" ? body.amount : undefined,
    date: typeof body.date === "string" ? body.date : undefined,
    notes: typeof body.notes === "string" ? body.notes : null,
  };
};

const parseDateQuery = (value: unknown, field: "from" | "to"): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === "string" && isDateOnly(value)) return value;
  throw validationError({ [field]: "Date must be in YYYY-MM-DD format" });
};

const shouldIncludeSuggestions = (req: Request): boolean =>
  req.query.includeSuggestions === "true" || req.query.include === "suggestions";

export const createSettlementHandler = async (req: Request, res: Response): Promise<void> => {
  const groupId = req.params.groupId as string;
  const settlement = await createSettlement(groupId, req.auth!.user.id, parseSettlementBody(req.body));

  if (shouldIncludeSuggestions(req)) {
    res.status(201).json({
      settlement,
      settlementSuggestions: await getGroupSettlementSuggestions(groupId, req.auth!.user.id),
    });
    return;
  }

  res.status(201).json(settlement);
};

export const settleWithUserHandler = async (req: Request, res: Response): Promise<void> => {
  const groupId = req.params.groupId as string;
  const settlement = await settleWithUser(groupId, req.auth!.user.id, req.params.userId as string);

  if (shouldIncludeSuggestions(req)) {
    res.status(201).json({
      settlement,
      settlementSuggestions: await getGroupSettlementSuggestions(groupId, req.auth!.user.id),
    });
    return;
  }

  res.status(201).json(settlement);
};

export const groupSettlementSuggestionsHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.set("Cache-Control", "no-store");
  res.json(
    await getGroupSettlementSuggestions(
      req.params.groupId as string,
      req.auth!.user.id,
    ),
  );
};

export const recordSuggestedSettlementHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.status(201).json(
    await recordSuggestedSettlement(
      req.params.groupId as string,
      req.auth!.user.id,
      parseSuggestedSettlementBody(req.body),
    ),
  );
};

export const listSettlementsHandler = async (req: Request, res: Response): Promise<void> => {
  res.json(
    await getSettlements(
      req.params.groupId as string,
      req.auth!.user.id,
      {
        userId: typeof req.query.userId === "string" ? req.query.userId : undefined,
        from: parseDateQuery(req.query.from, "from"),
        to: parseDateQuery(req.query.to, "to"),
      },
      parsePagination(req.query),
      req.query.sort === "amount" ? "amount" : "date",
      req.query.order === "asc" ? "ASC" : "DESC",
    ),
  );
};

export const deleteSettlementHandler = async (req: Request, res: Response): Promise<void> => {
  await deleteSettlement(req.params.groupId as string, req.auth!.user.id, req.params.settlementId as string);
  res.status(204).send();
};

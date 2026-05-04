import type { Request, Response } from "express";

import {
  deleteGroupBudget,
  getGroupBudgets,
  upsertGroupBudget,
  type BudgetInput,
} from "../services/budget.service";
import { validationError } from "../utils/http-error";
import { isRecord } from "../utils/request";

const isMonth = (value: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

const parseBudgetBody = (body: unknown): BudgetInput => {
  if (!isRecord(body)) throw validationError({ body: "Request body must be an object" });
  if (typeof body.month !== "string" || !isMonth(body.month)) {
    throw validationError({ month: "Month must be YYYY-MM" });
  }
  if (typeof body.amount !== "string") {
    throw validationError({ amount: "Amount is required" });
  }

  return {
    month: body.month,
    categoryId: typeof body.categoryId === "string" ? body.categoryId : null,
    amount: body.amount,
  };
};

export const listGroupBudgetsHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const month = typeof req.query.month === "string" ? req.query.month : undefined;
  res.json(await getGroupBudgets(req.params.groupId as string, req.auth!.user.id, month));
};

export const upsertGroupBudgetHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(
    await upsertGroupBudget(
      req.params.groupId as string,
      req.auth!.user.id,
      parseBudgetBody(req.body),
    ),
  );
};

export const deleteGroupBudgetHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  await deleteGroupBudget(
    req.params.groupId as string,
    req.auth!.user.id,
    req.params.budgetId as string,
  );
  res.status(204).send();
};

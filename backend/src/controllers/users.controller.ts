import type { Request, Response } from "express";

import { GroupType } from "../entity/enums";
import { getAuthenticatedUser } from "../middleware/auth";
import { listAllUsersBasic } from "../repositories/user.repository";
import {
  getUserAnalytics,
  getUserAnalyticsTrends,
  getUserBalances,
  getUserProfile,
  updateUserProfile,
} from "../services/user.service";
import { getUserSettlementSuggestions } from "../services/settlement.service";
import { getCurrentMonthDateRange, isDateOnly } from "../utils/date";
import { validationError } from "../utils/http-error";
import { getTrimmedString, isRecord } from "../utils/request";

const parseGroupTypeQuery = (value: unknown): GroupType | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === GroupType.HOUSEHOLD || value === GroupType.PERSONAL) {
    return value;
  }

  throw validationError({
    type: "Type must be household or personal",
  });
};

const parseDateQuery = (
  value: unknown,
  fallback: string,
  field: "from" | "to",
): string => {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === "string" && isDateOnly(value)) {
    return value;
  }

  throw validationError({
    [field]: "Date must be in YYYY-MM-DD format",
  });
};

const parseGrain = (value: unknown): "day" | "week" | "month" => {
  if (value === undefined) return "month";
  if (value === "day" || value === "week" || value === "month") return value;
  throw validationError({ by: "Must be day, week, or month" });
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  res.json(getUserProfile(getAuthenticatedUser(req)));
};

export const updateMe = async (req: Request, res: Response): Promise<void> => {
  if (!isRecord(req.body)) {
    throw validationError({ body: "Request body must be an object" });
  }

  const details: Record<string, string> = {};
  const input: {
    name?: string;
    avatarUrl?: string | null;
  } = {};

  if ("name" in req.body) {
    const name = getTrimmedString(req.body, "name");

    if (!name) {
      details.name = "Name must be a non-empty string";
    } else {
      input.name = name;
    }
  }

  if ("avatarUrl" in req.body) {
    if (req.body.avatarUrl === null) {
      input.avatarUrl = null;
    } else if (typeof req.body.avatarUrl === "string") {
      input.avatarUrl = req.body.avatarUrl.trim() || null;
    } else {
      details.avatarUrl = "Avatar URL must be a string or null";
    }
  }

  if (Object.keys(details).length > 0) {
    throw validationError(details);
  }

  res.json(await updateUserProfile(getAuthenticatedUser(req), input));
};

export const getMyBalances = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const type = parseGroupTypeQuery(req.query.type);

  res.json(await getUserBalances(getAuthenticatedUser(req).id, type));
};

export const getMySettlementSuggestions = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const type = parseGroupTypeQuery(req.query.type);

  res.set("Cache-Control", "no-store");
  res.json(await getUserSettlementSuggestions(getAuthenticatedUser(req).id, type));
};

export const getMyAnalytics = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const defaultPeriod = getCurrentMonthDateRange();
  const from = parseDateQuery(req.query.from, defaultPeriod.from, "from");
  const to = parseDateQuery(req.query.to, defaultPeriod.to, "to");

  if (from > to) {
    throw validationError({
      from: "From date must be before or equal to to date",
    });
  }

  res.json(await getUserAnalytics(getAuthenticatedUser(req).id, { from, to }));
};

export const getMyAnalyticsTrends = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const defaultPeriod = getCurrentMonthDateRange();
  const from = parseDateQuery(req.query.from, defaultPeriod.from, "from");
  const to = parseDateQuery(req.query.to, defaultPeriod.to, "to");

  if (from > to) {
    throw validationError({
      from: "From date must be before or equal to to date",
    });
  }

  res.json(
    await getUserAnalyticsTrends(getAuthenticatedUser(req).id, {
      from,
      to,
      by: parseGrain(req.query.by),
      type: parseGroupTypeQuery(req.query.type),
    }),
  );
};

export const listUsers = async (req: Request, res: Response): Promise<void> => {
  getAuthenticatedUser(req);
  res.json(
    (await listAllUsersBasic()).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatar_url,
    })),
  );
};

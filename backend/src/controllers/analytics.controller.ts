import type { Request, Response } from "express";

import {
  getGroupAnalyticsAnomalies,
  getGroupAnalyticsCategories,
  getGroupAnalyticsCategoryTrends,
  getGroupAnalyticsComparison,
  getGroupAnalyticsMembers,
  getGroupAnalyticsMemberTrends,
  getGroupAnalyticsPatterns,
  getGroupAnalyticsSummary,
  getGroupAnalyticsTags,
  getGroupAnalyticsTrends,
} from "../services/analytics.service";
import { getCurrentMonthDateRange, isDateOnly } from "../utils/date";
import { validationError } from "../utils/http-error";

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

  if (from > to) {
    throw validationError({ from: "From date must be before or equal to to date" });
  }

  return { from, to };
};

const parseGrain = (value: unknown): "day" | "week" | "month" => {
  if (value === "day" || value === "week" || value === "month") return value;
  if (value === undefined) return "month";
  throw validationError({ by: "Must be day, week, or month" });
};

export const groupAnalyticsSummaryHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(
    await getGroupAnalyticsSummary(
      req.params.groupId as string,
      req.auth!.user.id,
      parsePeriod(req),
    ),
  );
};

export const groupAnalyticsTrendsHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(
    await getGroupAnalyticsTrends(req.params.groupId as string, req.auth!.user.id, {
      ...parsePeriod(req),
      by: parseGrain(req.query.by),
      categoryId: typeof req.query.categoryId === "string" ? req.query.categoryId : undefined,
      memberId: typeof req.query.memberId === "string" ? req.query.memberId : undefined,
    }),
  );
};

export const groupAnalyticsComparisonHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(
    await getGroupAnalyticsComparison(
      req.params.groupId as string,
      req.auth!.user.id,
      parsePeriod(req),
    ),
  );
};

export const groupAnalyticsCategoriesHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(
    await getGroupAnalyticsCategories(
      req.params.groupId as string,
      req.auth!.user.id,
      parsePeriod(req),
    ),
  );
};

export const groupAnalyticsMembersHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(
    await getGroupAnalyticsMembers(
      req.params.groupId as string,
      req.auth!.user.id,
      parsePeriod(req),
    ),
  );
};

export const groupAnalyticsTagsHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(
    await getGroupAnalyticsTags(
      req.params.groupId as string,
      req.auth!.user.id,
      parsePeriod(req),
    ),
  );
};

export const groupAnalyticsCategoryTrendsHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(
    await getGroupAnalyticsCategoryTrends(req.params.groupId as string, req.auth!.user.id, {
      ...parsePeriod(req),
      by: parseGrain(req.query.by),
    }),
  );
};

export const groupAnalyticsMemberTrendsHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(
    await getGroupAnalyticsMemberTrends(req.params.groupId as string, req.auth!.user.id, {
      ...parsePeriod(req),
      by: parseGrain(req.query.by),
    }),
  );
};

export const groupAnalyticsPatternsHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(
    await getGroupAnalyticsPatterns(
      req.params.groupId as string,
      req.auth!.user.id,
      parsePeriod(req),
    ),
  );
};

export const groupAnalyticsAnomaliesHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(
    await getGroupAnalyticsAnomalies(
      req.params.groupId as string,
      req.auth!.user.id,
      parsePeriod(req),
    ),
  );
};

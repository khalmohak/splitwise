import type { Context } from "hono";
import { validationError } from "./errors.js";

export type PaginationParams = { page: number; limit: number };
export type PaginationMeta = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

const MAX_LIMIT = 100;

export function parsePagination(c: Context): PaginationParams {
  const pageRaw = c.req.query("page");
  const limitRaw = c.req.query("limit");
  const errors: Record<string, string> = {};

  const page = pageRaw === undefined ? 1 : parsePositiveInt(pageRaw);
  if (page === null) errors.page = "Must be a positive integer";

  const limit = limitRaw === undefined ? 20 : parsePositiveInt(limitRaw);
  if (limit === null) errors.limit = "Must be a positive integer";

  if (Object.keys(errors).length) throw validationError(errors);

  return {
    page: page!,
    limit: Math.min(limit!, MAX_LIMIT),
  };
}

export function buildPaginationMeta(
  total: number,
  page: number,
  limit: number,
): PaginationMeta {
  return { total, page, limit, totalPages: Math.ceil(total / Math.max(limit, 1)) };
}

function parsePositiveInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

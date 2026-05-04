import { validationError } from "./http-error";

export type PaginationParams = {
  page: number;
  limit: number;
  skip: number;
};

const parsePositiveInteger = (
  value: unknown,
  fallback: number,
  field: string,
): number => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw validationError({ [field]: "Must be a positive integer" });
  }

  return parsed;
};

export const parsePagination = (query: Record<string, unknown>): PaginationParams => {
  const page = parsePositiveInteger(query.page, 1, "page");
  const limit = Math.min(parsePositiveInteger(query.limit, 20, "limit"), 100);

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

export const buildPaginationMeta = (
  total: number,
  page: number,
  limit: number,
): {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
} => ({
  total,
  page,
  limit,
  totalPages: Math.ceil(total / limit),
});

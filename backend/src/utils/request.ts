export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const getTrimmedString = (
  body: Record<string, unknown>,
  field: string,
): string | undefined => {
  const value = body[field];

  return typeof value === "string" ? value.trim() : undefined;
};

export const normalizeEmail = (email: string): string => email.toLowerCase();

import { z } from "zod";

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isRootRelativeUrl(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

export const relativeOrAbsoluteUrlSchema = z
  .string()
  .trim()
  .refine((value) => isAbsoluteUrl(value) || isRootRelativeUrl(value), {
    message: "Invalid url",
  });

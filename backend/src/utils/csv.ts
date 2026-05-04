import type { Response } from "express";

export const escapeCsvField = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

export const buildCsv = (rows: (string | number | null | undefined)[][]): string => {
  const lines = rows.map((row) => row.map((cell) => escapeCsvField(cell)).join(","));
  return `\uFEFF${lines.join("\r\n")}`;
};

export const sendCsv = (res: Response, filename: string, csv: string): void => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
};

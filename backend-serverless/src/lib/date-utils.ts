const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_ONLY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isMonthString(value: unknown): value is string {
  if (typeof value !== "string" || !MONTH_RE.test(value)) return false;
  const [y, m] = value.split("-").map(Number);
  return y! > 1900 && m! >= 1 && m! <= 12;
}

export function getCurrentMonthDateRange(now = new Date()): { from: string; to: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export function shiftMonths(month: string, delta: number): string {
  if (!isMonthString(month)) throw new Error(`bad month: ${month}`);
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthOfDate(dateOnly: string): string {
  return dateOnly.slice(0, 7);
}

export function addInterval(
  dateOnly: string,
  interval: "weekly" | "monthly" | "yearly",
): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  switch (interval) {
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case "yearly":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }
  return d.toISOString().slice(0, 10);
}

export function dateRangeKey(d: string, by: "day" | "week" | "month"): string {
  switch (by) {
    case "day":
      return d;
    case "month":
      return d.slice(0, 7);
    case "week": {
      const dt = new Date(`${d}T00:00:00Z`);
      // Anchor to Monday for ISO-ish weeks.
      const day = dt.getUTCDay() || 7;
      dt.setUTCDate(dt.getUTCDate() - (day - 1));
      return dt.toISOString().slice(0, 10);
    }
  }
}

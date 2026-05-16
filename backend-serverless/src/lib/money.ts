// Money is always a decimal string with exactly 2 decimal places (e.g. "12.34").
// Internally we operate in integer cents to avoid floating-point drift across
// splits and sums.

const MONEY_RE = /^\d+(\.\d{2})?$/;

export function isMoneyString(value: unknown): value is string {
  return typeof value === "string" && MONEY_RE.test(value);
}

export function parseMoneyToCents(value: string): number {
  if (!isMoneyString(value)) {
    throw new Error(`invalid money string: ${String(value)}`);
  }
  const [whole, frac = "00"] = value.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isFinite(cents) || cents < 0) {
    throw new Error(`invalid money: ${value}`);
  }
  return cents;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${String(frac).padStart(2, "0")}`;
}

export function addMoney(a: string, b: string): string {
  return formatCents(parseMoneyToCents(a) + parseMoneyToCents(b));
}

export function sumMoney(values: string[]): string {
  return formatCents(values.reduce((acc, v) => acc + parseMoneyToCents(v), 0));
}

// Splits `total` into N equal parts, distributing the remainder cent-by-cent
// from the start. Returns 2-decimal money strings that sum exactly to `total`.
export function splitEqual(total: string, n: number): string[] {
  if (n <= 0) throw new Error("splitEqual: n must be positive");
  const totalCents = parseMoneyToCents(total);
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(formatCents(base + (i < remainder ? 1 : 0)));
  }
  return out;
}

// Splits `total` proportionally by the given numeric weights (e.g. percent or
// share counts). Rounds each share to the nearest cent, then sweeps any
// remaining cents into the largest weights to keep the sum exact.
export function splitByWeights(total: string, weights: number[]): string[] {
  if (weights.length === 0) throw new Error("splitByWeights: no weights");
  const totalCents = parseMoneyToCents(total);
  const sumW = weights.reduce((a, w) => a + w, 0);
  if (sumW <= 0) throw new Error("splitByWeights: weight sum must be > 0");

  const raw = weights.map((w) => (totalCents * w) / sumW);
  const floors = raw.map((r) => Math.floor(r));
  let allocated = floors.reduce((a, b) => a + b, 0);
  let remainder = totalCents - allocated;
  // Distribute leftover cents to entries with the largest fractional remainder.
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  let idx = 0;
  while (remainder > 0 && idx < order.length) {
    floors[order[idx]!.i]! += 1;
    remainder -= 1;
    idx += 1;
  }
  return floors.map(formatCents);
}

export function moneyEq(a: string, b: string): boolean {
  return parseMoneyToCents(a) === parseMoneyToCents(b);
}

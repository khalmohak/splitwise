export const parseMoneyToCents = (amount: string | number | null): number => {
  if (amount === null) {
    return 0;
  }

  const value = typeof amount === "number" ? amount.toFixed(2) : amount;
  const sign = value.startsWith("-") ? -1 : 1;
  const normalized = value.replace("-", "");
  const [whole = "0", fraction = "0"] = normalized.split(".");
  const cents = Number(`${whole}${fraction.padEnd(2, "0").slice(0, 2)}`);

  return sign * cents;
};

export const formatCents = (cents: number): string => {
  const sign = cents < 0 ? "-" : "";
  const absoluteCents = Math.abs(cents);
  const whole = Math.floor(absoluteCents / 100);
  const fraction = String(absoluteCents % 100).padStart(2, "0");

  return `${sign}${whole}.${fraction}`;
};

export const isMoneyString = (value: unknown): value is string =>
  typeof value === "string" && /^\d+(\.\d{2})$/.test(value);

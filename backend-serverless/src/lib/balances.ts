// Balance computation. The single source of truth for "who owes whom" in a
// group. Used by /balances, /balances/me, /balances/simplified, the
// settle-with flow, dashboard, group-list yourBalance, and analytics.

import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { formatCents } from "./money.js";

export type UserNet = { userId: string; net: number }; // cents
export type PairwiseEdge = { fromId: string; toId: string; cents: number }; // from owes to

// drizzle-orm/neon-http wraps results in { rows, fields, rowCount, ... }.
// Older drivers (and `neon()` direct) return plain arrays. Cover both so we
// don't depend on a specific drizzle version.
function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

// Cents-typed map keyed by userId. Used internally — callers usually want
// formatted money strings.
export async function computeUserNetCents(groupId: string): Promise<Map<string, number>> {
  // Disputed settlements are excluded — they revert to "not settled" until
  // resolved. Pending settlements DO reduce balances; the reference auto-
  // confirms when the receiver records and otherwise the payer must wait.
  const result = await db.execute(sql`
    SELECT user_id::text AS user_id, SUM(net_cents)::bigint AS net
    FROM (
      SELECT paid_by AS user_id, (amount * 100)::bigint AS net_cents
      FROM expenses WHERE group_id = ${groupId}
      UNION ALL
      SELECT ep.user_id, -(ep.share_amount * 100)::bigint AS net_cents
      FROM expense_participants ep
      JOIN expenses e ON e.id = ep.expense_id
      WHERE e.group_id = ${groupId}
      UNION ALL
      SELECT paid_by AS user_id, (amount * 100)::bigint AS net_cents
      FROM settlements
      WHERE group_id = ${groupId} AND status <> 'disputed'
      UNION ALL
      SELECT paid_to AS user_id, -(amount * 100)::bigint AS net_cents
      FROM settlements
      WHERE group_id = ${groupId} AND status <> 'disputed'
    ) t
    GROUP BY user_id
  `);
  const rows = extractRows<{ user_id: string; net: string | number }>(result);

  const out = new Map<string, number>();
  for (const r of rows) {
    const n = typeof r.net === "string" ? Number(r.net) : r.net;
    if (n !== 0) out.set(r.user_id, n);
  }
  return out;
}

// Pairwise edges: A owes B X cents (X > 0). Only positive edges returned.
// Sums expense-participant obligations and settlement reductions.
export async function computePairwiseCents(groupId: string): Promise<PairwiseEdge[]> {
  // For each unordered pair {a,b} where a<b, accumulate:
  //   + when participant=a, payer=b → a owes b  (+ a→b)
  //   - when participant=b, payer=a → b owes a  (− a→b)
  //   - settlement a→b paid       (a paid b)    (− a→b debt = +b→a; we model
  //                                              by subtracting from a→b net)
  //   + settlement b→a paid                    (+ a→b)
  const result = await db.execute(sql`
    WITH pairs AS (
      SELECT
        LEAST(ep.user_id::text, e.paid_by::text) AS a,
        GREATEST(ep.user_id::text, e.paid_by::text) AS b,
        CASE WHEN ep.user_id::text < e.paid_by::text THEN 1 ELSE -1 END
          * (ep.share_amount * 100)::bigint AS cents
      FROM expense_participants ep
      JOIN expenses e ON e.id = ep.expense_id
      WHERE e.group_id = ${groupId} AND ep.user_id <> e.paid_by

      UNION ALL

      SELECT
        LEAST(s.paid_by::text, s.paid_to::text) AS a,
        GREATEST(s.paid_by::text, s.paid_to::text) AS b,
        CASE WHEN s.paid_by::text < s.paid_to::text THEN -1 ELSE 1 END
          * (s.amount * 100)::bigint AS cents
      FROM settlements s
      WHERE s.group_id = ${groupId} AND s.status <> 'disputed'
    )
    SELECT a, b, SUM(cents)::bigint AS net FROM pairs GROUP BY a, b
  `);
  const rows = extractRows<{ a: string; b: string; net: string | number }>(result);

  const edges: PairwiseEdge[] = [];
  for (const r of rows) {
    const n = typeof r.net === "string" ? Number(r.net) : r.net;
    if (n === 0) continue;
    if (n > 0) edges.push({ fromId: r.a, toId: r.b, cents: n });
    else edges.push({ fromId: r.b, toId: r.a, cents: -n });
  }
  return edges;
}

// Greedy debtor/creditor matcher. Given per-user nets (positive=is owed,
// negative=owes), produces minimal transfers that zero everyone out.
export function simplifyTransfers(nets: Map<string, number>): PairwiseEdge[] {
  const debtors: Array<{ id: string; cents: number }> = [];
  const creditors: Array<{ id: string; cents: number }> = [];
  for (const [id, n] of nets) {
    if (n > 0) creditors.push({ id, cents: n });
    else if (n < 0) debtors.push({ id, cents: -n });
  }
  // Stable-largest-first ordering reduces total transfer count in practice.
  debtors.sort((a, b) => b.cents - a.cents);
  creditors.sort((a, b) => b.cents - a.cents);

  const edges: PairwiseEdge[] = [];
  let di = 0;
  let ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const d = debtors[di]!;
    const c = creditors[ci]!;
    const amt = Math.min(d.cents, c.cents);
    if (amt > 0) edges.push({ fromId: d.id, toId: c.id, cents: amt });
    d.cents -= amt;
    c.cents -= amt;
    if (d.cents === 0) di += 1;
    if (c.cents === 0) ci += 1;
  }
  return edges;
}

export function centsToMoney(cents: number): string {
  return formatCents(cents);
}

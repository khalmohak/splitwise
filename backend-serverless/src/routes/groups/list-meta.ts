// Helpers used by GET /api/groups to enrich each row with the caller's
// balance and the group's lastActivityAt.

import { inArray, max } from "drizzle-orm";
import { db } from "../../db/client.js";
import { expenses } from "../../db/schema/expenses.js";
import { settlements } from "../../db/schema/settlements.js";

export async function lastActivityForGroups(
  groupIds: string[],
): Promise<Map<string, Date | null>> {
  if (groupIds.length === 0) return new Map();

  const [eRows, sRows] = await Promise.all([
    db
      .select({ groupId: expenses.groupId, ts: max(expenses.createdAt) })
      .from(expenses)
      .where(inArray(expenses.groupId, groupIds))
      .groupBy(expenses.groupId),
    db
      .select({ groupId: settlements.groupId, ts: max(settlements.createdAt) })
      .from(settlements)
      .where(inArray(settlements.groupId, groupIds))
      .groupBy(settlements.groupId),
  ]);

  const out = new Map<string, Date | null>();
  for (const g of groupIds) out.set(g, null);
  for (const r of [...eRows, ...sRows]) {
    if (!r.ts) continue;
    const ts = r.ts instanceof Date ? r.ts : new Date(r.ts as unknown as string);
    const cur = out.get(r.groupId);
    if (!cur || ts > cur) out.set(r.groupId, ts);
  }
  return out;
}

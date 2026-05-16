import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users } from "../../db/schema/users.js";
import { type AuthVariables } from "../../lib/auth.js";
import { requireGroupMember } from "../../lib/guards.js";
import {
  centsToMoney,
  computePairwiseCents,
  computeUserNetCents,
  simplifyTransfers,
} from "../../lib/balances.js";
import { toUserMini } from "../../lib/presenters.js";

export const groupBalances = new Hono<{ Variables: AuthVariables }>();

async function loadUsers(ids: string[]) {
  if (ids.length === 0) return new Map<string, typeof users.$inferSelect>();
  const rows = await db.select().from(users).where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

// GET /balances/simplified — minimal transfer set (greedy debtor↔creditor).
groupBalances.get("/simplified", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const nets = await computeUserNetCents(groupId);
  const edges = simplifyTransfers(nets);
  const userById = await loadUsers(
    Array.from(new Set(edges.flatMap((e) => [e.fromId, e.toId]))),
  );

  return c.json({
    asOf: new Date().toISOString(),
    balances: edges.map((e) => ({
      from: toUserMini(userById.get(e.fromId)!),
      to: toUserMini(userById.get(e.toId)!),
      amount: centsToMoney(e.cents),
    })),
  });
});

// GET /balances — raw pairwise (non-simplified) view.
groupBalances.get("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const edges = await computePairwiseCents(groupId);
  const userById = await loadUsers(
    Array.from(new Set(edges.flatMap((e) => [e.fromId, e.toId]))),
  );

  return c.json({
    asOf: new Date().toISOString(),
    balances: edges.map((e) => ({
      from: toUserMini(userById.get(e.fromId)!),
      to: toUserMini(userById.get(e.toId)!),
      amount: centsToMoney(e.cents),
    })),
  });
});

// GET /balances/me — what I owe / am owed in this group.
groupBalances.get("/me", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const edges = await computePairwiseCents(groupId);
  const myEdges = edges.filter((e) => e.fromId === actor.id || e.toId === actor.id);
  const others = Array.from(
    new Set(myEdges.map((e) => (e.fromId === actor.id ? e.toId : e.fromId))),
  );
  const userById = await loadUsers(others);

  let youAreOwed = 0;
  let youOwe = 0;
  const detail = others.map((otherId) => {
    let owedToYou = 0;
    let youOweThem = 0;
    for (const e of myEdges) {
      if (e.fromId === actor.id && e.toId === otherId) youOweThem += e.cents;
      else if (e.toId === actor.id && e.fromId === otherId) owedToYou += e.cents;
    }
    youAreOwed += owedToYou;
    youOwe += youOweThem;
    return {
      user: toUserMini(userById.get(otherId)!),
      youOwe: centsToMoney(youOweThem),
      theyOwe: centsToMoney(owedToYou),
      net: centsToMoney(owedToYou - youOweThem),
    };
  });

  return c.json({
    groupId,
    youAreOwed: centsToMoney(youAreOwed),
    youOwe: centsToMoney(youOwe),
    net: centsToMoney(youAreOwed - youOwe),
    detail,
  });
});


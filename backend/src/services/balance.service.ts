import { getGroupBalanceRows, getUserGroupBalanceRows } from "../repositories/balance.repository";
import { requireGroupMember } from "./group-access.service";
import { formatCents, parseMoneyToCents } from "../utils/money";

export type BalancePerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type BalanceEntry = {
  from: BalancePerson;
  to: BalancePerson;
  amount: string;
};

export const getGroupBalances = async (
  groupId: string,
  userId: string,
): Promise<{ asOf: string; balances: BalanceEntry[] }> => {
  await requireGroupMember(groupId, userId);
  const rows = await getGroupBalanceRows(groupId);

  return {
    asOf: new Date().toISOString(),
    balances: rows.map((row) => ({
      from: {
        id: row.from_id,
        name: row.from_name,
        avatarUrl: row.from_avatar_url,
      },
      to: {
        id: row.to_id,
        name: row.to_name,
        avatarUrl: row.to_avatar_url,
      },
      amount: formatCents(parseMoneyToCents(row.amount)),
    })),
  };
};

export const getSimplifiedGroupBalances = async (
  groupId: string,
  userId: string,
): Promise<{ asOf: string; balances: BalanceEntry[] }> => {
  const rawBalances = await getGroupBalances(groupId, userId);
  const people = new Map<string, BalancePerson>();
  const netByUser = new Map<string, number>();

  for (const balance of rawBalances.balances) {
    const amountCents = parseMoneyToCents(balance.amount);
    people.set(balance.from.id, balance.from);
    people.set(balance.to.id, balance.to);
    netByUser.set(balance.from.id, (netByUser.get(balance.from.id) ?? 0) - amountCents);
    netByUser.set(balance.to.id, (netByUser.get(balance.to.id) ?? 0) + amountCents);
  }

  const debtors = Array.from(netByUser.entries())
    .filter(([, net]) => net < 0)
    .map(([id, net]) => ({ id, cents: Math.abs(net) }))
    .sort((left, right) => right.cents - left.cents);
  const creditors = Array.from(netByUser.entries())
    .filter(([, net]) => net > 0)
    .map(([id, net]) => ({ id, cents: net }))
    .sort((left, right) => right.cents - left.cents);
  const balances: BalanceEntry[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountCents = Math.min(debtor.cents, creditor.cents);

    if (amountCents > 0) {
      balances.push({
        from: people.get(debtor.id)!,
        to: people.get(creditor.id)!,
        amount: formatCents(amountCents),
      });
    }

    debtor.cents -= amountCents;
    creditor.cents -= amountCents;

    if (debtor.cents === 0) debtorIndex += 1;
    if (creditor.cents === 0) creditorIndex += 1;
  }

  return {
    asOf: rawBalances.asOf,
    balances,
  };
};

export const getMyGroupBalances = async (
  groupId: string,
  userId: string,
): Promise<{
  groupId: string;
  youAreOwed: string;
  youOwe: string;
  net: string;
  detail: {
    user: BalancePerson;
    youOwe: string;
    theyOwe: string;
    net: string;
  }[];
}> => {
  await requireGroupMember(groupId, userId);
  const rows = await getUserGroupBalanceRows(groupId, userId);
  const detail = rows.map((row) => {
    const netCents = parseMoneyToCents(row.amount);

    return {
      user: {
        id: row.person_id,
        name: row.person_name,
        avatarUrl: row.person_avatar_url,
      },
      youOwe: formatCents(netCents < 0 ? Math.abs(netCents) : 0),
      theyOwe: formatCents(netCents > 0 ? netCents : 0),
      net: formatCents(netCents),
    };
  });
  const youAreOwedCents = detail.reduce(
    (total, row) => total + parseMoneyToCents(row.theyOwe),
    0,
  );
  const youOweCents = detail.reduce(
    (total, row) => total + parseMoneyToCents(row.youOwe),
    0,
  );

  return {
    groupId,
    youAreOwed: formatCents(youAreOwedCents),
    youOwe: formatCents(youOweCents),
    net: formatCents(youAreOwedCents - youOweCents),
    detail,
  };
};

export const hasOutstandingBalance = async (
  groupId: string,
  userId?: string,
): Promise<boolean> => {
  if (userId) {
    const rows = await getUserGroupBalanceRows(groupId, userId);
    return rows.some((row) => parseMoneyToCents(row.amount) !== 0);
  }

  const rows = await getGroupBalanceRows(groupId);
  return rows.some((row) => parseMoneyToCents(row.amount) !== 0);
};

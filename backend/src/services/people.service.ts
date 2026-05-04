import { findUserById } from "../repositories/user.repository";
import { getUserBalanceRows } from "../repositories/user-balances.repository";
import {
  getPairExpenseRows,
  getPairSettlementRows,
  getSharedGroupRows,
  getSharedPeopleRows,
} from "../repositories/people.repository";
import { HttpError } from "../utils/http-error";
import { formatCents, parseMoneyToCents } from "../utils/money";
import { createSettlement } from "./settlement.service";

const buildBalanceByPerson = async (userId: string) => {
  const rows = await getUserBalanceRows(userId);
  const balanceByPerson = new Map<
    string,
    {
      totalCents: number;
      byGroup: Map<
        string,
        {
          groupId: string;
          groupName: string;
          amountCents: number;
        }
      >;
    }
  >();

  for (const row of rows) {
    const person =
      balanceByPerson.get(row.person_id) ??
      {
        totalCents: 0,
        byGroup: new Map(),
      };
    const amountCents = parseMoneyToCents(row.amount);
    const existingGroup = person.byGroup.get(row.group_id);

    person.totalCents += amountCents;
    person.byGroup.set(row.group_id, {
      groupId: row.group_id,
      groupName: row.group_name,
      amountCents: (existingGroup?.amountCents ?? 0) + amountCents,
    });
    balanceByPerson.set(row.person_id, person);
  }

  return balanceByPerson;
};

const splitNet = (netCents: number) => ({
  totalYouOwe: formatCents(netCents < 0 ? Math.abs(netCents) : 0),
  totalTheyOwe: formatCents(netCents > 0 ? netCents : 0),
  net: formatCents(netCents),
});

export const getPeople = async (userId: string) => {
  const [peopleRows, balances] = await Promise.all([
    getSharedPeopleRows(userId),
    buildBalanceByPerson(userId),
  ]);

  return peopleRows.map((row) => {
    const balance = balances.get(row.user_id);

    return {
      user: {
        id: row.user_id,
        name: row.name,
        avatarUrl: row.avatar_url,
      },
      ...splitNet(balance?.totalCents ?? 0),
      sharedGroupCount: Number(row.shared_group_count),
      lastActivityAt: row.last_activity_at?.toISOString?.() ?? null,
    };
  });
};

export const getPersonDetail = async (userId: string, personId: string) => {
  const [person, sharedGroups, balances, recentExpenses, recentSettlements] =
    await Promise.all([
      findUserById(personId),
      getSharedGroupRows(userId, personId),
      buildBalanceByPerson(userId),
      getPairExpenseRows(userId, personId, 20),
      getPairSettlementRows(userId, personId, 20),
    ]);

  if (!person || sharedGroups.length === 0) {
    throw new HttpError(404, "Resource not found", "NOT_FOUND");
  }

  const personBalance = balances.get(personId);
  const groupTypeById = new Map(sharedGroups.map((group) => [group.group_id, group.type]));
  const groupBalances = sharedGroups.map((group) => {
    const amountCents = personBalance?.byGroup.get(group.group_id)?.amountCents ?? 0;

    return {
      groupId: group.group_id,
      groupName: group.group_name,
      type: group.type,
      youOwe: formatCents(amountCents < 0 ? Math.abs(amountCents) : 0),
      theyOwe: formatCents(amountCents > 0 ? amountCents : 0),
      net: formatCents(amountCents),
      canSettle: amountCents !== 0,
    };
  });

  return {
    user: {
      id: person.id,
      name: person.name,
      email: person.email,
      avatarUrl: person.avatarUrl,
    },
    summary: splitNet(personBalance?.totalCents ?? 0),
    groups: groupBalances,
    recentExpenses: recentExpenses.map((expense) => ({
      id: expense.id,
      group: {
        id: expense.group_id,
        name: expense.group_name,
        type: groupTypeById.get(expense.group_id),
      },
      description: expense.description,
      amount: expense.amount,
      date: expense.date,
      paidBy: {
        id: expense.paid_by_id,
        name: expense.paid_by_name,
      },
      yourShare: formatCents(parseMoneyToCents(expense.your_share)),
      theirShare: formatCents(parseMoneyToCents(expense.their_share)),
      createdAt: expense.created_at.toISOString(),
    })),
    recentSettlements: recentSettlements.map((settlement) => ({
      id: settlement.id,
      group: {
        id: settlement.group_id,
        name: settlement.group_name,
        type: groupTypeById.get(settlement.group_id),
      },
      paidBy: {
        id: settlement.paid_by_id,
        name: settlement.paid_by_name,
      },
      paidTo: {
        id: settlement.paid_to_id,
        name: settlement.paid_to_name,
      },
      amount: formatCents(parseMoneyToCents(settlement.amount)),
      date: settlement.date,
      createdAt: settlement.created_at.toISOString(),
    })),
  };
};

export const settleWithPerson = async (userId: string, personId: string) => {
  const detail = await getPersonDetail(userId, personId);
  const settlements = [];

  for (const group of detail.groups) {
    const netCents = parseMoneyToCents(group.net);

    if (netCents === 0) {
      continue;
    }

    settlements.push(
      await createSettlement(group.groupId, userId, {
        paidById: netCents < 0 ? userId : personId,
        paidToId: netCents < 0 ? personId : userId,
        amount: formatCents(Math.abs(netCents)),
        date: new Date().toISOString().slice(0, 10),
        notes: "Settle all with person",
      }),
    );
  }

  if (settlements.length === 0) {
    throw new HttpError(422, "Net balance is already zero", "UNPROCESSABLE");
  }

  return { settlements };
};

import type { User } from "../entity/User";
import type { GroupType } from "../entity/enums";
import { queryRows } from "../repositories/analytics.repository";
import { getUserAnalyticsCategoryRows, getUserAnalyticsGroupRows } from "../repositories/user-analytics.repository";
import { getUserBalanceRows } from "../repositories/user-balances.repository";
import { saveUser } from "../repositories/user.repository";
import { formatCents, parseMoneyToCents } from "../utils/money";
import {
  toUserProfileResponse,
  type UserProfileResponse,
} from "./user-presenter";

export type UpdateProfileInput = {
  name?: string;
  avatarUrl?: string | null;
};

export type UserBalancesResponse = {
  totalOwed: string;
  totalYouOwe: string;
  net: string;
  byPerson: {
    user: {
      id: string;
      name: string;
      avatarUrl: string | null;
    };
    netAmount: string;
    breakdown: {
      groupId: string;
      groupName: string;
      amount: string;
    }[];
  }[];
};

export type UserAnalyticsResponse = {
  period: {
    from: string;
    to: string;
  };
  totalPaid: string;
  totalOwed: string;
  net: string;
  byGroup: {
    groupId: string;
    groupName: string;
    type: GroupType;
    paid: string;
    owed: string;
  }[];
  byCategory: {
    categoryId: string | null;
    name: string;
    icon: string | null;
    paid: string;
    owed: string;
  }[];
};

export const getUserProfile = (user: User): UserProfileResponse =>
  toUserProfileResponse(user);

export const updateUserProfile = async (
  user: User,
  input: UpdateProfileInput,
): Promise<UserProfileResponse> => {
  if (input.name !== undefined) {
    user.name = input.name;
  }

  if (input.avatarUrl !== undefined) {
    user.avatarUrl = input.avatarUrl;
  }

  const savedUser = await saveUser(user);
  return toUserProfileResponse(savedUser);
};

export const getUserBalances = async (
  userId: string,
  type?: GroupType,
): Promise<UserBalancesResponse> => {
  const rows = await getUserBalanceRows(userId, type);
  const people = new Map<
    string,
    {
      user: {
        id: string;
        name: string;
        avatarUrl: string | null;
      };
      netAmountCents: number;
      breakdown: Map<
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
    const amountCents = parseMoneyToCents(row.amount);
    const person =
      people.get(row.person_id) ??
      {
        user: {
          id: row.person_id,
          name: row.person_name,
          avatarUrl: row.person_avatar_url,
        },
        netAmountCents: 0,
        breakdown: new Map(),
      };
    const existingGroup = person.breakdown.get(row.group_id);

    person.netAmountCents += amountCents;
    person.breakdown.set(row.group_id, {
      groupId: row.group_id,
      groupName: row.group_name,
      amountCents: (existingGroup?.amountCents ?? 0) + amountCents,
    });
    people.set(row.person_id, person);
  }

  const byPerson = Array.from(people.values())
    .filter((person) => person.netAmountCents !== 0)
    .map((person) => ({
      user: person.user,
      netAmount: formatCents(person.netAmountCents),
      breakdown: Array.from(person.breakdown.values())
        .filter((group) => group.amountCents !== 0)
        .map((group) => ({
          groupId: group.groupId,
          groupName: group.groupName,
          amount: formatCents(group.amountCents),
        })),
    }))
    .sort((left, right) =>
      left.user.name.localeCompare(right.user.name, undefined, {
        sensitivity: "base",
      }),
    );

  const totalOwedCents = byPerson.reduce((total, person) => {
    const amountCents = parseMoneyToCents(person.netAmount);
    return amountCents > 0 ? total + amountCents : total;
  }, 0);
  const totalYouOweCents = byPerson.reduce((total, person) => {
    const amountCents = parseMoneyToCents(person.netAmount);
    return amountCents < 0 ? total + Math.abs(amountCents) : total;
  }, 0);

  return {
    totalOwed: formatCents(totalOwedCents),
    totalYouOwe: formatCents(totalYouOweCents),
    net: formatCents(totalOwedCents - totalYouOweCents),
    byPerson,
  };
};

export const getUserAnalytics = async (
  userId: string,
  period: { from: string; to: string },
): Promise<UserAnalyticsResponse> => {
  const [groupRows, categoryRows] = await Promise.all([
    getUserAnalyticsGroupRows(userId, period.from, period.to),
    getUserAnalyticsCategoryRows(userId, period.from, period.to),
  ]);
  const byGroup = groupRows.map((row) => ({
    groupId: row.group_id,
    groupName: row.group_name,
    type: row.type,
    paid: formatCents(parseMoneyToCents(row.paid)),
    owed: formatCents(parseMoneyToCents(row.owed)),
  }));
  const byCategory = categoryRows.map((row) => ({
    categoryId: row.category_id,
    name: row.name,
    icon: row.icon,
    paid: formatCents(parseMoneyToCents(row.paid)),
    owed: formatCents(parseMoneyToCents(row.owed)),
  }));
  const totalPaidCents = byGroup.reduce(
    (total, group) => total + parseMoneyToCents(group.paid),
    0,
  );
  const totalOwedCents = byGroup.reduce(
    (total, group) => total + parseMoneyToCents(group.owed),
    0,
  );

  return {
    period,
    totalPaid: formatCents(totalPaidCents),
    totalOwed: formatCents(totalOwedCents),
    net: formatCents(totalPaidCents - totalOwedCents),
    byGroup,
    byCategory,
  };
};

const userGrainLabelExpression = (grain: "day" | "week" | "month"): string => {
  if (grain === "day") return "to_char(date_trunc('day', expense.date::timestamp), 'YYYY-MM-DD')";
  if (grain === "week") return "to_char(date_trunc('week', expense.date::timestamp), 'IYYY-IW')";
  return "to_char(date_trunc('month', expense.date::timestamp), 'YYYY-MM')";
};

const userGrainStartExpression = (grain: "day" | "week" | "month"): string =>
  `date_trunc('${grain}', expense.date::timestamp)::date`;

export const getUserAnalyticsTrends = async (
  userId: string,
  input: { from: string; to: string; by: "day" | "week" | "month"; type?: GroupType },
) => {
  const labelExpression = userGrainLabelExpression(input.by);
  const startExpression = userGrainStartExpression(input.by === "week" ? "week" : input.by);
  const [bucketRows, categoryRows, groupRows] = await Promise.all([
    queryRows<{ key: string; start_date: string; paid: string; owed: string; count: string }>(
      `SELECT ${labelExpression} AS key,
        ${startExpression}::text AS start_date,
        SUM(CASE WHEN expense.paid_by = $1 THEN expense.amount ELSE 0 END)::text AS paid,
        SUM(COALESCE(participant.share_amount, 0))::text AS owed,
        COUNT(DISTINCT expense.id)::text AS count
       FROM expenses expense
       INNER JOIN groups "group" ON "group".id = expense.group_id
       INNER JOIN group_members current_member
        ON current_member.group_id = expense.group_id
        AND current_member.user_id = $1
       LEFT JOIN expense_participants participant
        ON participant.expense_id = expense.id
        AND participant.user_id = $1
       WHERE expense.date >= $2
        AND expense.date <= $3
        AND ($4::text IS NULL OR "group".type::text = $4)
        AND (expense.paid_by = $1 OR participant.user_id IS NOT NULL)
       GROUP BY key, start_date
       ORDER BY start_date ASC`,
      [userId, input.from, input.to, input.type ?? null],
    ),
    queryRows<{ key: string; category_id: string | null; name: string; icon: string | null; paid: string; owed: string }>(
      `SELECT ${labelExpression} AS key,
        category.id AS category_id,
        COALESCE(category.name, 'Uncategorized') AS name,
        category.icon AS icon,
        SUM(CASE WHEN expense.paid_by = $1 THEN expense.amount ELSE 0 END)::text AS paid,
        SUM(COALESCE(participant.share_amount, 0))::text AS owed
       FROM expenses expense
       INNER JOIN groups "group" ON "group".id = expense.group_id
       INNER JOIN group_members current_member
        ON current_member.group_id = expense.group_id
        AND current_member.user_id = $1
       LEFT JOIN expense_participants participant
        ON participant.expense_id = expense.id
        AND participant.user_id = $1
       LEFT JOIN categories category ON category.id = expense.category_id
       WHERE expense.date >= $2
        AND expense.date <= $3
        AND ($4::text IS NULL OR "group".type::text = $4)
        AND (expense.paid_by = $1 OR participant.user_id IS NOT NULL)
       GROUP BY key, category.id, category.name, category.icon
       ORDER BY key ASC, SUM(COALESCE(participant.share_amount, 0)) DESC`,
      [userId, input.from, input.to, input.type ?? null],
    ),
    queryRows<{ key: string; group_id: string; group_name: string; type: GroupType; paid: string; owed: string }>(
      `SELECT ${labelExpression} AS key,
        "group".id AS group_id,
        "group".name AS group_name,
        "group".type AS type,
        SUM(CASE WHEN expense.paid_by = $1 THEN expense.amount ELSE 0 END)::text AS paid,
        SUM(COALESCE(participant.share_amount, 0))::text AS owed
       FROM expenses expense
       INNER JOIN groups "group" ON "group".id = expense.group_id
       INNER JOIN group_members current_member
        ON current_member.group_id = expense.group_id
        AND current_member.user_id = $1
       LEFT JOIN expense_participants participant
        ON participant.expense_id = expense.id
        AND participant.user_id = $1
       WHERE expense.date >= $2
        AND expense.date <= $3
        AND ($4::text IS NULL OR "group".type::text = $4)
        AND (expense.paid_by = $1 OR participant.user_id IS NOT NULL)
       GROUP BY key, "group".id, "group".name, "group".type
       ORDER BY key ASC, "group".name ASC`,
      [userId, input.from, input.to, input.type ?? null],
    ),
  ]);
  const categoryByKey = new Map<string, typeof categoryRows>();
  const groupByKey = new Map<string, typeof groupRows>();

  for (const row of categoryRows) {
    categoryByKey.set(row.key, [...(categoryByKey.get(row.key) ?? []), row]);
  }

  for (const row of groupRows) {
    groupByKey.set(row.key, [...(groupByKey.get(row.key) ?? []), row]);
  }

  return {
    by: input.by,
    period: { from: input.from, to: input.to },
    buckets: bucketRows.map((row) => {
      const paidCents = parseMoneyToCents(row.paid);
      const owedCents = parseMoneyToCents(row.owed);

      return {
        key: row.key,
        label: row.key,
        paid: formatCents(paidCents),
        owed: formatCents(owedCents),
        net: formatCents(paidCents - owedCents),
        expenseCount: Number(row.count),
        byCategory: (categoryByKey.get(row.key) ?? []).map((category) => ({
          categoryId: category.category_id,
          name: category.name,
          icon: category.icon,
          paid: formatCents(parseMoneyToCents(category.paid)),
          owed: formatCents(parseMoneyToCents(category.owed)),
        })),
        byGroup: (groupByKey.get(row.key) ?? []).map((group) => ({
          groupId: group.group_id,
          groupName: group.group_name,
          type: group.type,
          paid: formatCents(parseMoneyToCents(group.paid)),
          owed: formatCents(parseMoneyToCents(group.owed)),
        })),
      };
    }),
  };
};

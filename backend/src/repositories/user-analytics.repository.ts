import { AppDataSource } from "../data-source";
import type { GroupType } from "../entity/enums";

export type UserAnalyticsGroupRow = {
  group_id: string;
  group_name: string;
  type: GroupType;
  paid: string;
  owed: string;
};

export type UserAnalyticsCategoryRow = {
  category_id: string | null;
  name: string;
  icon: string | null;
  paid: string;
  owed: string;
};

export const getUserAnalyticsGroupRows = async (
  userId: string,
  from: string,
  to: string,
): Promise<UserAnalyticsGroupRow[]> =>
  AppDataSource.query(
    `
      SELECT
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
        AND (expense.paid_by = $1 OR participant.user_id IS NOT NULL)
      GROUP BY "group".id, "group".name, "group".type
      ORDER BY "group".name ASC
    `,
    [userId, from, to],
  );

export const getUserAnalyticsCategoryRows = async (
  userId: string,
  from: string,
  to: string,
): Promise<UserAnalyticsCategoryRow[]> =>
  AppDataSource.query(
    `
      SELECT
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
        AND (expense.paid_by = $1 OR participant.user_id IS NOT NULL)
      GROUP BY category.id, category.name, category.icon
      ORDER BY name ASC
    `,
    [userId, from, to],
  );

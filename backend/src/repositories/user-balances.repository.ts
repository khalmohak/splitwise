import { AppDataSource } from "../data-source";
import type { GroupType } from "../entity/enums";

export type UserBalanceRow = {
  person_id: string;
  person_name: string;
  person_avatar_url: string | null;
  group_id: string;
  group_name: string;
  amount: string;
};

export const getUserBalanceRows = async (
  userId: string,
  type?: GroupType,
): Promise<UserBalanceRow[]> =>
  AppDataSource.query(
    `
      WITH balance_entries AS (
        SELECT
          participant.user_id AS person_id,
          participant_user.name AS person_name,
          participant_user.avatar_url AS person_avatar_url,
          expense.group_id AS group_id,
          "group".name AS group_name,
          participant.share_amount AS amount
        FROM expenses expense
        INNER JOIN groups "group" ON "group".id = expense.group_id
        INNER JOIN group_members current_member
          ON current_member.group_id = expense.group_id
          AND current_member.user_id = $1
        INNER JOIN expense_participants participant
          ON participant.expense_id = expense.id
          AND participant.user_id <> $1
        INNER JOIN users participant_user ON participant_user.id = participant.user_id
        WHERE expense.paid_by = $1
          AND ($2::text IS NULL OR "group".type::text = $2)

        UNION ALL

        SELECT
          expense.paid_by AS person_id,
          payer.name AS person_name,
          payer.avatar_url AS person_avatar_url,
          expense.group_id AS group_id,
          "group".name AS group_name,
          -participant.share_amount AS amount
        FROM expenses expense
        INNER JOIN groups "group" ON "group".id = expense.group_id
        INNER JOIN group_members current_member
          ON current_member.group_id = expense.group_id
          AND current_member.user_id = $1
        INNER JOIN expense_participants participant
          ON participant.expense_id = expense.id
          AND participant.user_id = $1
        INNER JOIN users payer ON payer.id = expense.paid_by
        WHERE expense.paid_by <> $1
          AND ($2::text IS NULL OR "group".type::text = $2)

        UNION ALL

        SELECT
          settlement.paid_to AS person_id,
          paid_to_user.name AS person_name,
          paid_to_user.avatar_url AS person_avatar_url,
          settlement.group_id AS group_id,
          "group".name AS group_name,
          settlement.amount AS amount
        FROM settlements settlement
        INNER JOIN groups "group" ON "group".id = settlement.group_id
        INNER JOIN group_members current_member
          ON current_member.group_id = settlement.group_id
          AND current_member.user_id = $1
        INNER JOIN users paid_to_user ON paid_to_user.id = settlement.paid_to
        WHERE settlement.paid_by = $1
          AND ($2::text IS NULL OR "group".type::text = $2)

        UNION ALL

        SELECT
          settlement.paid_by AS person_id,
          paid_by_user.name AS person_name,
          paid_by_user.avatar_url AS person_avatar_url,
          settlement.group_id AS group_id,
          "group".name AS group_name,
          -settlement.amount AS amount
        FROM settlements settlement
        INNER JOIN groups "group" ON "group".id = settlement.group_id
        INNER JOIN group_members current_member
          ON current_member.group_id = settlement.group_id
          AND current_member.user_id = $1
        INNER JOIN users paid_by_user ON paid_by_user.id = settlement.paid_by
        WHERE settlement.paid_to = $1
          AND ($2::text IS NULL OR "group".type::text = $2)
      )
      SELECT
        person_id,
        person_name,
        person_avatar_url,
        group_id,
        group_name,
        SUM(amount)::text AS amount
      FROM balance_entries
      GROUP BY person_id, person_name, person_avatar_url, group_id, group_name
      HAVING SUM(amount) <> 0
      ORDER BY person_name ASC, group_name ASC
    `,
    [userId, type ?? null],
  );

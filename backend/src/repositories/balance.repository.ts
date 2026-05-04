import { AppDataSource } from "../data-source";

export type GroupBalancePairRow = {
  from_id: string;
  from_name: string;
  from_avatar_url: string | null;
  to_id: string;
  to_name: string;
  to_avatar_url: string | null;
  amount: string;
};

export type UserGroupBalanceRow = {
  person_id: string;
  person_name: string;
  person_avatar_url: string | null;
  amount: string;
};

export const getGroupBalanceRows = async (
  groupId: string,
): Promise<GroupBalancePairRow[]> =>
  AppDataSource.query(
    `
      WITH pair_entries AS (
        SELECT
          participant.user_id AS from_id,
          expense.paid_by AS to_id,
          participant.share_amount AS amount
        FROM expenses expense
        INNER JOIN expense_participants participant ON participant.expense_id = expense.id
        WHERE expense.group_id = $1
          AND participant.user_id <> expense.paid_by

        UNION ALL

        SELECT
          settlement.paid_by AS from_id,
          settlement.paid_to AS to_id,
          -settlement.amount AS amount
        FROM settlements settlement
        WHERE settlement.group_id = $1
      ),
      normalized AS (
        SELECT
          LEAST(from_id, to_id) AS left_id,
          GREATEST(from_id, to_id) AS right_id,
          CASE
            WHEN from_id = LEAST(from_id, to_id) THEN amount
            ELSE -amount
          END AS amount
        FROM pair_entries
      ),
      net_pairs AS (
        SELECT left_id, right_id, SUM(amount) AS amount
        FROM normalized
        GROUP BY left_id, right_id
        HAVING SUM(amount) <> 0
      )
      SELECT
        CASE WHEN net_pairs.amount > 0 THEN net_pairs.left_id ELSE net_pairs.right_id END AS from_id,
        from_user.name AS from_name,
        from_user.avatar_url AS from_avatar_url,
        CASE WHEN net_pairs.amount > 0 THEN net_pairs.right_id ELSE net_pairs.left_id END AS to_id,
        to_user.name AS to_name,
        to_user.avatar_url AS to_avatar_url,
        ABS(net_pairs.amount)::text AS amount
      FROM net_pairs
      INNER JOIN users from_user
        ON from_user.id = CASE WHEN net_pairs.amount > 0 THEN net_pairs.left_id ELSE net_pairs.right_id END
      INNER JOIN users to_user
        ON to_user.id = CASE WHEN net_pairs.amount > 0 THEN net_pairs.right_id ELSE net_pairs.left_id END
      ORDER BY from_user.name ASC, to_user.name ASC
    `,
    [groupId],
  );

export const getUserGroupBalanceRows = async (
  groupId: string,
  userId: string,
): Promise<UserGroupBalanceRow[]> =>
  AppDataSource.query(
    `
      WITH entries AS (
        SELECT
          participant.user_id AS person_id,
          participant_user.name AS person_name,
          participant_user.avatar_url AS person_avatar_url,
          participant.share_amount AS amount
        FROM expenses expense
        INNER JOIN expense_participants participant
          ON participant.expense_id = expense.id
          AND participant.user_id <> $2
        INNER JOIN users participant_user ON participant_user.id = participant.user_id
        WHERE expense.group_id = $1
          AND expense.paid_by = $2

        UNION ALL

        SELECT
          expense.paid_by AS person_id,
          payer.name AS person_name,
          payer.avatar_url AS person_avatar_url,
          -participant.share_amount AS amount
        FROM expenses expense
        INNER JOIN expense_participants participant
          ON participant.expense_id = expense.id
          AND participant.user_id = $2
        INNER JOIN users payer ON payer.id = expense.paid_by
        WHERE expense.group_id = $1
          AND expense.paid_by <> $2

        UNION ALL

        SELECT
          settlement.paid_to AS person_id,
          paid_to.name AS person_name,
          paid_to.avatar_url AS person_avatar_url,
          settlement.amount AS amount
        FROM settlements settlement
        INNER JOIN users paid_to ON paid_to.id = settlement.paid_to
        WHERE settlement.group_id = $1
          AND settlement.paid_by = $2

        UNION ALL

        SELECT
          settlement.paid_by AS person_id,
          paid_by.name AS person_name,
          paid_by.avatar_url AS person_avatar_url,
          -settlement.amount AS amount
        FROM settlements settlement
        INNER JOIN users paid_by ON paid_by.id = settlement.paid_by
        WHERE settlement.group_id = $1
          AND settlement.paid_to = $2
      )
      SELECT person_id, person_name, person_avatar_url, SUM(amount)::text AS amount
      FROM entries
      GROUP BY person_id, person_name, person_avatar_url
      HAVING SUM(amount) <> 0
      ORDER BY person_name ASC
    `,
    [groupId, userId],
  );

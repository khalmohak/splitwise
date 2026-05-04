import { AppDataSource } from "../data-source";
import type { GroupType } from "../entity/enums";

export type SharedPersonRow = {
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  shared_group_count: string;
  last_activity_at: Date | null;
};

export type SharedGroupRow = {
  group_id: string;
  group_name: string;
  type: GroupType;
};

export type PairExpenseRow = {
  id: string;
  group_id: string;
  group_name: string;
  description: string;
  amount: string;
  date: string;
  paid_by_id: string;
  paid_by_name: string;
  your_share: string;
  their_share: string;
  created_at: Date;
};

export type PairSettlementRow = {
  id: string;
  group_id: string;
  group_name: string;
  paid_by_id: string;
  paid_by_name: string;
  paid_to_id: string;
  paid_to_name: string;
  amount: string;
  date: string;
  created_at: Date;
};

export const getSharedPeopleRows = async (
  userId: string,
): Promise<SharedPersonRow[]> =>
  AppDataSource.query(
    `
      SELECT
        other_user.id AS user_id,
        other_user.name,
        other_user.email,
        other_user.avatar_url,
        COUNT(DISTINCT shared_group.id)::text AS shared_group_count,
        GREATEST(
          COALESCE(MAX(expense.created_at), 'epoch'::timestamp),
          COALESCE(MAX(settlement.created_at), 'epoch'::timestamp)
        ) AS last_activity_at
      FROM group_members current_member
      INNER JOIN groups shared_group ON shared_group.id = current_member.group_id
      INNER JOIN group_members other_member
        ON other_member.group_id = current_member.group_id
        AND other_member.user_id <> $1
      INNER JOIN users other_user ON other_user.id = other_member.user_id
      LEFT JOIN expenses expense ON expense.group_id = shared_group.id
      LEFT JOIN expense_participants current_participant
        ON current_participant.expense_id = expense.id
        AND current_participant.user_id = $1
      LEFT JOIN expense_participants other_participant
        ON other_participant.expense_id = expense.id
        AND other_participant.user_id = other_user.id
      LEFT JOIN settlements settlement
        ON settlement.group_id = shared_group.id
        AND (
          (settlement.paid_by = $1 AND settlement.paid_to = other_user.id)
          OR (settlement.paid_by = other_user.id AND settlement.paid_to = $1)
        )
      WHERE current_member.user_id = $1
      GROUP BY other_user.id
      ORDER BY last_activity_at DESC, other_user.name ASC
    `,
    [userId],
  );

export const getSharedGroupRows = async (
  userId: string,
  personId: string,
): Promise<SharedGroupRow[]> =>
  AppDataSource.query(
    `
      SELECT "group".id AS group_id, "group".name AS group_name, "group".type
      FROM groups "group"
      INNER JOIN group_members current_member
        ON current_member.group_id = "group".id
        AND current_member.user_id = $1
      INNER JOIN group_members other_member
        ON other_member.group_id = "group".id
        AND other_member.user_id = $2
      ORDER BY "group".name ASC
    `,
    [userId, personId],
  );

export const getPairExpenseRows = async (
  userId: string,
  personId: string,
  limit: number,
): Promise<PairExpenseRow[]> =>
  AppDataSource.query(
    `
      SELECT
        expense.id,
        expense.group_id,
        "group".name AS group_name,
        expense.description,
        expense.amount::text AS amount,
        expense.date::text AS date,
        payer.id AS paid_by_id,
        payer.name AS paid_by_name,
        COALESCE(current_participant.share_amount, 0)::text AS your_share,
        COALESCE(other_participant.share_amount, 0)::text AS their_share,
        expense.created_at
      FROM expenses expense
      INNER JOIN groups "group" ON "group".id = expense.group_id
      INNER JOIN group_members current_member
        ON current_member.group_id = expense.group_id
        AND current_member.user_id = $1
      INNER JOIN group_members other_member
        ON other_member.group_id = expense.group_id
        AND other_member.user_id = $2
      INNER JOIN users payer ON payer.id = expense.paid_by
      LEFT JOIN expense_participants current_participant
        ON current_participant.expense_id = expense.id
        AND current_participant.user_id = $1
      LEFT JOIN expense_participants other_participant
        ON other_participant.expense_id = expense.id
        AND other_participant.user_id = $2
      WHERE expense.paid_by IN ($1, $2)
        OR current_participant.user_id IS NOT NULL
        OR other_participant.user_id IS NOT NULL
      ORDER BY expense.date DESC, expense.created_at DESC
      LIMIT $3
    `,
    [userId, personId, limit],
  );

export const getPairSettlementRows = async (
  userId: string,
  personId: string,
  limit: number,
): Promise<PairSettlementRow[]> =>
  AppDataSource.query(
    `
      SELECT
        settlement.id,
        settlement.group_id,
        "group".name AS group_name,
        paid_by.id AS paid_by_id,
        paid_by.name AS paid_by_name,
        paid_to.id AS paid_to_id,
        paid_to.name AS paid_to_name,
        settlement.amount::text AS amount,
        settlement.date::text AS date,
        settlement.created_at
      FROM settlements settlement
      INNER JOIN groups "group" ON "group".id = settlement.group_id
      INNER JOIN group_members current_member
        ON current_member.group_id = settlement.group_id
        AND current_member.user_id = $1
      INNER JOIN group_members other_member
        ON other_member.group_id = settlement.group_id
        AND other_member.user_id = $2
      INNER JOIN users paid_by ON paid_by.id = settlement.paid_by
      INNER JOIN users paid_to ON paid_to.id = settlement.paid_to
      WHERE (settlement.paid_by = $1 AND settlement.paid_to = $2)
         OR (settlement.paid_by = $2 AND settlement.paid_to = $1)
      ORDER BY settlement.date DESC, settlement.created_at DESC
      LIMIT $3
    `,
    [userId, personId, limit],
  );

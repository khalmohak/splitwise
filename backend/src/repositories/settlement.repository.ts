import { AppDataSource } from "../data-source";
import { Settlement } from "../entity/Settlement";

export type SettlementFilters = {
  userId?: string;
  from?: string;
  to?: string;
};

export const createSettlementRecord = async (
  input: Partial<Settlement>,
): Promise<Settlement> =>
  AppDataSource.getRepository(Settlement).save(
    AppDataSource.getRepository(Settlement).create(input),
  );

export const findSettlementDetail = async (
  groupId: string,
  settlementId: string,
): Promise<Settlement | null> =>
  AppDataSource.getRepository(Settlement).findOne({
    where: { id: settlementId, groupId },
    relations: ["paidByUser", "paidToUser"],
  });

export const listSettlements = async (
  groupId: string,
  filters: SettlementFilters,
  pagination: { skip: number; limit: number },
  sort: "date" | "amount",
  order: "ASC" | "DESC",
): Promise<[Settlement[], number]> => {
  const qb = AppDataSource.getRepository(Settlement)
    .createQueryBuilder("settlement")
    .leftJoinAndSelect("settlement.paidByUser", "paidByUser")
    .leftJoinAndSelect("settlement.paidToUser", "paidToUser")
    .where("settlement.group_id = :groupId", { groupId });

  if (filters.userId) {
    qb.andWhere("(settlement.paid_by = :userId OR settlement.paid_to = :userId)", {
      userId: filters.userId,
    });
  }
  if (filters.from) qb.andWhere("settlement.date >= :from", { from: filters.from });
  if (filters.to) qb.andWhere("settlement.date <= :to", { to: filters.to });

  return qb
    .orderBy(sort === "amount" ? "settlement.amount" : "settlement.date", order)
    .addOrderBy("settlement.created_at", "DESC")
    .skip(pagination.skip)
    .take(pagination.limit)
    .getManyAndCount();
};

export const deleteSettlementRecord = async (settlementId: string): Promise<void> => {
  await AppDataSource.getRepository(Settlement).delete({ id: settlementId });
};

export const findRecentSettlementsForGroups = async (
  groupIds: string[],
  limit: number,
): Promise<Settlement[]> =>
  groupIds.length === 0
    ? []
    : AppDataSource.getRepository(Settlement)
        .createQueryBuilder("settlement")
        .leftJoinAndSelect("settlement.paidByUser", "paidByUser")
        .leftJoinAndSelect("settlement.paidToUser", "paidToUser")
        .where("settlement.group_id IN (:...groupIds)", { groupIds })
        .orderBy("settlement.created_at", "DESC")
        .take(limit)
        .getMany();

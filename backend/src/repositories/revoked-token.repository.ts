import { MoreThan } from "typeorm";

import { AppDataSource } from "../data-source";
import { RevokedToken } from "../entity/RevokedToken";

const repository = () => AppDataSource.getRepository(RevokedToken);

export const findActiveRevokedTokenByHash = async (
  tokenHash: string,
): Promise<RevokedToken | null> =>
  repository().findOne({
    where: {
      tokenHash,
      expiresAt: MoreThan(new Date()),
    },
  });

export const upsertRevokedToken = async (
  tokenHash: string,
  expiresAt: Date,
): Promise<void> => {
  await repository().upsert({ tokenHash, expiresAt }, ["tokenHash"]);
};

export const deleteExpiredRevokedTokens = async (): Promise<void> => {
  await repository()
    .createQueryBuilder()
    .delete()
    .where("expires_at <= :now", { now: new Date() })
    .execute();
};

import { In, Not } from "typeorm";

import { AppDataSource } from "../data-source";
import {
  AuditAction,
  AuditLog,
  AuditResourceType,
  type AuditChange,
} from "../entity/AuditLog";

export type AuditLogFilters = {
  action?: AuditAction;
  resourceType?: AuditResourceType;
  resourceId?: string;
  actorId?: string;
  from?: string;
  to?: string;
};

export const createAuditLogRecord = async (input: {
  groupId: string;
  actorId: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  summary: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedFields: AuditChange[] | null;
}): Promise<AuditLog> =>
  AppDataSource.getRepository(AuditLog).save(
    AppDataSource.getRepository(AuditLog).create(input),
  );

export const listAuditLogs = async (
  groupId: string,
  filters: AuditLogFilters,
  pagination: { skip: number; limit: number },
): Promise<[AuditLog[], number]> => {
  const qb = AppDataSource.getRepository(AuditLog)
    .createQueryBuilder("auditLog")
    .leftJoinAndSelect("auditLog.actor", "actor")
    .where("auditLog.group_id = :groupId", { groupId });

  if (filters.action) {
    qb.andWhere("auditLog.action = :action", { action: filters.action });
  }
  if (filters.resourceType) {
    qb.andWhere("auditLog.resource_type = :resourceType", {
      resourceType: filters.resourceType,
    });
  }
  if (filters.resourceId) {
    qb.andWhere("auditLog.resource_id = :resourceId", {
      resourceId: filters.resourceId,
    });
  }
  if (filters.actorId) {
    qb.andWhere("auditLog.actor_id = :actorId", { actorId: filters.actorId });
  }
  if (filters.from) {
    qb.andWhere("auditLog.created_at >= :from", { from: filters.from });
  }
  if (filters.to) {
    qb.andWhere("auditLog.created_at <= :to", { to: filters.to });
  }

  return qb
    .orderBy("auditLog.created_at", "DESC")
    .addOrderBy("auditLog.id", "DESC")
    .skip(pagination.skip)
    .take(pagination.limit)
    .getManyAndCount();
};

export const findRecentAuditLogsForGroups = async (
  groupIds: string[],
  limit: number,
): Promise<AuditLog[]> =>
  groupIds.length === 0
    ? []
    : AppDataSource.getRepository(AuditLog).find({
        where: {
          groupId: In(groupIds),
          action: Not(AuditAction.CREATED),
        },
        relations: ["actor"],
        order: { createdAt: "DESC" },
        take: limit,
      });

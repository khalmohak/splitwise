import type { Request, Response } from "express";

import { AuditAction, AuditResourceType } from "../entity/AuditLog";
import { getGroupAuditLogs } from "../services/audit-log.service";
import { isDateOnly } from "../utils/date";
import { validationError } from "../utils/http-error";
import { parsePagination } from "../utils/pagination";

const parseAuditAction = (value: unknown): AuditAction | undefined => {
  if (value === undefined) return undefined;
  if (
    value === AuditAction.CREATED ||
    value === AuditAction.UPDATED ||
    value === AuditAction.DELETED
  ) {
    return value;
  }
  throw validationError({ action: "Action must be created, updated, or deleted" });
};

const parseResourceType = (value: unknown): AuditResourceType | undefined => {
  if (value === undefined) return undefined;
  if (
    value === AuditResourceType.EXPENSE ||
    value === AuditResourceType.SETTLEMENT
  ) {
    return value;
  }
  throw validationError({ resourceType: "Resource type must be expense or settlement" });
};

const parseDateTimeQuery = (
  value: unknown,
  field: "from" | "to",
): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    if (isDateOnly(value)) {
      return field === "from"
        ? `${value}T00:00:00.000Z`
        : `${value}T23:59:59.999Z`;
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  throw validationError({ [field]: "Date must be YYYY-MM-DD or ISO 8601" });
};

export const groupAuditHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  res.json(
    await getGroupAuditLogs(
      req.params.groupId as string,
      req.auth!.user.id,
      {
        action: parseAuditAction(req.query.action),
        resourceType: parseResourceType(req.query.resourceType),
        resourceId: typeof req.query.resourceId === "string" ? req.query.resourceId : undefined,
        actorId: typeof req.query.actorId === "string" ? req.query.actorId : undefined,
        from: parseDateTimeQuery(req.query.from, "from"),
        to: parseDateTimeQuery(req.query.to, "to"),
      },
      parsePagination(req.query),
    ),
  );
};

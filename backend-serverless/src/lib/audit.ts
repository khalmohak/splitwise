import { db } from "../db/client.js";
import { auditLogs, type AuditChange } from "../db/schema/audit-logs.js";

export type AuditAction = "created" | "updated" | "deleted";
export type AuditResourceType = "expense" | "settlement";

export type AuditWrite = {
  groupId: string;
  actorId: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  summary: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  changedFields?: AuditChange[] | null;
};

export async function recordAudit(write: AuditWrite): Promise<void> {
  await db.insert(auditLogs).values({
    groupId: write.groupId,
    actorId: write.actorId,
    action: write.action,
    resourceType: write.resourceType,
    resourceId: write.resourceId,
    summary: write.summary,
    before: write.before ?? null,
    after: write.after ?? null,
    changedFields: write.changedFields ?? null,
  });
}

// Diff two snapshots and return a changedFields[] array for fields that
// differ. Useful for update operations where we want to record only what
// changed, not the full row.
export function diffSnapshots(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): AuditChange[] {
  const out: AuditChange[] = [];
  for (const f of fields) {
    const b = before[f];
    const a = after[f];
    if (!shallowEq(b, a)) out.push({ field: f, before: b, after: a });
  }
  return out;
}

function shallowEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => shallowEq(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { billInstances, type BillInstance } from "../db/schema/bill-instances.js";
import { billTemplates, type BillTemplate } from "../db/schema/bill-templates.js";
import { groupMembers } from "../db/schema/groups.js";
import { users } from "../db/schema/users.js";
import { splitByWeights } from "./money.js";

export const ACTIVE_RESIDENT_STATUSES = ["active", "leaving"] as const;

export type ResidentSnapshotEntry = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  roomLabel: string | null;
  moveInDate: string | null;
  moveOutDate: string | null;
  status: (typeof ACTIVE_RESIDENT_STATUSES)[number] | "left";
};

export type BillSplitSnapshotEntry = {
  userId: string;
  weight: number;
  roomLabel: string | null;
  splitInput: string | null;
};

export function todayDateOnly(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function monthBounds(now = new Date()): {
  periodStart: string;
  periodEnd: string;
} {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

export function dueDateForMonth(periodStart: string, dueDay: number): string {
  const [year, month] = periodStart.split("-").map(Number);
  const end = new Date(Date.UTC(year!, month!, 0));
  const day = Math.min(Math.max(dueDay, 1), end.getUTCDate());
  return `${periodStart.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

export function buildPeriodLabel(name: string, periodStart: string): string {
  const dt = new Date(`${periodStart}T00:00:00Z`);
  const month = dt.toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${name} - ${month}`;
}

export function deriveBillStatus(
  row: Pick<BillInstance, "status" | "dueDate">,
  today = todayDateOnly(),
): BillInstance["status"] {
  if (row.status === "paid" || row.status === "skipped" || row.status === "cancelled") {
    return row.status;
  }
  if (row.dueDate < today) return "overdue";
  return "due";
}

export async function syncBillStatuses(
  groupId: string,
  today = todayDateOnly(),
): Promise<void> {
  const rows = await db
    .select({
      id: billInstances.id,
      status: billInstances.status,
      dueDate: billInstances.dueDate,
    })
    .from(billInstances)
    .where(eq(billInstances.groupId, groupId));

  const overdueIds = rows
    .filter((r) => deriveBillStatus(r, today) === "overdue" && r.status !== "overdue")
    .map((r) => r.id);
  const dueIds = rows
    .filter((r) => deriveBillStatus(r, today) === "due" && r.status === "scheduled")
    .map((r) => r.id);

  if (overdueIds.length > 0) {
    await db
      .update(billInstances)
      .set({ status: "overdue", updatedAt: new Date() })
      .where(inArray(billInstances.id, overdueIds));
  }
  if (dueIds.length > 0) {
    await db
      .update(billInstances)
      .set({ status: "due", updatedAt: new Date() })
      .where(inArray(billInstances.id, dueIds));
  }
}

function isResidentIncluded(
  member: typeof groupMembers.$inferSelect,
  periodStart: string,
  periodEnd: string,
): boolean {
  if (member.moveInDate && member.moveInDate > periodEnd) return false;
  if (member.moveOutDate && member.moveOutDate < periodStart) return false;
  if (member.status === "left" && (!member.moveOutDate || member.moveOutDate < periodStart)) {
    return false;
  }
  return true;
}

export async function loadResidentSnapshotForPeriod(
  groupId: string,
  periodStart: string,
  periodEnd: string,
): Promise<ResidentSnapshotEntry[]> {
  const rows = await db
    .select({
      member: groupMembers,
      user: users,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId));

  return rows
    .filter((r) => isResidentIncluded(r.member, periodStart, periodEnd))
    .map((r) => ({
      userId: r.user.id,
      name: r.user.name,
      avatarUrl: r.user.avatarUrl,
      roomLabel: r.member.roomLabel ?? null,
      moveInDate: r.member.moveInDate ?? null,
      moveOutDate: r.member.moveOutDate ?? null,
      status: r.member.status,
    }));
}

function readWeights(config: unknown): Map<string, number> {
  if (!config || typeof config !== "object") return new Map();
  const out = new Map<string, number>();
  const obj = config as Record<string, unknown>;
  if (Array.isArray(obj.entries)) {
    for (const raw of obj.entries) {
      if (!raw || typeof raw !== "object") continue;
      const entry = raw as Record<string, unknown>;
      const userId = typeof entry.userId === "string" ? entry.userId : null;
      const weight = Number(entry.weight);
      if (!userId || !Number.isFinite(weight) || weight <= 0) continue;
      out.set(userId, weight);
    }
  }
  if (obj.weights && typeof obj.weights === "object") {
    for (const [userId, raw] of Object.entries(obj.weights as Record<string, unknown>)) {
      const weight = Number(raw);
      if (!Number.isFinite(weight) || weight <= 0) continue;
      out.set(userId, weight);
    }
  }
  return out;
}

function readRoomWeights(config: unknown): Map<string, number> {
  if (!config || typeof config !== "object") return new Map();
  const roomWeights = (config as Record<string, unknown>).roomWeights;
  if (!roomWeights || typeof roomWeights !== "object") return new Map();
  const out = new Map<string, number>();
  for (const [roomLabel, raw] of Object.entries(roomWeights as Record<string, unknown>)) {
    const weight = Number(raw);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    out.set(roomLabel, weight);
  }
  return out;
}

export function buildSplitSnapshot(
  template: Pick<BillTemplate, "splitStrategy" | "splitConfig">,
  residents: ResidentSnapshotEntry[],
): BillSplitSnapshotEntry[] {
  if (template.splitStrategy === "fixed_shares" || template.splitStrategy === "custom_snapshot") {
    const weights = readWeights(template.splitConfig);
    return residents.map((resident) => {
      const weight = weights.get(resident.userId) ?? 1;
      return {
        userId: resident.userId,
        weight,
        roomLabel: resident.roomLabel,
        splitInput: String(weight),
      };
    });
  }

  if (template.splitStrategy === "room_based") {
    const roomWeights = readRoomWeights(template.splitConfig);
    return residents.map((resident) => {
      const weight = resident.roomLabel ? (roomWeights.get(resident.roomLabel) ?? 1) : 1;
      return {
        userId: resident.userId,
        weight,
        roomLabel: resident.roomLabel,
        splitInput: resident.roomLabel,
      };
    });
  }

  return residents.map((resident) => ({
    userId: resident.userId,
    weight: 1,
    roomLabel: resident.roomLabel,
    splitInput: null,
  }));
}

export function computeBillParticipantShares(
  amount: string,
  splitSnapshot: BillSplitSnapshotEntry[],
): Array<{ userId: string; shareAmount: string; splitInput: string | null }> {
  const eligible = splitSnapshot.filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0);
  const shares = splitByWeights(
    amount,
    eligible.map((entry) => entry.weight),
  );
  return eligible.map((entry, idx) => ({
    userId: entry.userId,
    shareAmount: shares[idx]!,
    splitInput: entry.splitInput ?? String(entry.weight),
  }));
}

export async function ensureCurrentBillInstances(
  groupId: string,
  now = new Date(),
): Promise<void> {
  const { periodStart, periodEnd } = monthBounds(now);
  const templates = await db
    .select()
    .from(billTemplates)
    .where(and(eq(billTemplates.groupId, groupId), eq(billTemplates.isActive, true)));

  if (templates.length === 0) return;

  const existing = await db
    .select({
      templateId: billInstances.templateId,
    })
    .from(billInstances)
    .where(
      and(
        eq(billInstances.groupId, groupId),
        eq(billInstances.periodStart, periodStart),
        eq(billInstances.periodEnd, periodEnd),
      ),
    );
  const existingTemplateIds = new Set(existing.map((row) => row.templateId));

  const inserts: Array<typeof billInstances.$inferInsert> = [];
  for (const template of templates) {
    if (existingTemplateIds.has(template.id)) continue;

    const residentSnapshot = await loadResidentSnapshotForPeriod(groupId, periodStart, periodEnd);
    if (residentSnapshot.length === 0) continue;

    const splitSnapshot = buildSplitSnapshot(template, residentSnapshot);
    const dueDate = dueDateForMonth(periodStart, template.dueDay);
    inserts.push({
      templateId: template.id,
      groupId,
      label: buildPeriodLabel(template.name, periodStart),
      periodStart,
      periodEnd,
      dueDate,
      status: dueDate < todayDateOnly(now) ? "overdue" : "due",
      amount: template.defaultAmount ?? null,
      defaultPayerUserId: template.defaultPayerUserId ?? null,
      residentSnapshot: residentSnapshot as unknown as object,
      splitSnapshot: splitSnapshot as unknown as object,
    });
  }

  if (inserts.length > 0) {
    await db.insert(billInstances).values(inserts);
  }
  await syncBillStatuses(groupId, todayDateOnly(now));
}

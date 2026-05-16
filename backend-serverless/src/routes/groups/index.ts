import { Hono } from "hono";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { groupMembers, groups } from "../../db/schema/groups.js";
import { users, type User } from "../../db/schema/users.js";
import { groupInvites } from "../../db/schema/group-invites.js";
import { requireAuth, type AuthVariables } from "../../lib/auth.js";
import { parseJson } from "../../lib/http.js";
import { notFound, unprocessable } from "../../lib/errors.js";
import { requireGroupAdmin, requireGroupMember } from "../../lib/guards.js";
import {
  type GroupDetailResponse,
  type MemberResponse,
} from "../../lib/presenters.js";
import { computeUserNetCents, centsToMoney } from "../../lib/balances.js";
import { notify } from "../../lib/notify.js";
import { lastActivityForGroups } from "./list-meta.js";

import { groupCategories } from "./categories.js";
import { groupTags } from "./tags.js";
import { groupMembersRoutes, listMembers } from "./members.js";
import { groupInviteCode } from "./invite-code.js";
import { groupInviteEmailRoutes } from "./invite-email.js";
import { groupTrackedInvites } from "./invites.js";
import { groupExpenses } from "./expenses.js";
import { groupBalances } from "./balances.js";
import { groupSettlements } from "./settlements.js";
import { groupBudgets } from "./budgets.js";
import { groupAnalytics } from "./analytics.js";
import { groupAudit } from "./audit.js";
import { groupActivity } from "./activity.js";
import { groupDashboard } from "./dashboard.js";
import { groupResidents } from "./residents.js";
import { groupBillTemplates } from "./bill-templates.js";
import { groupBills } from "./bills.js";
import { groupAssets } from "./assets.js";
import { groupDeposits } from "./deposits.js";

export const groupsRouter = new Hono<{ Variables: AuthVariables }>();

groupsRouter.use("*", requireAuth);

// ---------- top-level group CRUD ---------------------------------------

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  type: z.enum(["household", "personal"]).optional(),
  city: z.string().trim().max(120).nullable().optional(),
  locality: z.string().trim().max(120).nullable().optional(),
  apartmentName: z.string().trim().max(160).nullable().optional(),
  unitLabel: z.string().trim().max(120).nullable().optional(),
  expectedResidentCount: z.number().int().min(1).max(100).nullable().optional(),
  billingDay: z.number().int().min(1).max(31).nullable().optional(),
  coverFileId: z.string().uuid().nullable().optional(),
});

groupsRouter.post("/", async (c) => {
  const actor = c.get("user");
  const body = await parseJson(c, createSchema);
  const [created] = await db
    .insert(groups)
    .values({
        name: body.name,
        description: body.description ?? null,
        type: body.type ?? "household",
        city: body.city ?? null,
        locality: body.locality ?? null,
        apartmentName: body.apartmentName ?? null,
        unitLabel: body.unitLabel ?? null,
        expectedResidentCount: body.expectedResidentCount ?? null,
        billingDay: body.billingDay ?? null,
        coverFileId: body.coverFileId ?? null,
        createdById: actor.id,
      })
      .returning();
  if (!created) throw new Error("group insert returned no row");

  await db
    .insert(groupMembers)
    .values({
      groupId: created.id,
      userId: actor.id,
      role: "admin",
      status: "active",
      moveInDate: new Date().toISOString().slice(0, 10),
    });

  await notify({ kind: "group_created", groupId: created.id, recipientId: actor.id });

  return c.json(await loadGroupDetail(created.id, actor.id), 201);
});

groupsRouter.get("/", async (c) => {
  const actor = c.get("user");
  const typeFilter = c.req.query("type");

  const whereClauses = [eq(groupMembers.userId, actor.id), ne(groupMembers.status, "left")];
  if (typeFilter === "household" || typeFilter === "personal") {
    whereClauses.push(eq(groups.type, typeFilter));
  }

  const rows = await db
    .select({
      group: groups,
      member: groupMembers,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(...whereClauses))
    .orderBy(desc(groups.updatedAt));

  const ids = rows.map((r) => r.group.id);

  // memberCount per group.
  const counts = ids.length
    ? await db
        .select({
          groupId: groupMembers.groupId,
          n: sql<number>`count(*)::int`,
        })
        .from(groupMembers)
        .where(and(inArray(groupMembers.groupId, ids), ne(groupMembers.status, "left")))
        .groupBy(groupMembers.groupId)
    : [];
  const countByGroup = new Map(counts.map((c) => [c.groupId, c.n]));

  // Balance and lastActivity per group — done in parallel, one balance call
  // per group (cheap for typical N<20).
  const [activityMap, balanceCentsByGroup] = await Promise.all([
    lastActivityForGroups(ids),
    Promise.all(
      ids.map(async (id) => {
        const nets = await computeUserNetCents(id);
        return [id, nets.get(actor.id) ?? 0] as const;
      }),
    ).then((arr) => new Map(arr)),
  ]);

  return c.json(
    rows.map((r) => ({
      id: r.group.id,
      name: r.group.name,
      type: r.group.type,
      description: r.group.description,
      city: r.group.city,
      locality: r.group.locality,
      apartmentName: r.group.apartmentName,
      unitLabel: r.group.unitLabel,
      expectedResidentCount: r.group.expectedResidentCount,
      billingDay: r.group.billingDay,
      coverFileId: r.group.coverFileId,
      status: r.group.status,
      memberCount: countByGroup.get(r.group.id) ?? 0,
      yourRole: r.member.role,
      yourBalance: centsToMoney(balanceCentsByGroup.get(r.group.id) ?? 0),
      lastActivityAt: activityMap.get(r.group.id)?.toISOString() ?? null,
    })),
  );
});

groupsRouter.get("/:groupId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  return c.json(await loadGroupDetail(groupId, actor.id));
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  locality: z.string().trim().max(120).nullable().optional(),
  apartmentName: z.string().trim().max(160).nullable().optional(),
  unitLabel: z.string().trim().max(120).nullable().optional(),
  expectedResidentCount: z.number().int().min(1).max(100).nullable().optional(),
  billingDay: z.number().int().min(1).max(31).nullable().optional(),
  coverFileId: z.string().uuid().nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

groupsRouter.put("/:groupId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupAdmin(groupId, actor.id);
  const body = await parseJson(c, updateSchema);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description;
  if (body.city !== undefined) patch.city = body.city;
  if (body.locality !== undefined) patch.locality = body.locality;
  if (body.apartmentName !== undefined) patch.apartmentName = body.apartmentName;
  if (body.unitLabel !== undefined) patch.unitLabel = body.unitLabel;
  if (body.expectedResidentCount !== undefined) patch.expectedResidentCount = body.expectedResidentCount;
  if (body.billingDay !== undefined) patch.billingDay = body.billingDay;
  if (body.coverFileId !== undefined) patch.coverFileId = body.coverFileId;
  if (body.status !== undefined) patch.status = body.status;

  const [updated] = await db
    .update(groups)
    .set(patch)
    .where(eq(groups.id, groupId))
    .returning();
  if (!updated) throw notFound("Group not found");
  return c.json(await loadGroupDetail(groupId, actor.id));
});

groupsRouter.delete("/:groupId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupAdmin(groupId, actor.id);

  const nets = await computeUserNetCents(groupId);
  for (const [, n] of nets) {
    if (n !== 0) {
      throw unprocessable("Outstanding balances exist", "UNSETTLED_BALANCES");
    }
  }

  // FK cascades handle expense_participants/expense_tags/settlements/
  // expenses/tags/categories/group_members — so dropping the group row is
  // enough. If we ever turn off cascade we'd need to mirror deleteGroupCascade
  // from the reference here.
  const deleted = await db
    .delete(groups)
    .where(eq(groups.id, groupId))
    .returning({ id: groups.id });
  if (deleted.length === 0) throw notFound("Group not found");
  return c.body(null, 204);
});

// ---------- helpers ----------------------------------------------------

async function loadGroupDetail(
  groupId: string,
  viewerId: string,
): Promise<GroupDetailResponse> {
  const [group] = await db
    .select()
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) throw notFound("Group not found");

  const members = await listMembers(groupId);
  const [{ pendingInviteCount }] = (await db
    .select({ pendingInviteCount: sql<number>`count(*)::int` })
    .from(groupInvites)
    .where(and(eq(groupInvites.groupId, groupId), eq(groupInvites.status, "pending")))) as [
    { pendingInviteCount: number },
  ];
  const [creator] = await db
    .select()
    .from(users)
    .where(eq(users.id, group.createdById))
    .limit(1);

  const viewerMember: MemberResponse | undefined = members.find(
    (m) => m.userId === viewerId,
  );
  const viewerIsAdmin = viewerMember?.role === "admin";

  const out: GroupDetailResponse = {
    id: group.id,
    name: group.name,
    type: group.type,
    description: group.description,
    city: group.city,
    locality: group.locality,
    apartmentName: group.apartmentName,
    unitLabel: group.unitLabel,
    expectedResidentCount: group.expectedResidentCount,
    billingDay: group.billingDay,
    coverFileId: group.coverFileId,
    status: group.status,
    createdBy: { id: group.createdById, name: (creator as User | undefined)?.name ?? "" },
    members,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
  out.pendingInviteCount = pendingInviteCount;
  if (viewerIsAdmin) out.inviteCode = group.inviteCode;
  return out;
}

// ---------- mount nested routers ---------------------------------------

groupsRouter.route("/:groupId/members", groupMembersRoutes);
groupsRouter.route("/:groupId/residents", groupResidents);
groupsRouter.route("/:groupId/invite-code", groupInviteCode);
groupsRouter.route("/:groupId/invite-email", groupInviteEmailRoutes);
groupsRouter.route("/:groupId/invites", groupTrackedInvites);
groupsRouter.route("/:groupId/categories", groupCategories);
groupsRouter.route("/:groupId/tags", groupTags);
groupsRouter.route("/:groupId/expenses", groupExpenses);
groupsRouter.route("/:groupId/bill-templates", groupBillTemplates);
groupsRouter.route("/:groupId/bills", groupBills);
groupsRouter.route("/:groupId/assets", groupAssets);
groupsRouter.route("/:groupId/deposits", groupDeposits);
groupsRouter.route("/:groupId/balances", groupBalances);
groupsRouter.route("/:groupId/settlements", groupSettlements);
groupsRouter.route("/:groupId/budgets", groupBudgets);
groupsRouter.route("/:groupId/analytics", groupAnalytics);
groupsRouter.route("/:groupId/audit", groupAudit);
groupsRouter.route("/:groupId/activity", groupActivity);
groupsRouter.route("/:groupId/dashboard", groupDashboard);

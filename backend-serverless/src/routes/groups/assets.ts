import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, txClient } from "../../db/client.js";
import { assetOwnerships, assets } from "../../db/schema/assets.js";
import { groupMembers } from "../../db/schema/groups.js";
import { users } from "../../db/schema/users.js";
import { type AuthVariables } from "../../lib/auth.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { requireGroupMember } from "../../lib/guards.js";
import { parseJson } from "../../lib/http.js";
import { isMoneyString } from "../../lib/money.js";

export const groupAssets = new Hono<{ Variables: AuthVariables }>();

const ownershipSchema = z.object({
  userId: z.string().uuid(),
  ownershipPercent: z.string().nullable().optional(),
  ownershipAmount: z.string().nullable().optional(),
});

const assetSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().max(120).nullable().optional(),
  photoFileId: z.string().uuid().nullable().optional(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  purchaseAmount: z.string().nullable().optional(),
  purchaseExpenseId: z.string().uuid().nullable().optional(),
  currentHolderUserId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  ownerships: z.array(ownershipSchema).optional(),
});

const SHARE_RE = /^\d+(\.\d{1,4})?$/;

function normalizeAssetMoney(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (!isMoneyString(value)) {
    throw badRequest("money fields must be valid money strings", "INVALID_MONEY");
  }
  return value;
}

function normalizeOwnershipPercent(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (!SHARE_RE.test(value)) {
    throw badRequest(
      "ownershipPercent must be a numeric string with up to 4 decimals",
      "INVALID_OWNERSHIP_PERCENT",
    );
  }
  return value;
}

async function assertResidentsExist(groupId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        inArray(groupMembers.userId, userIds),
      ),
    );
  const found = new Set(rows.map((row) => row.userId));
  for (const userId of userIds) {
    if (!found.has(userId)) throw notFound("Resident not found");
  }
}

async function presentAssets(rows: typeof assets.$inferSelect[]) {
  if (rows.length === 0) return [];
  const assetIds = rows.map((row) => row.id);
  const ownershipRows = await db
    .select({
      ownership: assetOwnerships,
      user: users,
    })
    .from(assetOwnerships)
    .innerJoin(users, eq(users.id, assetOwnerships.userId))
    .where(inArray(assetOwnerships.assetId, assetIds));

  const ownershipsByAsset = new Map<string, typeof ownershipRows>();
  for (const row of ownershipRows) {
    const list = ownershipsByAsset.get(row.ownership.assetId) ?? [];
    list.push(row);
    ownershipsByAsset.set(row.ownership.assetId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    photoFileId: row.photoFileId,
    purchaseDate: row.purchaseDate,
    purchaseAmount: row.purchaseAmount,
    purchaseExpenseId: row.purchaseExpenseId,
    status: row.status,
    currentHolderUserId: row.currentHolderUserId,
    notes: row.notes,
    ownerships: (ownershipsByAsset.get(row.id) ?? []).map((item) => ({
      userId: item.user.id,
      name: item.user.name,
      avatarUrl: item.user.avatarUrl,
      ownershipPercent: item.ownership.ownershipPercent,
      ownershipAmount: item.ownership.ownershipAmount,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

groupAssets.get("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const rows = await db.select().from(assets).where(eq(assets.groupId, groupId));
  return c.json({ assets: await presentAssets(rows) });
});

groupAssets.post("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  const body = await parseJson(c, assetSchema);

  const relevantUserIds = [
    body.currentHolderUserId,
    ...(body.ownerships ?? []).map((entry) => entry.userId),
  ].filter((id): id is string => !!id);
  await assertResidentsExist(groupId, Array.from(new Set(relevantUserIds)));

  const tx = txClient();
  const asset = await tx.transaction(async (tx2) => {
    const [created] = await tx2
      .insert(assets)
      .values({
        groupId,
        name: body.name,
        category: body.category ?? null,
        photoFileId: body.photoFileId ?? null,
        purchaseDate: body.purchaseDate ?? null,
        purchaseAmount: normalizeAssetMoney(body.purchaseAmount),
        purchaseExpenseId: body.purchaseExpenseId ?? null,
        currentHolderUserId: body.currentHolderUserId ?? null,
        notes: body.notes ?? null,
      })
      .returning();
    if (!created) throw new Error("asset insert returned no row");

    if (body.ownerships && body.ownerships.length > 0) {
        await tx2.insert(assetOwnerships).values(
          body.ownerships.map((entry) => ({
            assetId: created.id,
            userId: entry.userId,
            ownershipPercent: normalizeOwnershipPercent(entry.ownershipPercent),
            ownershipAmount: normalizeAssetMoney(entry.ownershipAmount),
          })),
        );
    }

    return created;
  });

  return c.json({ asset: (await presentAssets([asset]))[0] }, 201);
});

groupAssets.put("/:assetId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const assetId = c.req.param("assetId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  const body = await parseJson(c, assetSchema);

  const relevantUserIds = [
    body.currentHolderUserId,
    ...(body.ownerships ?? []).map((entry) => entry.userId),
  ].filter((id): id is string => !!id);
  await assertResidentsExist(groupId, Array.from(new Set(relevantUserIds)));

  const tx = txClient();
  await tx.transaction(async (tx2) => {
    const updated = await tx2
      .update(assets)
      .set({
        name: body.name,
        category: body.category ?? null,
        photoFileId: body.photoFileId ?? null,
        purchaseDate: body.purchaseDate ?? null,
        purchaseAmount: normalizeAssetMoney(body.purchaseAmount),
        purchaseExpenseId: body.purchaseExpenseId ?? null,
        currentHolderUserId: body.currentHolderUserId ?? null,
        notes: body.notes ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(assets.groupId, groupId), eq(assets.id, assetId)))
      .returning();
    if (updated.length === 0) throw notFound("Asset not found");

    if (body.ownerships) {
      await tx2.delete(assetOwnerships).where(eq(assetOwnerships.assetId, assetId));
      if (body.ownerships.length > 0) {
        await tx2.insert(assetOwnerships).values(
          body.ownerships.map((entry) => ({
            assetId,
            userId: entry.userId,
            ownershipPercent: normalizeOwnershipPercent(entry.ownershipPercent),
            ownershipAmount: normalizeAssetMoney(entry.ownershipAmount),
          })),
        );
      }
    }
  });

  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.groupId, groupId), eq(assets.id, assetId)))
    .limit(1);
  if (!asset) throw notFound("Asset not found");
  return c.json({ asset: (await presentAssets([asset]))[0] });
});

const transferSchema = z.object({
  currentHolderUserId: z.string().uuid().nullable(),
  ownerships: z.array(ownershipSchema).optional(),
});

groupAssets.post("/:assetId/transfer", async (c) => {
  const groupId = c.req.param("groupId")!;
  const assetId = c.req.param("assetId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  const body = await parseJson(c, transferSchema);

  const relevantUserIds = [
    body.currentHolderUserId,
    ...(body.ownerships ?? []).map((entry) => entry.userId),
  ].filter((id): id is string => !!id);
  await assertResidentsExist(groupId, Array.from(new Set(relevantUserIds)));

  const tx = txClient();
  await tx.transaction(async (tx2) => {
    const updated = await tx2
      .update(assets)
      .set({
        currentHolderUserId: body.currentHolderUserId ?? null,
        status: body.currentHolderUserId ? "transferred" : "active",
        updatedAt: new Date(),
      })
      .where(and(eq(assets.groupId, groupId), eq(assets.id, assetId)))
      .returning();
    if (updated.length === 0) throw notFound("Asset not found");

    if (body.ownerships) {
      await tx2.delete(assetOwnerships).where(eq(assetOwnerships.assetId, assetId));
      if (body.ownerships.length > 0) {
        await tx2.insert(assetOwnerships).values(
          body.ownerships.map((entry) => ({
            assetId,
            userId: entry.userId,
            ownershipPercent: normalizeOwnershipPercent(entry.ownershipPercent),
            ownershipAmount: normalizeAssetMoney(entry.ownershipAmount),
          })),
        );
      }
    }
  });

  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.groupId, groupId), eq(assets.id, assetId)))
    .limit(1);
  if (!asset) throw notFound("Asset not found");
  return c.json({ asset: (await presentAssets([asset]))[0] });
});

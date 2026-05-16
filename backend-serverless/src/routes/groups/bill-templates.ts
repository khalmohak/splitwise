import { Hono } from "hono";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { billTemplates } from "../../db/schema/bill-templates.js";
import { groupMembers } from "../../db/schema/groups.js";
import { users } from "../../db/schema/users.js";
import { type AuthVariables } from "../../lib/auth.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { requireGroupAdmin, requireGroupMember } from "../../lib/guards.js";
import { parseJson } from "../../lib/http.js";
import { isMoneyString } from "../../lib/money.js";

export const groupBillTemplates = new Hono<{ Variables: AuthVariables }>();

function presentTemplate(
  template: typeof billTemplates.$inferSelect,
  defaultPayer?: typeof users.$inferSelect,
) {
  return {
    id: template.id,
    name: template.name,
    billKind: template.billKind,
    vendorName: template.vendorName,
    amountMode: template.amountMode,
    defaultAmount: template.defaultAmount,
    currency: template.currency,
    dueDay: template.dueDay,
    cadence: template.cadence,
    defaultPayer: defaultPayer
      ? {
          id: defaultPayer.id,
          name: defaultPayer.name,
          avatarUrl: defaultPayer.avatarUrl,
        }
      : null,
    splitStrategy: template.splitStrategy,
    splitConfig: template.splitConfig,
    collectProofImage: template.collectProofImage,
    isActive: template.isActive,
    notes: template.notes,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

const templateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  billKind: z
    .enum([
      "rent",
      "electricity",
      "maid",
      "cook",
      "wifi",
      "maintenance",
      "water",
      "gas",
      "subscription",
      "other",
    ])
    .optional(),
  vendorName: z.string().trim().max(160).nullable().optional(),
  amountMode: z.enum(["fixed", "variable"]).optional(),
  defaultAmount: z.string().nullable().optional(),
  currency: z.string().trim().length(3).optional(),
  dueDay: z.number().int().min(1).max(31),
  cadence: z.enum(["weekly", "monthly", "yearly"]).optional(),
  defaultPayerUserId: z.string().uuid().nullable().optional(),
  splitStrategy: z
    .enum(["equal_active_residents", "fixed_shares", "room_based", "custom_snapshot"])
    .optional(),
  splitConfig: z.record(z.unknown()).nullable().optional(),
  collectProofImage: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

async function assertResidentEligible(groupId: string, userId: string | null | undefined) {
  if (!userId) return;
  const [member] = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        ne(groupMembers.status, "left"),
      ),
    )
    .limit(1);
  if (!member) throw notFound("Resident not found");
}

function normalizeTemplateInput(body: z.infer<typeof templateSchema>) {
  if (body.defaultAmount != null && body.defaultAmount !== "" && !isMoneyString(body.defaultAmount)) {
    throw badRequest("defaultAmount must be a money string", "INVALID_DEFAULT_AMOUNT");
  }
  return {
    name: body.name,
    billKind: body.billKind ?? "other",
    vendorName: body.vendorName ?? null,
    amountMode: body.amountMode ?? "fixed",
    defaultAmount: body.defaultAmount ?? null,
    currency: (body.currency ?? "INR").toUpperCase(),
    dueDay: body.dueDay,
    cadence: body.cadence ?? "monthly",
    defaultPayerUserId: body.defaultPayerUserId ?? null,
    splitStrategy: body.splitStrategy ?? "equal_active_residents",
    splitConfig: body.splitConfig ?? null,
    collectProofImage: body.collectProofImage ?? false,
    isActive: body.isActive ?? true,
    notes: body.notes ?? null,
  } as const;
}

groupBillTemplates.get("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const rows = await db.select().from(billTemplates).where(eq(billTemplates.groupId, groupId));
  const payerIds = Array.from(
    new Set(rows.map((row) => row.defaultPayerUserId).filter((id): id is string => !!id)),
  );
  const payers = payerIds.length
    ? await db.select().from(users).where(inArray(users.id, payerIds))
    : [];
  const payerById = new Map(payers.map((row) => [row.id, row]));

  return c.json({
    templates: rows.map((row) => presentTemplate(row, payerById.get(row.defaultPayerUserId ?? ""))),
  });
});

groupBillTemplates.post("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupAdmin(groupId, actor.id);
  const body = normalizeTemplateInput(await parseJson(c, templateSchema));
  await assertResidentEligible(groupId, body.defaultPayerUserId);

  const [row] = await db
    .insert(billTemplates)
    .values({
      groupId,
      ...body,
    })
    .returning();
  if (!row) throw new Error("bill template insert returned no row");

  const payer = body.defaultPayerUserId
    ? (await db.select().from(users).where(eq(users.id, body.defaultPayerUserId)).limit(1))[0]
    : undefined;
  return c.json({ template: presentTemplate(row, payer) }, 201);
});

groupBillTemplates.put("/:templateId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const templateId = c.req.param("templateId")!;
  const actor = c.get("user");
  await requireGroupAdmin(groupId, actor.id);
  const body = normalizeTemplateInput(await parseJson(c, templateSchema));
  await assertResidentEligible(groupId, body.defaultPayerUserId);

  const [row] = await db
    .update(billTemplates)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(billTemplates.groupId, groupId), eq(billTemplates.id, templateId)))
    .returning();
  if (!row) throw notFound("Bill template not found");

  const payer = body.defaultPayerUserId
    ? (await db.select().from(users).where(eq(users.id, body.defaultPayerUserId)).limit(1))[0]
    : undefined;
  return c.json({ template: presentTemplate(row, payer) });
});

groupBillTemplates.post("/:templateId/pause", async (c) => {
  const groupId = c.req.param("groupId")!;
  const templateId = c.req.param("templateId")!;
  const actor = c.get("user");
  await requireGroupAdmin(groupId, actor.id);

  const [row] = await db
    .update(billTemplates)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(billTemplates.groupId, groupId), eq(billTemplates.id, templateId)))
    .returning();
  if (!row) throw notFound("Bill template not found");
  return c.json({ template: presentTemplate(row) });
});

groupBillTemplates.post("/:templateId/resume", async (c) => {
  const groupId = c.req.param("groupId")!;
  const templateId = c.req.param("templateId")!;
  const actor = c.get("user");
  await requireGroupAdmin(groupId, actor.id);

  const [row] = await db
    .update(billTemplates)
    .set({ isActive: true, updatedAt: new Date() })
    .where(and(eq(billTemplates.groupId, groupId), eq(billTemplates.id, templateId)))
    .returning();
  if (!row) throw notFound("Bill template not found");
  return c.json({ template: presentTemplate(row) });
});

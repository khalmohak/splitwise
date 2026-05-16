import { Hono } from "hono";
import { and, asc, desc, eq, gte, ilike, inArray, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, txClient } from "../../db/client.js";
import { expenses, type Expense } from "../../db/schema/expenses.js";
import { expenseParticipants } from "../../db/schema/expense-participants.js";
import { expenseItems } from "../../db/schema/expense-items.js";
import { tags, expenseTags } from "../../db/schema/tags.js";
import { categories } from "../../db/schema/categories.js";
import { uploadedFiles } from "../../db/schema/uploaded-files.js";
import { groupMembers } from "../../db/schema/groups.js";
import { users, type User } from "../../db/schema/users.js";
import { type AuthVariables } from "../../lib/auth.js";
import { parseJson } from "../../lib/http.js";
import {
  conflict,
  forbidden,
  notFound,
  unprocessable,
  validationError,
} from "../../lib/errors.js";
import { requireGroupMember } from "../../lib/guards.js";
import {
  isMoneyString,
  parseMoneyToCents,
  splitByWeights,
  splitEqual,
} from "../../lib/money.js";
import { isDateOnly } from "../../lib/date-utils.js";
import { buildPaginationMeta, parsePagination } from "../../lib/pagination.js";
import { recordAudit, diffSnapshots } from "../../lib/audit.js";
import { notify } from "../../lib/notify.js";
import { chatJson, hasOpenAI } from "../../lib/openai.js";
import { presignGet } from "../../lib/s3.js";

export const groupExpenses = new Hono<{ Variables: AuthVariables }>();

// ---------- input shapes ----------------------------------------------------

const SPLIT_TYPES = ["equal", "exact", "percentage", "shares"] as const;
const RECUR_INTERVALS = ["weekly", "monthly", "yearly"] as const;

const participantSchema = z.object({
  userId: z.string().uuid(),
  shareAmount: z.string().optional(),
  splitInput: z.string().optional(),
});

const itemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.string().nullable().optional(),
  unitPrice: z.string().nullable().optional(),
  totalPrice: z.string(),
  categoryId: z.string().uuid().nullable().optional(),
  sourceFileId: z.string().uuid().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

const expenseInputSchemaRaw = z.object({
  description: z.string().trim().min(1).max(200),
  amount: z.string(),
  paidById: z.string().uuid(),
  date: z.string(),
  categoryId: z.string().uuid().nullish(),
  splitType: z.enum(SPLIT_TYPES),
  participants: z.array(participantSchema).min(1),
  tagIds: z.array(z.string().uuid()).optional(),
  notes: z.string().nullish(),
  isRecurring: z.boolean().optional(),
  recurInterval: z.enum(RECUR_INTERVALS).nullish(),
  recurAnchor: z.string().nullish(),
  items: z.array(itemSchema).max(200).optional(),
  attachmentFileIds: z.array(z.string().uuid()).optional(),
});

// Normalize defaults outside the schema so the inferred type stays clean.
type ExpenseInput = Omit<
  z.infer<typeof expenseInputSchemaRaw>,
  "categoryId" | "notes" | "recurInterval" | "recurAnchor" | "tagIds" | "isRecurring"
> & {
  categoryId: string | null;
  notes: string | null;
  recurInterval: (typeof RECUR_INTERVALS)[number] | null;
  recurAnchor: string | null;
  tagIds: string[];
  isRecurring: boolean;
};

function normalizeExpenseInput(raw: z.infer<typeof expenseInputSchemaRaw>): ExpenseInput {
  return {
    ...raw,
    categoryId: raw.categoryId ?? null,
    notes: raw.notes ?? null,
    recurInterval: raw.recurInterval ?? null,
    recurAnchor: raw.recurAnchor ?? null,
    tagIds: raw.tagIds ?? [],
    isRecurring: raw.isRecurring ?? false,
  };
}

const expenseInputSchema = expenseInputSchemaRaw;

// ---------- validation + split math ----------------------------------------

type ComputedSplit = {
  userId: string;
  shareAmount: string;
  splitInput: string | null;
};

function validateAndComputeSplits(
  input: ExpenseInput,
  groupMemberIds: Set<string>,
): ComputedSplit[] {
  const fieldErrors: Record<string, string> = {};

  if (!isMoneyString(input.amount)) fieldErrors.amount = "Must be a money string";
  if (!isDateOnly(input.date)) fieldErrors.date = "Must be YYYY-MM-DD";
  if (input.isRecurring) {
    if (!input.recurInterval) fieldErrors.recurInterval = "Required when recurring";
    if (!input.recurAnchor || !isDateOnly(input.recurAnchor))
      fieldErrors.recurAnchor = "Must be YYYY-MM-DD when recurring";
  }
  if (input.participants.length === 0)
    fieldErrors.participants = "At least one participant required";

  // Duplicate participants are a client-side bug.
  const seen = new Set<string>();
  for (const p of input.participants) {
    if (seen.has(p.userId)) {
      fieldErrors.participants = "Duplicate participant";
      break;
    }
    seen.add(p.userId);
  }

  if (Object.keys(fieldErrors).length) throw validationError(fieldErrors);

  // Membership check: payer + every participant must be a group member.
  if (!groupMemberIds.has(input.paidById)) {
    throw unprocessable("Payer must be a group member");
  }
  for (const p of input.participants) {
    if (!groupMemberIds.has(p.userId)) {
      throw unprocessable("Participant must be a group member");
    }
  }

  const totalCents = parseMoneyToCents(input.amount);

  switch (input.splitType) {
    case "equal": {
      const shares = splitEqual(input.amount, input.participants.length);
      return input.participants.map((p, i) => ({
        userId: p.userId,
        shareAmount: shares[i]!,
        splitInput: null,
      }));
    }
    case "exact": {
      // Each participant must provide a shareAmount; sum must equal total.
      const shares: string[] = [];
      for (const p of input.participants) {
        if (!p.shareAmount || !isMoneyString(p.shareAmount)) {
          throw validationError({ participants: "shareAmount required for exact split" });
        }
        shares.push(p.shareAmount);
      }
      const sumCents = shares.reduce((a, s) => a + parseMoneyToCents(s), 0);
      if (sumCents !== totalCents) {
        throw unprocessable("Exact splits must sum to total");
      }
      return input.participants.map((p, i) => ({
        userId: p.userId,
        shareAmount: shares[i]!,
        splitInput: shares[i]!,
      }));
    }
    case "percentage": {
      const weights: number[] = [];
      for (const p of input.participants) {
        if (!p.splitInput) {
          throw validationError({ participants: "splitInput required for percentage" });
        }
        const n = Number(p.splitInput);
        if (!Number.isFinite(n) || n < 0) {
          throw validationError({ participants: "Invalid percentage" });
        }
        weights.push(n);
      }
      const sum = weights.reduce((a, b) => a + b, 0);
      // Tolerate floating-point sum within 0.001 of 100.
      if (Math.abs(sum - 100) > 0.001) {
        throw unprocessable("Percentages must sum to 100");
      }
      const shares = splitByWeights(input.amount, weights);
      return input.participants.map((p, i) => ({
        userId: p.userId,
        shareAmount: shares[i]!,
        splitInput: p.splitInput!,
      }));
    }
    case "shares": {
      const weights: number[] = [];
      for (const p of input.participants) {
        if (!p.splitInput) {
          throw validationError({ participants: "splitInput required for shares" });
        }
        const n = Number(p.splitInput);
        if (!Number.isFinite(n) || n <= 0) {
          throw validationError({ participants: "Invalid share count" });
        }
        weights.push(n);
      }
      const shares = splitByWeights(input.amount, weights);
      return input.participants.map((p, i) => ({
        userId: p.userId,
        shareAmount: shares[i]!,
        splitInput: p.splitInput!,
      }));
    }
  }
}

async function loadGroupMemberIds(groupId: string): Promise<Set<string>> {
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), ne(groupMembers.status, "left")));
  return new Set(rows.map((r) => r.userId));
}

async function assertCategoryInGroup(
  groupId: string,
  categoryId: string | null,
): Promise<void> {
  if (!categoryId) return;
  const [c] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  if (!c) throw notFound("Category not found");
  // System categories (groupId IS NULL) are also allowed.
  if (c.groupId && c.groupId !== groupId) {
    throw notFound("Category not in this group");
  }
}

async function assertTagsInGroup(groupId: string, tagIds: string[]): Promise<void> {
  if (tagIds.length === 0) return;
  const rows = await db
    .select({ id: tags.id, groupId: tags.groupId })
    .from(tags)
    .where(inArray(tags.id, tagIds));
  if (rows.length !== tagIds.length) throw notFound("Tag not found");
  for (const t of rows) if (t.groupId !== groupId) throw notFound("Tag not in this group");
}

// Attachments: caller must own each file. Each file may only be attached
// to a single expense at a time.
async function attachFilesToExpense(
  ownerId: string,
  expenseId: string,
  fileIds: string[] | undefined,
): Promise<void> {
  if (!fileIds || fileIds.length === 0) return;
  const rows = await db
    .select()
    .from(uploadedFiles)
    .where(inArray(uploadedFiles.id, fileIds));
  if (rows.length !== fileIds.length) throw notFound("Attachment not found");
  for (const f of rows) {
    if (f.ownerId !== ownerId) throw notFound("Attachment not found");
    if (f.expenseId && f.expenseId !== expenseId) {
      throw conflict("Attachment already on another expense");
    }
  }
  await db
    .update(uploadedFiles)
    .set({ expenseId })
    .where(inArray(uploadedFiles.id, fileIds));
}

// ---------- presenter ------------------------------------------------------

type ExpenseResponseOptions = {
  viewerId?: string;
  includeDetail?: boolean;
};

async function presentExpenses(
  rows: Expense[],
  opts: ExpenseResponseOptions = {},
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [parts, tagRows, itemRows, attachmentRows, payerUsers, creatorUsers, categoryRows] =
    await Promise.all([
      db
        .select({
          ep: expenseParticipants,
          user: users,
        })
        .from(expenseParticipants)
        .innerJoin(users, eq(users.id, expenseParticipants.userId))
        .where(inArray(expenseParticipants.expenseId, ids)),
      db
        .select({
          expenseId: expenseTags.expenseId,
          tag: tags,
        })
        .from(expenseTags)
        .innerJoin(tags, eq(tags.id, expenseTags.tagId))
        .where(inArray(expenseTags.expenseId, ids)),
      opts.includeDetail
        ? db
            .select()
            .from(expenseItems)
            .where(inArray(expenseItems.expenseId, ids))
            .orderBy(asc(expenseItems.position))
        : Promise.resolve([]),
      opts.includeDetail
        ? db
            .select()
            .from(uploadedFiles)
            .where(inArray(uploadedFiles.expenseId, ids))
        : Promise.resolve([]),
      db
        .select()
        .from(users)
        .where(
          inArray(
            users.id,
            Array.from(new Set(rows.map((r) => r.paidById))),
          ),
        ),
      opts.includeDetail
        ? db
            .select()
            .from(users)
            .where(
              inArray(
                users.id,
                Array.from(new Set(rows.map((r) => r.createdById))),
              ),
            )
        : Promise.resolve([] as User[]),
      (async () => {
        const catIds = Array.from(
          new Set(rows.map((r) => r.categoryId).filter((x): x is string => !!x)),
        );
        if (catIds.length === 0) return [];
        return db.select().from(categories).where(inArray(categories.id, catIds));
      })(),
    ]);

  const payerById = new Map(payerUsers.map((u) => [u.id, u]));
  const creatorById = new Map((creatorUsers as User[]).map((u) => [u.id, u]));
  const categoryById = new Map(categoryRows.map((c) => [c.id, c]));

  const partsByExpense = new Map<string, typeof parts>();
  for (const p of parts) {
    const list = partsByExpense.get(p.ep.expenseId) ?? [];
    list.push(p);
    partsByExpense.set(p.ep.expenseId, list);
  }
  const tagsByExpense = new Map<string, typeof tagRows>();
  for (const t of tagRows) {
    const list = tagsByExpense.get(t.expenseId) ?? [];
    list.push(t);
    tagsByExpense.set(t.expenseId, list);
  }
  const itemsByExpense = new Map<string, typeof itemRows>();
  for (const it of itemRows) {
    const list = itemsByExpense.get(it.expenseId) ?? [];
    list.push(it);
    itemsByExpense.set(it.expenseId, list);
  }
  const attachmentsByExpense = new Map<string, typeof attachmentRows>();
  for (const a of attachmentRows) {
    if (!a.expenseId) continue;
    const list = attachmentsByExpense.get(a.expenseId) ?? [];
    list.push(a);
    attachmentsByExpense.set(a.expenseId, list);
  }

  return Promise.all(
    rows.map(async (r) => {
      const payer = payerById.get(r.paidById);
      const cat = r.categoryId ? categoryById.get(r.categoryId) : undefined;
      const expenseParts = partsByExpense.get(r.id) ?? [];
      const tagItems = tagsByExpense.get(r.id) ?? [];

      const out: Record<string, unknown> = {
        id: r.id,
        description: r.description,
        amount: r.amount,
        date: r.date,
        splitType: r.splitType,
        paidBy: payer
          ? { id: payer.id, name: payer.name, avatarUrl: payer.avatarUrl }
          : null,
        category: cat
          ? {
              id: cat.id,
              name: cat.name,
              icon: cat.icon,
              color: cat.color,
              groupId: cat.groupId,
            }
          : null,
        tags: tagItems.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
        participants: expenseParts.map((p) => ({
          userId: p.user.id,
          name: p.user.name,
          avatarUrl: p.user.avatarUrl,
          shareAmount: p.ep.shareAmount,
          ...(opts.includeDetail
            ? { splitInput: p.ep.splitInput }
            : {}),
        })),
        isRecurring: r.isRecurring,
        createdAt: r.createdAt.toISOString(),
      };

      if (opts.viewerId) {
        const my = expenseParts.find((p) => p.user.id === opts.viewerId);
        if (my) out.myShare = my.ep.shareAmount;
      }

      if (opts.includeDetail) {
        out.notes = r.notes;
        out.recurInterval = r.recurInterval;
        out.recurAnchor = r.recurAnchor;
        out.updatedAt = r.updatedAt.toISOString();
        const creator = creatorById.get(r.createdById);
        out.createdBy = creator ? { id: creator.id, name: creator.name } : null;
        const items = itemsByExpense.get(r.id) ?? [];
        out.items = items.map((it) => ({
          id: it.id,
          position: it.position,
          name: it.name,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          totalPrice: it.totalPrice,
          category: it.categoryId ? categoryById.get(it.categoryId) ?? null : null,
          sourceFileId: it.sourceFileId,
        }));
        const attachments = attachmentsByExpense.get(r.id) ?? [];
        out.attachments = await Promise.all(
          attachments.map(async (a) => ({
            id: a.id,
            url: await presignGet(a.storagePath, 300).catch(() => a.publicUrl),
            mimeType: a.mimeType,
            originalName: a.originalName,
            sizeBytes: a.sizeBytes,
            kind: a.kind,
          })),
        );
      }

      return out;
    }),
  );
}

// ---------- routes ---------------------------------------------------------

// POST /preview — validate input + show splits without writing.
groupExpenses.post("/preview", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  const input = normalizeExpenseInput(await parseJson(c, expenseInputSchema));
  const memberIds = await loadGroupMemberIds(groupId);
  const splits = validateAndComputeSplits(input, memberIds);

  const userRows = await db
    .select()
    .from(users)
    .where(
      inArray(
        users.id,
        splits.map((s) => s.userId),
      ),
    );
  const nameById = new Map(userRows.map((u) => [u.id, u.name]));

  return c.json({
    amount: input.amount,
    splitType: input.splitType,
    splits: splits.map((s) => ({
      userId: s.userId,
      name: nameById.get(s.userId) ?? "",
      shareAmount: s.shareAmount,
      splitInput: s.splitInput,
    })),
  });
});

// POST /suggest — OpenAI metadata suggestion for category + tags.
const suggestSchema = z.object({ description: z.string().trim().min(1).max(500) });

groupExpenses.post("/suggest", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  const { description } = await parseJson(c, suggestSchema);

  if (!hasOpenAI()) {
    return c.json({ categoryId: null, tagIds: [] });
  }

  const [cats, tagRows] = await Promise.all([
    db.select().from(categories).where(eq(categories.groupId, groupId)),
    db.select().from(tags).where(eq(tags.groupId, groupId)),
  ]);

  const prompt = `You are a finance assistant. Given an expense description, pick the best matching category id (or null) and a list of tag ids (possibly empty) from the lists below. Return JSON like {"categoryId": "<uuid or null>", "tagIds": ["<uuid>", ...]}.

CATEGORIES:
${cats.map((c) => `- ${c.id}: ${c.name}`).join("\n") || "(none)"}

TAGS:
${tagRows.map((t) => `- ${t.id}: ${t.name}`).join("\n") || "(none)"}

DESCRIPTION: ${description}`;

  const json = await chatJson({
    model: "gpt-4o-mini",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  if (!json) return c.json({ categoryId: null, tagIds: [] });
  try {
    const parsed = JSON.parse(json) as {
      categoryId?: string | null;
      tagIds?: string[];
    };
    const validCatIds = new Set(cats.map((c) => c.id));
    const validTagIds = new Set(tagRows.map((t) => t.id));
    return c.json({
      categoryId:
        parsed.categoryId && validCatIds.has(parsed.categoryId) ? parsed.categoryId : null,
      tagIds: (parsed.tagIds ?? []).filter((id) => validTagIds.has(id)),
    });
  } catch {
    return c.json({ categoryId: null, tagIds: [] });
  }
});

// GET /recurring — same shape as list but filtered to isRecurring=true.
groupExpenses.get("/recurring", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  return c.json(await listExpenses(c, groupId, actor.id, { recurringOnly: true }));
});

// GET /export.csv — CSV export.
groupExpenses.get("/export.csv", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  return exportExpensesCsv(c, groupId);
});

// POST / — create expense.
groupExpenses.post("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const input = normalizeExpenseInput(await parseJson(c, expenseInputSchema));
  const memberIds = await loadGroupMemberIds(groupId);
  const splits = validateAndComputeSplits(input, memberIds);
  await assertCategoryInGroup(groupId, input.categoryId);
  await assertTagsInGroup(groupId, input.tagIds);

  // Transactional: expense + participants + items + tags. Attachments are
  // touched outside (they need ownership checks that can short-circuit).
  const tx = txClient();
  const newId = await tx.transaction(async (tx2) => {
    const [created] = await tx2
      .insert(expenses)
      .values({
        groupId,
        paidById: input.paidById,
        amount: input.amount,
        description: input.description,
        categoryId: input.categoryId,
        splitType: input.splitType,
        date: input.date,
        notes: input.notes,
        isRecurring: input.isRecurring,
        recurInterval: input.isRecurring ? input.recurInterval : null,
        recurAnchor: input.isRecurring ? input.recurAnchor : null,
        createdById: actor.id,
      })
      .returning();
    if (!created) throw new Error("expense insert returned nothing");

    await tx2.insert(expenseParticipants).values(
      splits.map((s) => ({
        expenseId: created.id,
        userId: s.userId,
        shareAmount: s.shareAmount,
        splitInput: s.splitInput,
      })),
    );

    if (input.tagIds.length > 0) {
      await tx2
        .insert(expenseTags)
        .values(input.tagIds.map((tagId) => ({ expenseId: created.id, tagId })));
    }

    if (input.items && input.items.length > 0) {
      await tx2.insert(expenseItems).values(
        input.items.map((it, i) => ({
          expenseId: created.id,
          position: i,
          name: it.name,
          quantity: it.quantity ?? null,
          unitPrice: it.unitPrice ?? null,
          totalPrice: it.totalPrice,
          categoryId: it.categoryId ?? null,
          sourceFileId: it.sourceFileId ?? null,
          metadata: it.metadata ?? null,
        })),
      );
    }

    return created.id;
  });

  await attachFilesToExpense(actor.id, newId, input.attachmentFileIds);

  const [created] = await db.select().from(expenses).where(eq(expenses.id, newId));
  const [presented] = await presentExpenses([created!], {
    viewerId: actor.id,
    includeDetail: true,
  });

  await recordAudit({
    groupId,
    actorId: actor.id,
    action: "created",
    resourceType: "expense",
    resourceId: newId,
    summary: `${actor.name} added "${input.description}" (${input.amount})`,
    after: presented,
  });

  const recipientIds = Array.from(
    new Set([input.paidById, ...splits.map((s) => s.userId)]),
  ).filter((id) => id !== actor.id);
  await notify({
    kind: "expense_created",
    expenseId: newId,
    groupId,
    actorId: actor.id,
    recipientIds,
  });

  return c.json(presented, 201);
});

// GET / — list expenses with filters + pagination.
groupExpenses.get("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);
  return c.json(await listExpenses(c, groupId, actor.id));
});

// GET /:expenseId — detail.
groupExpenses.get("/:expenseId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const expenseId = c.req.param("expenseId")!;
  const actor = c.get("user");
  await requireGroupMember(groupId, actor.id);

  const [row] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId)))
    .limit(1);
  if (!row) throw notFound("Expense not found");

  const [presented] = await presentExpenses([row], {
    viewerId: actor.id,
    includeDetail: true,
  });
  return c.json(presented);
});

// PUT /:expenseId — creator or admin only.
groupExpenses.put("/:expenseId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const expenseId = c.req.param("expenseId")!;
  const actor = c.get("user");
  const member = await requireGroupMember(groupId, actor.id);

  const [existing] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId)))
    .limit(1);
  if (!existing) throw notFound("Expense not found");
  if (existing.createdById !== actor.id && member.role !== "admin") {
    throw forbidden("Not allowed to edit this expense");
  }

  const input = normalizeExpenseInput(await parseJson(c, expenseInputSchema));
  const memberIds = await loadGroupMemberIds(groupId);
  const splits = validateAndComputeSplits(input, memberIds);
  await assertCategoryInGroup(groupId, input.categoryId);
  await assertTagsInGroup(groupId, input.tagIds);

  const [beforePresented] = await presentExpenses([existing], { includeDetail: true });

  const tx = txClient();
  await tx.transaction(async (tx2) => {
    await tx2
      .update(expenses)
      .set({
        paidById: input.paidById,
        amount: input.amount,
        description: input.description,
        categoryId: input.categoryId,
        splitType: input.splitType,
        date: input.date,
        notes: input.notes,
        isRecurring: input.isRecurring,
        recurInterval: input.isRecurring ? input.recurInterval : null,
        recurAnchor: input.isRecurring ? input.recurAnchor : null,
        updatedAt: new Date(),
      })
      .where(eq(expenses.id, expenseId));

    await tx2.delete(expenseParticipants).where(eq(expenseParticipants.expenseId, expenseId));
    await tx2.insert(expenseParticipants).values(
      splits.map((s) => ({
        expenseId,
        userId: s.userId,
        shareAmount: s.shareAmount,
        splitInput: s.splitInput,
      })),
    );

    await tx2.delete(expenseTags).where(eq(expenseTags.expenseId, expenseId));
    if (input.tagIds.length > 0) {
      await tx2
        .insert(expenseTags)
        .values(input.tagIds.map((tagId) => ({ expenseId, tagId })));
    }

    await tx2.delete(expenseItems).where(eq(expenseItems.expenseId, expenseId));
    if (input.items && input.items.length > 0) {
      await tx2.insert(expenseItems).values(
        input.items.map((it, i) => ({
          expenseId,
          position: i,
          name: it.name,
          quantity: it.quantity ?? null,
          unitPrice: it.unitPrice ?? null,
          totalPrice: it.totalPrice,
          categoryId: it.categoryId ?? null,
          sourceFileId: it.sourceFileId ?? null,
          metadata: it.metadata ?? null,
        })),
      );
    }
  });

  // Detach any attachments that were on this expense but are not in the new
  // list; attach the new ones.
  const currentAttachments = await db
    .select({ id: uploadedFiles.id })
    .from(uploadedFiles)
    .where(eq(uploadedFiles.expenseId, expenseId));
  const newAttachmentIds = new Set(input.attachmentFileIds ?? []);
  const toDetach = currentAttachments
    .map((a) => a.id)
    .filter((id) => !newAttachmentIds.has(id));
  if (toDetach.length > 0) {
    await db
      .update(uploadedFiles)
      .set({ expenseId: null })
      .where(inArray(uploadedFiles.id, toDetach));
  }
  await attachFilesToExpense(actor.id, expenseId, input.attachmentFileIds);

  const [updated] = await db.select().from(expenses).where(eq(expenses.id, expenseId));
  const [afterPresented] = await presentExpenses([updated!], {
    viewerId: actor.id,
    includeDetail: true,
  });

  const changed = diffSnapshots(
    beforePresented as Record<string, unknown>,
    afterPresented as Record<string, unknown>,
    [
      "description",
      "amount",
      "date",
      "splitType",
      "category",
      "tags",
      "participants",
      "notes",
      "isRecurring",
      "recurInterval",
      "recurAnchor",
      "items",
    ],
  );
  await recordAudit({
    groupId,
    actorId: actor.id,
    action: "updated",
    resourceType: "expense",
    resourceId: expenseId,
    summary: `${actor.name} edited "${input.description}"`,
    before: beforePresented,
    after: afterPresented,
    changedFields: changed,
  });

  const recipientIds = Array.from(
    new Set([input.paidById, ...splits.map((s) => s.userId)]),
  ).filter((id) => id !== actor.id);
  await notify({
    kind: "expense_updated",
    expenseId,
    groupId,
    actorId: actor.id,
    recipientIds,
  });

  return c.json(afterPresented);
});

// DELETE /:expenseId — creator or admin only.
groupExpenses.delete("/:expenseId", async (c) => {
  const groupId = c.req.param("groupId")!;
  const expenseId = c.req.param("expenseId")!;
  const actor = c.get("user");
  const member = await requireGroupMember(groupId, actor.id);

  const [existing] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId)))
    .limit(1);
  if (!existing) throw notFound("Expense not found");
  if (existing.createdById !== actor.id && member.role !== "admin") {
    throw forbidden("Not allowed to delete this expense");
  }

  const [snapshot] = await presentExpenses([existing], { includeDetail: true });
  const parts = await db
    .select({ userId: expenseParticipants.userId })
    .from(expenseParticipants)
    .where(eq(expenseParticipants.expenseId, expenseId));

  // Detach attachments so users keep their files. FKs cascade items/parts/tags.
  await db
    .update(uploadedFiles)
    .set({ expenseId: null })
    .where(eq(uploadedFiles.expenseId, expenseId));
  await db.delete(expenses).where(eq(expenses.id, expenseId));

  await recordAudit({
    groupId,
    actorId: actor.id,
    action: "deleted",
    resourceType: "expense",
    resourceId: expenseId,
    summary: `${actor.name} deleted "${existing.description}"`,
    before: snapshot,
  });

  const recipientIds = Array.from(
    new Set([existing.paidById, ...parts.map((p) => p.userId)]),
  ).filter((id) => id !== actor.id);
  await notify({
    kind: "expense_deleted",
    expenseId,
    groupId,
    actorId: actor.id,
    recipientIds,
  });

  return c.body(null, 204);
});

// ---------- list helper ----------------------------------------------------

const SORTS = { date: expenses.date, amount: expenses.amount, createdAt: expenses.createdAt };

type ListOptions = {
  recurringOnly?: boolean;
};

async function buildExpenseQuery(c: import("hono").Context, groupId: string) {
  const sort = (c.req.query("sort") ?? "date") as keyof typeof SORTS;
  const orderDir = c.req.query("order") === "asc" ? asc : desc;
  const filters = [eq(expenses.groupId, groupId)];

  const categoryId = c.req.query("categoryId");
  if (categoryId) filters.push(eq(expenses.categoryId, categoryId));

  const paidById = c.req.query("paidById");
  if (paidById) filters.push(eq(expenses.paidById, paidById));

  const splitType = c.req.query("splitType");
  if (splitType && SPLIT_TYPES.includes(splitType as (typeof SPLIT_TYPES)[number])) {
    filters.push(eq(expenses.splitType, splitType as (typeof SPLIT_TYPES)[number]));
  }

  const from = c.req.query("from");
  if (from && isDateOnly(from)) filters.push(gte(expenses.date, from));
  const to = c.req.query("to");
  if (to && isDateOnly(to)) filters.push(lte(expenses.date, to));

  const q = c.req.query("q");
  if (q && q.trim()) filters.push(ilike(expenses.description, `%${q.trim()}%`));

  const tagId = c.req.query("tagId");
  if (tagId) {
    filters.push(
      sql`EXISTS (SELECT 1 FROM ${expenseTags} et WHERE et.expense_id = ${expenses.id} AND et.tag_id = ${tagId})`,
    );
  }

  const involvesId = c.req.query("involvesId");
  if (involvesId) {
    filters.push(
      sql`(${expenses.paidById} = ${involvesId} OR EXISTS (SELECT 1 FROM ${expenseParticipants} ep WHERE ep.expense_id = ${expenses.id} AND ep.user_id = ${involvesId}))`,
    );
  }

  return { filters, sortCol: SORTS[sort] ?? SORTS.date, orderDir };
}

async function listExpenses(
  c: import("hono").Context,
  groupId: string,
  viewerId: string,
  opts: ListOptions = {},
) {
  const { page, limit } = parsePagination(c);
  const { filters, sortCol, orderDir } = await buildExpenseQuery(c, groupId);
  if (opts.recurringOnly) filters.push(eq(expenses.isRecurring, true));

  const [{ total }] = (await db
    .select({ total: sql<number>`count(*)::int` })
    .from(expenses)
    .where(and(...filters))) as [{ total: number }];

  const rows = await db
    .select()
    .from(expenses)
    .where(and(...filters))
    .orderBy(orderDir(sortCol), orderDir(expenses.createdAt))
    .offset((page - 1) * limit)
    .limit(limit);

  const data = await presentExpenses(rows, { viewerId, includeDetail: false });
  return { data, meta: buildPaginationMeta(total, page, limit) };
}

// ---------- CSV export -----------------------------------------------------

const EXPORT_MAX_ROWS = 10_000;

async function exportExpensesCsv(c: import("hono").Context, groupId: string) {
  const { filters, sortCol, orderDir } = await buildExpenseQuery(c, groupId);
  const rows = await db
    .select()
    .from(expenses)
    .where(and(...filters))
    .orderBy(orderDir(sortCol), orderDir(expenses.createdAt))
    .limit(EXPORT_MAX_ROWS);

  const presented = await presentExpenses(rows, { includeDetail: true });

  const header = [
    "Date",
    "Description",
    "Category",
    "Tags",
    "Amount",
    "Paid By",
    "Split Type",
    "Participants",
    "Notes",
    "Recurring",
    "Created At",
  ];
  const lines = [header.map(csvField).join(",")];
  for (const e of presented) {
    const exp = e as Record<string, any>;
    lines.push(
      [
        exp.date,
        exp.description,
        exp.category ? exp.category.name : "",
        (exp.tags as Array<{ name: string }>).map((t) => t.name).join("; "),
        exp.amount,
        exp.paidBy ? exp.paidBy.name : "",
        exp.splitType,
        (exp.participants as Array<{ name: string; shareAmount: string }>)
          .map((p) => `${p.name}:${p.shareAmount}`)
          .join("; "),
        exp.notes ?? "",
        exp.isRecurring ? "yes" : "no",
        exp.createdAt,
      ]
        .map(csvField)
        .join(","),
    );
  }
  const csv = lines.join("\n");

  c.header("Content-Type", "text/csv; charset=utf-8");
  const filename = `expenses-${groupId}-${new Date().toISOString().slice(0, 10)}.csv`;
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  return c.body(csv);
}

function csvField(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

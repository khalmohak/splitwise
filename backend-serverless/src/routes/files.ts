// /api/files — S3-backed file management. Uploads use a two-step flow:
//
//   1) POST /presign returns a signed PUT URL + storage key. Client PUTs the
//      bytes directly to S3 (no Lambda payload limit).
//   2) POST /commit records the DB row from the storage key.
//
// /parse-receipt and /:id/parse-receipt run OpenAI Vision against the file
// (the latter reads from S3, the former accepts inline base64 for small
// preview-style flows under the 6 MB API Gateway sync limit).

import { Hono } from "hono";
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { uploadedFiles } from "../db/schema/uploaded-files.js";
import { categories } from "../db/schema/categories.js";
import { tags } from "../db/schema/tags.js";
import { groupMembers, groups } from "../db/schema/groups.js";
import { requireAuth, type AuthVariables } from "../lib/auth.js";
import { parseJson } from "../lib/http.js";
import {
  badRequest,
  notFound,
  unprocessable,
  validationError,
} from "../lib/errors.js";
import { chatJson, hasOpenAI, type VisionModel } from "../lib/openai.js";
import {
  buildUploadStorageKey,
  deleteObject,
  isUploadStorageKeyForContext,
  mimeToStorageExt,
  presignDownload,
  presignGet,
  presignPut,
  publicStorageUrl,
  s3,
  UPLOAD_KINDS,
  type UploadKind,
} from "../lib/s3.js";
import { env } from "../lib/env.js";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

export const files = new Hono<{ Variables: AuthVariables }>();

files.use("*", requireAuth);

// ---------- presenter ------------------------------------------------------

const IMAGE_MIME_WHITELIST = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/heic",
]);

async function presentFile(row: typeof uploadedFiles.$inferSelect) {
  const url = await (row.mimeType === "application/pdf"
    ? presignDownload(row.storagePath, row.originalName, row.mimeType, 300)
    : presignGet(row.storagePath, 300)
  ).catch(() => row.publicUrl);

  return {
    id: row.id,
    ownerId: row.ownerId,
    groupId: row.groupId,
    expenseId: row.expenseId,
    kind: row.kind,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    publicUrl: row.publicUrl,
    url,
    ocr: row.ocrData,
    ocrModel: row.ocrModel,
    createdAt: row.createdAt.toISOString(),
  };
}

async function assertStorageObjectExists(storagePath: string) {
  try {
    await s3().send(
      new HeadObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: storagePath,
      }),
    );
  } catch (err) {
    console.error("s3 headObject failed before commit", {
      bucket: env.S3_BUCKET,
      key: storagePath,
      err,
    });
    throw unprocessable(
      "File bytes were not found in S3. Upload the file before committing it.",
      "FILE_NOT_IN_S3",
    );
  }
}

async function assertUploadGroupAccess(groupId: string | null | undefined, userId: string) {
  if (!groupId) return;
  const [membership] = await db
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
  if (!membership) throw notFound("Group not found");
}

async function canUserViewFile(
  row: typeof uploadedFiles.$inferSelect,
  userId: string,
): Promise<boolean> {
  if (row.ownerId === userId) return true;

  if (row.groupId) {
    const [membership] = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, row.groupId),
          eq(groupMembers.userId, userId),
          ne(groupMembers.status, "left"),
        ),
      )
      .limit(1);
    if (membership) return true;
  }

  const [coverMembership] = await db
    .select({ groupId: groups.id })
    .from(groups)
    .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
    .where(
      and(
        eq(groups.coverFileId, row.id),
        eq(groupMembers.userId, userId),
        ne(groupMembers.status, "left"),
      ),
    )
    .limit(1);

  return !!coverMembership;
}

function isSupportedUpload(mimeType: string, kind: UploadKind | undefined) {
  if (IMAGE_MIME_WHITELIST.has(mimeType)) return true;
  if (mimeType === "application/pdf" && kind === "hra_receipt_pdf") return true;
  return kind === "other";
}

// ---------- /presign -------------------------------------------------------

const presignSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
  sizeBytes: z.number().int().nonnegative().optional(),
  groupId: z.string().uuid().nullable().optional(),
  expenseId: z.string().uuid().nullable().optional(),
  kind: z.enum(UPLOAD_KINDS).optional(),
});

files.post("/presign", async (c) => {
  const user = c.get("user");
  const body = await parseJson(c, presignSchema);
  if (!isSupportedUpload(body.mimeType, body.kind)) {
    throw badRequest("Unsupported media type", "UNSUPPORTED_MEDIA_TYPE");
  }
  await assertUploadGroupAccess(body.groupId, user.id);
  const kind = body.kind ?? "receipt";
  const key = buildUploadStorageKey({
    ownerId: user.id,
    groupId: body.groupId ?? null,
    kind,
    mimeType: body.mimeType,
  });
  const url = await presignPut(key, body.mimeType);
  return c.json({
    storagePath: key,
    putUrl: url,
    expiresIn: 300,
    publicUrl: publicStorageUrl(key),
  });
});

// ---------- /commit (record DB row after S3 PUT) --------------------------

const commitSchema = z.object({
  storagePath: z.string().min(1),
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
  sizeBytes: z.number().int().nonnegative(),
  kind: z.enum(UPLOAD_KINDS).optional(),
  groupId: z.string().uuid().nullable().optional(),
  expenseId: z.string().uuid().nullable().optional(),
});

files.post("/commit", async (c) => {
  const user = c.get("user");
  const body = await parseJson(c, commitSchema);
  if (!isSupportedUpload(body.mimeType, body.kind)) {
    throw badRequest("Unsupported media type", "UNSUPPORTED_MEDIA_TYPE");
  }
  await assertUploadGroupAccess(body.groupId, user.id);
  const kind = body.kind ?? "receipt";
  if (
    !isUploadStorageKeyForContext(body.storagePath, {
      ownerId: user.id,
      groupId: body.groupId ?? null,
      kind,
      mimeType: body.mimeType,
    })
  ) {
    throw badRequest("Storage path does not match the upload context", "INVALID_STORAGE_PATH");
  }
  await assertStorageObjectExists(body.storagePath);
  const [row] = await db
    .insert(uploadedFiles)
    .values({
      ownerId: user.id,
      groupId: body.groupId ?? null,
      expenseId: body.expenseId ?? null,
      kind,
      originalName: body.originalName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      storagePath: body.storagePath,
      publicUrl: publicStorageUrl(body.storagePath),
    })
    .returning();
  return c.json({ file: await presentFile(row!) }, 201);
});

// ---------- list ----------------------------------------------------------

files.get("/", async (c) => {
  const user = c.get("user");
  const limitRaw = c.req.query("limit");
  let limit = 50;
  if (limitRaw !== undefined) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n <= 0) throw validationError({ limit: "Must be a positive integer" });
    limit = Math.min(n, 200);
  }
  const rows = await db
    .select()
    .from(uploadedFiles)
    .where(eq(uploadedFiles.ownerId, user.id))
    .orderBy(desc(uploadedFiles.createdAt))
    .limit(limit);
  const presented = await Promise.all(rows.map(presentFile));
  return c.json({ files: presented });
});

// ---------- parse-receipt (inline base64 OR existing fileId) --------------

const parseReceiptInlineSchema = z.object({
  data: z.string().min(1),
  mimeType: z.string().regex(/^image\/[\w.+-]+$/),
  filename: z.string().optional(),
  model: z.enum(["gpt-4o", "gpt-4.1", "gpt-4.1-mini"]).optional(),
  persist: z.boolean().optional(),
  groupId: z.string().uuid().nullable().optional(),
});

files.post("/parse-receipt", async (c) => {
  const user = c.get("user");
  const body = await parseJson(c, parseReceiptInlineSchema);
  if (!IMAGE_MIME_WHITELIST.has(body.mimeType)) {
    throw badRequest("Unsupported media type", "UNSUPPORTED_MEDIA_TYPE");
  }
  const persist = body.persist ?? true;
  const model: VisionModel = body.model ?? "gpt-4.1-mini";

  // Decode base64 for size validation. Strip data:URL prefix if present.
  const b64 = body.data.replace(/^data:[^;]+;base64,/, "");
  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0) throw badRequest("Invalid image", "INVALID_IMAGE");
  if (buf.length > 10 * 1024 * 1024) {
    throw badRequest("Image too large", "PAYLOAD_TOO_LARGE");
  }

  if (body.groupId) {
    await assertUploadGroupAccess(body.groupId, user.id);
  }

  let fileId: string | undefined;
  let storagePath: string | undefined;

  if (persist) {
    storagePath = buildUploadStorageKey({
      ownerId: user.id,
      groupId: body.groupId ?? null,
      kind: "receipt",
      mimeType: body.mimeType,
    });
    await s3().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: storagePath,
        Body: buf,
        ContentType: body.mimeType,
      }),
    );
    const [row] = await db
      .insert(uploadedFiles)
      .values({
        ownerId: user.id,
        groupId: body.groupId ?? null,
        kind: "receipt",
        originalName: body.filename ?? `receipt.${mimeToStorageExt(body.mimeType)}`,
        mimeType: body.mimeType,
        sizeBytes: buf.length,
        storagePath,
        publicUrl: publicStorageUrl(storagePath),
      })
      .returning();
    fileId = row?.id;
  }

  const dataUrl = `data:${body.mimeType};base64,${b64}`;
  const receipt = await runVisionOCR(dataUrl, model, body.groupId ?? null);

  if (persist && fileId) {
    await db
      .update(uploadedFiles)
      .set({ ocrData: receipt as unknown as Record<string, unknown>, ocrModel: model })
      .where(eq(uploadedFiles.id, fileId));
  }

  return c.json({
    fileId,
    url: storagePath ? await presignGet(storagePath, 300) : undefined,
    model,
    receipt,
  });
});

// ---------- by-id endpoints -----------------------------------------------

files.get("/:fileId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("fileId")!;
  const [row] = await db
    .select()
    .from(uploadedFiles)
    .where(eq(uploadedFiles.id, id))
    .limit(1);
  if (!row || !(await canUserViewFile(row, user.id))) throw notFound("File not found");
  return c.json({ file: await presentFile(row) });
});

const attachSchema = z.object({ expenseId: z.string().uuid().nullable() });

files.patch("/:fileId/expense", async (c) => {
  const user = c.get("user");
  const id = c.req.param("fileId")!;
  const body = await parseJson(c, attachSchema);
  const [row] = await db
    .select()
    .from(uploadedFiles)
    .where(and(eq(uploadedFiles.id, id), eq(uploadedFiles.ownerId, user.id)))
    .limit(1);
  if (!row) throw notFound("File not found");
  const [updated] = await db
    .update(uploadedFiles)
    .set({ expenseId: body.expenseId })
    .where(eq(uploadedFiles.id, id))
    .returning();
  return c.json({ file: await presentFile(updated!) });
});

const parseReceiptByIdSchema = z.object({
  model: z.enum(["gpt-4o", "gpt-4.1", "gpt-4.1-mini"]).optional(),
  groupId: z.string().uuid().optional(),
});

files.post("/:fileId/parse-receipt", async (c) => {
  const user = c.get("user");
  const id = c.req.param("fileId")!;
  const body = await parseJson(c, parseReceiptByIdSchema);
  const model: VisionModel = body.model ?? "gpt-4.1-mini";

  const [row] = await db
    .select()
    .from(uploadedFiles)
    .where(and(eq(uploadedFiles.id, id), eq(uploadedFiles.ownerId, user.id)))
    .limit(1);
  if (!row) throw notFound("File not found");
  if (!IMAGE_MIME_WHITELIST.has(row.mimeType)) {
    throw badRequest("Not an image", "INVALID_FILE_TYPE");
  }

  const obj = await s3().send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: row.storagePath }),
  );
  const bytes = await obj.Body?.transformToByteArray();
  if (!bytes) throw unprocessable("Could not read file from storage");
  const b64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:${row.mimeType};base64,${b64}`;

  const receipt = await runVisionOCR(dataUrl, model, body.groupId ?? null);

  await db
    .update(uploadedFiles)
    .set({ ocrData: receipt as unknown as Record<string, unknown>, ocrModel: model })
    .where(eq(uploadedFiles.id, id));

  return c.json({ fileId: id, model, receipt });
});

files.delete("/:fileId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("fileId")!;
  const [row] = await db
    .select()
    .from(uploadedFiles)
    .where(and(eq(uploadedFiles.id, id), eq(uploadedFiles.ownerId, user.id)))
    .limit(1);
  if (!row) throw notFound("File not found");
  await deleteObject(row.storagePath).catch((err) => {
    // S3 delete failure shouldn't block DB delete — the file is orphaned
    // either way. Log and proceed.
    console.error("s3 deleteObject failed", { key: row.storagePath, err });
  });
  await db.delete(uploadedFiles).where(eq(uploadedFiles.id, id));
  return c.body(null, 204);
});

// ---------- OpenAI Vision OCR --------------------------------------------

type ParsedReceiptItem = {
  name: string;
  quantity: string | null;
  unitPrice: string | null;
  totalPrice: string | null;
};

type ParsedReceipt = {
  merchant: string | null;
  total: string | null;
  subtotal: string | null;
  tax: string | null;
  tip: string | null;
  currency: string | null;
  date: string | null;
  items: ParsedReceiptItem[];
  suggestedDescription: string | null;
  suggestedCategory: string | null;
  suggestedCategoryId: string | null;
  suggestedTagIds: string[];
  suggestedTags: string[];
  rawModelOutput?: string;
};

const toMoneyStringOrNull = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v.toFixed(2);
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.\-]/g, "");
    if (cleaned.length === 0) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n.toFixed(2) : null;
  }
  return null;
};

const toStrOrNull = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string") {
    const t = v.trim();
    return t.length === 0 ? null : t;
  }
  return null;
};

function normalizeItems(raw: unknown): ParsedReceiptItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedReceiptItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const name = toStrOrNull(r.name);
    if (!name) continue;
    const quantity = toStrOrNull(r.quantity);
    const unitPrice = toMoneyStringOrNull(r.unitPrice ?? r.unit_price);
    // Accept `totalPrice`, `total_price`, or a bare `price` from the LLM.
    let totalPrice = toMoneyStringOrNull(r.totalPrice ?? r.total_price ?? r.price);
    // If only unitPrice + quantity are present, derive totalPrice.
    if (totalPrice == null && unitPrice != null) {
      const qty = quantity != null ? Number(quantity) : 1;
      if (Number.isFinite(qty) && qty > 0) {
        totalPrice = (Number(unitPrice) * qty).toFixed(2);
      } else {
        totalPrice = unitPrice;
      }
    }
    out.push({ name, quantity, unitPrice, totalPrice });
  }
  return out;
}

async function runVisionOCR(
  dataUrl: string,
  model: VisionModel,
  groupId: string | null,
): Promise<ParsedReceipt> {
  if (!hasOpenAI()) {
    return emptyReceipt();
  }

  // System taxonomy (group_id IS NULL) is always offered. When a groupId is
  // given, that group's custom categories/tags are merged in alongside.
  const catScope = groupId
    ? or(isNull(categories.groupId), eq(categories.groupId, groupId))
    : isNull(categories.groupId);
  const tagScope = groupId
    ? or(isNull(tags.groupId), eq(tags.groupId, groupId))
    : isNull(tags.groupId);

  const [cats, tagRows] = await Promise.all([
    db.select().from(categories).where(catScope),
    db.select().from(tags).where(tagScope),
  ]);

  const catList = cats.map((c) => `- ${c.id}: ${c.name}`).join("\n");
  const tagList = tagRows.map((t) => `- ${t.id}: ${t.name}`).join("\n");
  const catIds = new Set(cats.map((c) => c.id));
  const tagIds = new Set(tagRows.map((t) => t.id));

  const prompt = `You are a receipt-OCR assistant. Look at the image and return a JSON object with these keys:
  merchant (string|null), total, subtotal, tax, tip (money strings "12.34" or null),
  currency (3-letter code or null), date ("YYYY-MM-DD" or null),
  items (array of { name, quantity, unitPrice, totalPrice } — quantity as a number-like string, unitPrice is the per-unit price, totalPrice is quantity × unitPrice or the line total printed on the receipt; use null only when a value truly isn't on the receipt),
  suggestedDescription (short title for the expense),
  suggestedCategory (short label like "groceries"),
  suggestedCategoryId (id from the candidate category list, or null if no match),
  suggestedTagIds (array of ids from the candidate tag list — empty array if nothing fits; prefer brand tags like swiggy/blinkit/uber when the merchant matches, and add state tags like monthly/urgent/one-off only when the receipt clearly signals them).

Pick exactly one category (the best fit) and 0–3 tags. Only use ids that appear in the candidate lists below; never invent ids. For every line item, you MUST include a totalPrice — that is the number the user wants to see. If the receipt only shows a per-unit price, multiply by quantity. If it only shows a line total, put it in totalPrice and leave unitPrice null.

CATEGORY CANDIDATES:
${catList || "(none)"}

TAG CANDIDATES:
${tagList || "(none)"}`;

  const out = await chatJson({
    model,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  if (!out) return emptyReceipt();

  try {
    const parsed = JSON.parse(out) as Partial<ParsedReceipt> & {
      items?: unknown;
      suggestedTagIds?: unknown;
    };
    const result: ParsedReceipt = {
      ...emptyReceipt(),
      ...parsed,
      items: normalizeItems(parsed.items),
      suggestedTagIds: [],
      suggestedTags: [],
      rawModelOutput: out,
    };
    if (result.suggestedCategoryId && !catIds.has(result.suggestedCategoryId)) {
      result.suggestedCategoryId = null;
    }
    if (Array.isArray(parsed.suggestedTagIds)) {
      const tagNameById = new Map(tagRows.map((t) => [t.id, t.name]));
      const seen = new Set<string>();
      for (const raw of parsed.suggestedTagIds) {
        if (typeof raw !== "string") continue;
        if (!tagIds.has(raw) || seen.has(raw)) continue;
        seen.add(raw);
        result.suggestedTagIds.push(raw);
        const name = tagNameById.get(raw);
        if (name) result.suggestedTags.push(name);
      }
    }
    return result;
  } catch {
    return { ...emptyReceipt(), rawModelOutput: out };
  }
}

function emptyReceipt(): ParsedReceipt {
  return {
    merchant: null,
    total: null,
    subtotal: null,
    tax: null,
    tip: null,
    currency: null,
    date: null,
    items: [],
    suggestedDescription: null,
    suggestedCategory: null,
    suggestedCategoryId: null,
    suggestedTagIds: [],
    suggestedTags: [],
  };
}

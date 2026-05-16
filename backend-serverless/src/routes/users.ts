// /api/users/* — current user profile, cross-group balances, settlements,
// analytics, and "people I split with" views.

import { Hono } from "hono";
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { users, type User } from "../db/schema/users.js";
import { hraLandlords, hraProfiles, hraReceipts } from "../db/schema/hra.js";
import { uploadedFiles } from "../db/schema/uploaded-files.js";
import { groups, groupMembers } from "../db/schema/groups.js";
import { expenses } from "../db/schema/expenses.js";
import { expenseParticipants } from "../db/schema/expense-participants.js";
import { settlements } from "../db/schema/settlements.js";
import { categories } from "../db/schema/categories.js";
import { auditLogs } from "../db/schema/audit-logs.js";
import { requireAuth, type AuthVariables } from "../lib/auth.js";
import { parseJson } from "../lib/http.js";
import { notFound, unprocessable, validationError } from "../lib/errors.js";
import { centsToMoney, computePairwiseCents } from "../lib/balances.js";
import { isMoneyString, parseMoneyToCents } from "../lib/money.js";
import {
  dateRangeKey,
  getCurrentMonthDateRange,
  isDateOnly,
  isMonthString,
} from "../lib/date-utils.js";
import { buildPaginationMeta, parsePagination } from "../lib/pagination.js";
import { recordAudit } from "../lib/audit.js";
import { notify } from "../lib/notify.js";
import { relativeOrAbsoluteUrlSchema } from "../lib/validation.js";
import { buildHraReceiptPdf } from "../lib/hra-receipt-pdf.js";
import { env } from "../lib/env.js";
import {
  attachmentContentDisposition,
  buildHraReceiptStorageKey,
  deleteObject,
  presignDownload,
  publicStorageUrl,
  s3,
} from "../lib/s3.js";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

export const users_router = new Hono<{ Variables: AuthVariables }>();
users_router.use("*", requireAuth);

function decimalToCents(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const s = typeof v === "number" ? String(v) : v;
  if (!s.includes(".")) return parseMoneyToCents(`${s}.00`);
  const [w, f = "00"] = s.split(".");
  return parseMoneyToCents(`${w}.${(f + "00").slice(0, 2)}`);
}

const HRA_PAYMENT_METHOD_VALUES = [
  "cash",
  "upi",
  "bank_transfer",
  "cheque",
  "online_transfer",
  "other",
] as const;

type HraPaymentMethod = (typeof HRA_PAYMENT_METHOD_VALUES)[number];

const HRA_PAYMENT_METHOD_LABELS: Record<HraPaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  online_transfer: "Online transfer",
  other: "Other",
};

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const hraProfileSchema = z.object({
  tenantName: optionalText(120),
  tenantPan: optionalText(20),
  propertyAddress: optionalText(240),
  defaultRentAmount: z.string().trim().min(1).nullable().optional(),
  defaultPaymentMethod: z.enum(HRA_PAYMENT_METHOD_VALUES).nullable().optional(),
  place: optionalText(80),
});

const hraLandlordCreateSchema = z.object({
  nickname: optionalText(80),
  name: z.string().trim().min(1).max(120),
  pan: optionalText(20),
  address: optionalText(180),
  isDefault: z.boolean().optional(),
});

const hraLandlordUpdateSchema = z.object({
  nickname: optionalText(80),
  name: z.string().trim().min(1).max(120).optional(),
  pan: optionalText(20),
  address: optionalText(180),
  isDefault: z.boolean().optional(),
});

const hraReceiptSchema = z.object({
  landlordId: z.string().uuid().nullable().optional(),
  tenantName: z.string().trim().min(1).max(120).optional(),
  tenantPan: optionalText(20),
  landlordName: optionalText(120),
  landlordPan: optionalText(20),
  landlordAddress: optionalText(180),
  propertyAddress: optionalText(240),
  rentAmount: z.string().trim().min(1).nullable().optional(),
  paymentDate: z.string(),
  receiptDate: optionalText(10),
  rentMonth: optionalText(7),
  periodFrom: optionalText(10),
  periodTo: optionalText(10),
  periodLabel: optionalText(80),
  paymentMethod: z.enum(HRA_PAYMENT_METHOD_VALUES).optional(),
  transactionReference: optionalText(80),
  receiptNumber: z.string().trim().min(1).max(40).optional(),
  place: optionalText(80),
});

const longDateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

const monthYearFormatter = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

// ---------- GET / list all users ------------------------------------------

users_router.get("/", async (c) => {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(users);
  return c.json(rows);
});

// ---------- /me profile ---------------------------------------------------

function presentProfile(u: User) {
  return {
    id: u.id,
    firebaseUid: u.firebaseUid,
    email: u.email,
    emailVerified: u.emailVerified,
    phone: u.phone,
    name: u.name,
    avatarUrl: u.avatarUrl,
    avatarFileId: u.avatarFileId,
    upiId: u.upiId,
    preferredSettlementMethod: u.preferredSettlementMethod ?? null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

users_router.get("/me", async (c) => {
  const actor = c.get("user");
  const [u] = await db.select().from(users).where(eq(users.id, actor.id)).limit(1);
  if (!u) throw notFound("User not found");
  return c.json(presentProfile(u));
});

const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  avatarUrl: relativeOrAbsoluteUrlSchema.nullable().optional(),
  avatarFileId: z.string().uuid().nullable().optional(),
  upiId: z.string().trim().min(1).max(120).nullable().optional(),
  preferredSettlementMethod: z.enum(["upi", "bank_transfer", "cash", "other"]).nullable().optional(),
  phone: z.string().trim().min(1).max(40).nullable().optional(),
});

users_router.put("/me", async (c) => {
  const actor = c.get("user");
  const body = await parseJson(c, updateMeSchema);
  if (Object.keys(body).length === 0) {
    const [u] = await db.select().from(users).where(eq(users.id, actor.id)).limit(1);
    return c.json(presentProfile(u!));
  }
  const [row] = await db
    .update(users)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(users.id, actor.id))
    .returning();
  if (!row) throw notFound("User not found");
  return c.json(presentProfile(row));
});

type HraReceiptSnapshot = {
  receiptNumber: string;
  receiptDateLabel: string;
  paymentDateLabel: string;
  periodLabel: string;
  tenantName: string;
  tenantPan: string | null;
  landlordName: string;
  landlordPan: string | null;
  landlordAddress: string | null;
  propertyAddress: string;
  rentAmount: string;
  paymentMethodLabel: string;
  transactionReference: string | null;
  place: string | null;
};

type ResolvedHraReceipt = {
  snapshot: HraReceiptSnapshot;
  landlordId: string | null;
  receiptNumber: string;
  receiptDate: string;
  paymentDate: string;
  rentMonth: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  periodLabel: string;
  rentAmount: string;
  paymentMethod: HraPaymentMethod;
  filename: string;
};

function presentHraProfile(row: typeof hraProfiles.$inferSelect | undefined) {
  return {
    tenantName: row?.tenantName ?? null,
    tenantPan: row?.tenantPan ?? null,
    propertyAddress: row?.propertyAddress ?? null,
    defaultRentAmount: row?.defaultRentAmount ?? null,
    defaultPaymentMethod: row?.defaultPaymentMethod ?? null,
    place: row?.place ?? null,
    createdAt: row?.createdAt.toISOString() ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

function presentHraLandlord(row: typeof hraLandlords.$inferSelect) {
  return {
    id: row.id,
    nickname: row.nickname,
    name: row.name,
    pan: row.pan,
    address: row.address,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function presentHraReceipt(row: typeof hraReceipts.$inferSelect) {
  const snapshot = row.snapshot as HraReceiptSnapshot;
  return {
    id: row.id,
    landlordId: row.landlordId,
    pdfFileId: row.pdfFileId,
    receiptNumber: row.receiptNumber,
    receiptDate: row.receiptDate,
    paymentDate: row.paymentDate,
    rentMonth: row.rentMonth,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    periodLabel: row.periodLabel,
    rentAmount: row.rentAmount,
    paymentMethod: row.paymentMethod,
    filename: row.filename,
    pdfUrl: `/api/users/me/hra/receipts/${row.id}.pdf`,
    details: {
      tenantName: snapshot.tenantName,
      tenantPan: snapshot.tenantPan,
      landlordName: snapshot.landlordName,
      landlordPan: snapshot.landlordPan,
      landlordAddress: snapshot.landlordAddress,
      propertyAddress: snapshot.propertyAddress,
      paymentMethodLabel: snapshot.paymentMethodLabel,
      transactionReference: snapshot.transactionReference,
      place: snapshot.place,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function resolveOptionalText(
  value: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  if (value === null) return null;
  return normalizeOptionalText(value) ?? normalizeOptionalText(fallback);
}

function resolveOptionalPan(
  value: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  if (value === null) return null;
  return normalizePan(value) ?? normalizePan(fallback);
}

async function loadDefaultHraLandlord(userId: string) {
  const [row] = await db
    .select()
    .from(hraLandlords)
    .where(and(eq(hraLandlords.userId, userId), eq(hraLandlords.isDefault, true)))
    .limit(1);
  return row;
}

async function resolveHraReceipt(
  actor: Pick<User, "id" | "name">,
  body: z.infer<typeof hraReceiptSchema>,
): Promise<ResolvedHraReceipt> {
  const [profile] = await db
    .select()
    .from(hraProfiles)
    .where(eq(hraProfiles.userId, actor.id))
    .limit(1);

  const requestedLandlordId = body.landlordId ?? null;
  let landlord: typeof hraLandlords.$inferSelect | undefined;
  if (requestedLandlordId) {
    const [row] = await db
      .select()
      .from(hraLandlords)
      .where(and(eq(hraLandlords.id, requestedLandlordId), eq(hraLandlords.userId, actor.id)))
      .limit(1);
    if (!row) throw notFound("Landlord not found");
    landlord = row;
  } else if (!normalizeOptionalText(body.landlordName)) {
    landlord = await loadDefaultHraLandlord(actor.id);
  }

  const receiptDate = normalizeOptionalText(body.receiptDate) ?? body.paymentDate;
  const rentMonth = normalizeOptionalText(body.rentMonth);
  const periodFrom = normalizeOptionalText(body.periodFrom);
  const periodTo = normalizeOptionalText(body.periodTo);
  const explicitPeriodLabel = normalizeOptionalText(body.periodLabel);
  const tenantName = normalizeOptionalText(body.tenantName) ?? profile?.tenantName ?? actor.name;
  const tenantPan = resolveOptionalPan(body.tenantPan, profile?.tenantPan);
  const landlordName = resolveOptionalText(body.landlordName, landlord?.name);
  const landlordPan = resolveOptionalPan(body.landlordPan, landlord?.pan);
  const landlordAddress = resolveOptionalText(body.landlordAddress, landlord?.address);
  const propertyAddress = resolveOptionalText(body.propertyAddress, profile?.propertyAddress);
  const rentAmount = resolveOptionalText(body.rentAmount, profile?.defaultRentAmount);
  const paymentMethod = body.paymentMethod ?? profile?.defaultPaymentMethod ?? "other";
  const transactionReference = normalizeOptionalText(body.transactionReference);
  const place = resolveOptionalText(body.place, profile?.place);
  const errors: Record<string, string> = {};

  if (!landlordName) {
    errors.landlordName = "Required unless landlordId or a default landlord is saved";
  }
  if (!propertyAddress || propertyAddress.length < 5) {
    errors.propertyAddress = "Required and must be at least 5 characters";
  }
  if (!rentAmount) {
    errors.rentAmount = "Required unless defaultRentAmount is saved";
  } else if (!isMoneyString(rentAmount)) {
    errors.rentAmount = "Must be a money string";
  }
  if (!isDateOnly(body.paymentDate)) {
    errors.paymentDate = "Must be YYYY-MM-DD";
  }
  if (!isDateOnly(receiptDate)) {
    errors.receiptDate = "Must be YYYY-MM-DD";
  }
  if (rentMonth && !isMonthString(rentMonth)) {
    errors.rentMonth = "Must be YYYY-MM";
  }
  if (periodFrom && !isDateOnly(periodFrom)) {
    errors.periodFrom = "Must be YYYY-MM-DD";
  }
  if (periodTo && !isDateOnly(periodTo)) {
    errors.periodTo = "Must be YYYY-MM-DD";
  }
  if ((periodFrom && !periodTo) || (!periodFrom && periodTo)) {
    errors.periodFrom = "Provide both periodFrom and periodTo";
    errors.periodTo = "Provide both periodFrom and periodTo";
  }
  if (periodFrom && periodTo && periodFrom > periodTo) {
    errors.periodTo = "Must be on or after periodFrom";
  }
  if (!explicitPeriodLabel && !rentMonth && !(periodFrom && periodTo)) {
    errors.periodLabel = "Provide periodLabel, rentMonth, or a periodFrom/periodTo range";
  }
  if (Object.keys(errors).length > 0) {
    throw validationError(errors);
  }

  const normalizedRentAmount = centsToMoney(parseMoneyToCents(rentAmount!));
  const periodLabel = deriveHraPeriodLabel(explicitPeriodLabel, rentMonth, periodFrom, periodTo);
  const receiptNumber = body.receiptNumber ?? buildHraReceiptNumber(receiptDate, rentMonth, periodFrom);
  const filename = buildHraReceiptFilename(periodLabel, tenantName);
  const snapshot: HraReceiptSnapshot = {
    receiptNumber,
    receiptDateLabel: formatLongDate(receiptDate),
    paymentDateLabel: formatLongDate(body.paymentDate),
    periodLabel,
    tenantName,
    tenantPan,
    landlordName: landlordName!,
    landlordPan,
    landlordAddress,
    propertyAddress: propertyAddress!,
    rentAmount: normalizedRentAmount,
    paymentMethodLabel: HRA_PAYMENT_METHOD_LABELS[paymentMethod],
    transactionReference,
    place,
  };

  return {
    snapshot,
    landlordId: landlord?.id ?? requestedLandlordId,
    receiptNumber,
    receiptDate,
    paymentDate: body.paymentDate,
    rentMonth,
    periodFrom,
    periodTo,
    periodLabel,
    rentAmount: normalizedRentAmount,
    paymentMethod,
    filename,
  };
}

// ---------- /me/hra-rent-receipt.pdf -------------------------------------

users_router.post("/me/hra-rent-receipt.pdf", async (c) => {
  const actor = c.get("user");
  const body = await parseJson(c, hraReceiptSchema);
  const resolved = await resolveHraReceipt(actor, body);
  const pdfBytes = buildHraReceiptPdf(resolved.snapshot);
  const file = await persistHraReceiptPdfFile(actor.id, resolved.filename, pdfBytes);

  c.header("Cache-Control", "no-store");
  return c.redirect(
    await presignDownload(file.storagePath, resolved.filename, "application/pdf", 300),
    303,
  );
});

// ---------- /me/hra saved defaults ---------------------------------------

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

users_router.get("/me/hra", async (c) => {
  const actor = c.get("user");
  const [[profile], defaultLandlord] = await Promise.all([
    db.select().from(hraProfiles).where(eq(hraProfiles.userId, actor.id)).limit(1),
    loadDefaultHraLandlord(actor.id),
  ]);

  return c.json({
    profile: presentHraProfile(profile),
    defaultLandlord: defaultLandlord ? presentHraLandlord(defaultLandlord) : null,
  });
});

users_router.put("/me/hra", async (c) => {
  const actor = c.get("user");
  const body = await parseJson(c, hraProfileSchema);
  const values: Partial<typeof hraProfiles.$inferInsert> = {};

  if (hasOwn(body, "tenantName")) values.tenantName = normalizeOptionalText(body.tenantName);
  if (hasOwn(body, "tenantPan")) values.tenantPan = normalizePan(body.tenantPan);
  if (hasOwn(body, "propertyAddress")) {
    values.propertyAddress = normalizeOptionalText(body.propertyAddress);
  }
  if (hasOwn(body, "defaultPaymentMethod")) {
    values.defaultPaymentMethod = body.defaultPaymentMethod ?? null;
  }
  if (hasOwn(body, "place")) values.place = normalizeOptionalText(body.place);
  if (hasOwn(body, "defaultRentAmount")) {
    const amount = normalizeOptionalText(body.defaultRentAmount);
    if (amount && !isMoneyString(amount)) {
      throw validationError({ defaultRentAmount: "Must be a money string" });
    }
    values.defaultRentAmount = amount ? centsToMoney(parseMoneyToCents(amount)) : null;
  }

  if (Object.keys(values).length === 0) {
    const [profile] = await db
      .select()
      .from(hraProfiles)
      .where(eq(hraProfiles.userId, actor.id))
      .limit(1);
    return c.json({ profile: presentHraProfile(profile) });
  }

  const [profile] = await db
    .insert(hraProfiles)
    .values({ userId: actor.id, ...values })
    .onConflictDoUpdate({
      target: hraProfiles.userId,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();

  return c.json({ profile: presentHraProfile(profile) });
});

// ---------- /me/hra/landlords --------------------------------------------

users_router.get("/me/hra/landlords", async (c) => {
  const actor = c.get("user");
  const rows = await db
    .select()
    .from(hraLandlords)
    .where(eq(hraLandlords.userId, actor.id))
    .orderBy(desc(hraLandlords.isDefault), asc(hraLandlords.name));
  return c.json({ landlords: rows.map(presentHraLandlord) });
});

users_router.post("/me/hra/landlords", async (c) => {
  const actor = c.get("user");
  const body = await parseJson(c, hraLandlordCreateSchema);
  if (body.isDefault) {
    await db
      .update(hraLandlords)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(hraLandlords.userId, actor.id));
  }

  const [row] = await db
    .insert(hraLandlords)
    .values({
      userId: actor.id,
      nickname: normalizeOptionalText(body.nickname),
      name: body.name,
      pan: normalizePan(body.pan),
      address: normalizeOptionalText(body.address),
      isDefault: body.isDefault ?? false,
    })
    .returning();

  return c.json({ landlord: presentHraLandlord(row!) }, 201);
});

users_router.patch("/me/hra/landlords/:landlordId", async (c) => {
  const actor = c.get("user");
  const landlordId = c.req.param("landlordId")!;
  const body = await parseJson(c, hraLandlordUpdateSchema);
  const values: Partial<typeof hraLandlords.$inferInsert> = {};

  if (hasOwn(body, "nickname")) values.nickname = normalizeOptionalText(body.nickname);
  if (hasOwn(body, "name")) values.name = body.name;
  if (hasOwn(body, "pan")) values.pan = normalizePan(body.pan);
  if (hasOwn(body, "address")) values.address = normalizeOptionalText(body.address);
  if (hasOwn(body, "isDefault")) values.isDefault = body.isDefault ?? false;

  if (Object.keys(values).length === 0) {
    const [row] = await db
      .select()
      .from(hraLandlords)
      .where(and(eq(hraLandlords.id, landlordId), eq(hraLandlords.userId, actor.id)))
      .limit(1);
    if (!row) throw notFound("Landlord not found");
    return c.json({ landlord: presentHraLandlord(row) });
  }

  if (values.isDefault) {
    await db
      .update(hraLandlords)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(hraLandlords.userId, actor.id));
  }

  const [row] = await db
    .update(hraLandlords)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(hraLandlords.id, landlordId), eq(hraLandlords.userId, actor.id)))
    .returning();
  if (!row) throw notFound("Landlord not found");

  return c.json({ landlord: presentHraLandlord(row) });
});

users_router.delete("/me/hra/landlords/:landlordId", async (c) => {
  const actor = c.get("user");
  const landlordId = c.req.param("landlordId")!;
  const [row] = await db
    .delete(hraLandlords)
    .where(and(eq(hraLandlords.id, landlordId), eq(hraLandlords.userId, actor.id)))
    .returning();
  if (!row) throw notFound("Landlord not found");
  return c.body(null, 204);
});

// ---------- /me/hra/receipts ---------------------------------------------

async function persistHraReceiptPdfFile(userId: string, filename: string, pdfBytes: Uint8Array) {
  const storagePath = buildHraReceiptStorageKey(userId);
  await s3().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: storagePath,
      Body: Buffer.from(pdfBytes),
      ContentType: "application/pdf",
      ContentDisposition: attachmentContentDisposition(filename),
    }),
  );

  const [file] = await db
    .insert(uploadedFiles)
    .values({
      ownerId: userId,
      kind: "hra_receipt_pdf",
      originalName: filename,
      mimeType: "application/pdf",
      sizeBytes: pdfBytes.byteLength,
      storagePath,
      publicUrl: publicStorageUrl(storagePath),
    })
    .returning();

  return file!;
}

async function persistHraReceiptPdf(
  userId: string,
  resolved: ResolvedHraReceipt,
  pdfBytes: Uint8Array,
) {
  const file = await persistHraReceiptPdfFile(userId, resolved.filename, pdfBytes);

  const [receipt] = await db
    .insert(hraReceipts)
    .values({
      userId,
      landlordId: resolved.landlordId,
      pdfFileId: file.id,
      receiptNumber: resolved.receiptNumber,
      receiptDate: resolved.receiptDate,
      paymentDate: resolved.paymentDate,
      rentMonth: resolved.rentMonth,
      periodFrom: resolved.periodFrom,
      periodTo: resolved.periodTo,
      periodLabel: resolved.periodLabel,
      rentAmount: resolved.rentAmount,
      paymentMethod: resolved.paymentMethod,
      filename: resolved.filename,
      snapshot: resolved.snapshot,
    })
    .returning();

  return receipt!;
}

async function s3ObjectExists(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return true;
  } catch (err) {
    console.error("s3 headObject failed for hra receipt pdf", { key, err });
    return false;
  }
}

async function ensureHraReceiptPdfFile(
  userId: string,
  receipt: typeof hraReceipts.$inferSelect,
) {
  if (receipt.pdfFileId) {
    const [file] = await db
      .select()
      .from(uploadedFiles)
      .where(and(eq(uploadedFiles.id, receipt.pdfFileId), eq(uploadedFiles.ownerId, userId)))
      .limit(1);
    if (file && (await s3ObjectExists(file.storagePath))) {
      return file;
    }
  }

  const pdfBytes = buildHraReceiptPdf(receipt.snapshot as HraReceiptSnapshot);
  const file = await persistHraReceiptPdfFile(userId, receipt.filename, pdfBytes);
  await db
    .update(hraReceipts)
    .set({ pdfFileId: file.id, updatedAt: new Date() })
    .where(and(eq(hraReceipts.id, receipt.id), eq(hraReceipts.userId, userId)));
  return file;
}

users_router.get("/me/hra/receipts", async (c) => {
  const actor = c.get("user");
  const { page, limit } = parsePagination(c);
  const [{ total }] = (await db
    .select({ total: sql<number>`count(*)::int` })
    .from(hraReceipts)
    .where(eq(hraReceipts.userId, actor.id))) as [{ total: number }];
  const rows = await db
    .select()
    .from(hraReceipts)
    .where(eq(hraReceipts.userId, actor.id))
    .orderBy(desc(hraReceipts.createdAt))
    .offset((page - 1) * limit)
    .limit(limit);
  return c.json({
    receipts: rows.map(presentHraReceipt),
    meta: buildPaginationMeta(total, page, limit),
  });
});

users_router.post("/me/hra/receipts", async (c) => {
  const actor = c.get("user");
  const body = await parseJson(c, hraReceiptSchema);
  const resolved = await resolveHraReceipt(actor, body);
  const pdfBytes = buildHraReceiptPdf(resolved.snapshot);
  const receipt = await persistHraReceiptPdf(actor.id, resolved, pdfBytes);
  return c.json({ receipt: presentHraReceipt(receipt) }, 201);
});

users_router.get("/me/hra/receipts/:receiptId", async (c) => {
  const actor = c.get("user");
  const receiptIdParam = c.req.param("receiptId")!;
  const wantsPdf = receiptIdParam.endsWith(".pdf");
  const receiptId = wantsPdf ? receiptIdParam.slice(0, -4) : receiptIdParam;
  const [row] = await db
    .select()
    .from(hraReceipts)
    .where(and(eq(hraReceipts.id, receiptId), eq(hraReceipts.userId, actor.id)))
    .limit(1);
  if (!row) throw notFound("HRA receipt not found");

  if (wantsPdf) {
    const file = await ensureHraReceiptPdfFile(actor.id, row);
    c.header("Cache-Control", "private, no-store");
    return c.redirect(
      await presignDownload(file.storagePath, row.filename, "application/pdf", 300),
      302,
    );
  }

  return c.json({ receipt: presentHraReceipt(row) });
});

users_router.delete("/me/hra/receipts/:receiptId", async (c) => {
  const actor = c.get("user");
  const receiptId = c.req.param("receiptId")!;
  const [receipt] = await db
    .select()
    .from(hraReceipts)
    .where(and(eq(hraReceipts.id, receiptId), eq(hraReceipts.userId, actor.id)))
    .limit(1);
  if (!receipt) throw notFound("HRA receipt not found");

  let file: typeof uploadedFiles.$inferSelect | undefined;
  if (receipt.pdfFileId) {
    [file] = await db
      .select()
      .from(uploadedFiles)
      .where(and(eq(uploadedFiles.id, receipt.pdfFileId), eq(uploadedFiles.ownerId, actor.id)))
      .limit(1);
  }

  await db.delete(hraReceipts).where(eq(hraReceipts.id, receipt.id));
  if (file) {
    await deleteObject(file.storagePath).catch((err) => {
      console.error("s3 deleteObject failed for hra receipt", { key: file?.storagePath, err });
    });
    await db.delete(uploadedFiles).where(eq(uploadedFiles.id, file.id));
  }

  return c.body(null, 204);
});

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizePan(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value);
  return normalized ? normalized.toUpperCase() : null;
}

function formatLongDate(dateOnly: string): string {
  return longDateFormatter.format(new Date(`${dateOnly}T00:00:00Z`));
}

function formatMonthYear(month: string): string {
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw);
  return monthYearFormatter.format(new Date(Date.UTC(year, monthIndex - 1, 1)));
}

function formatPeriodRange(from: string, to: string): string {
  if (from === to) return formatLongDate(from);
  return `${formatLongDate(from)} to ${formatLongDate(to)}`;
}

function deriveHraPeriodLabel(
  periodLabel: string | null,
  rentMonth: string | null,
  periodFrom: string | null,
  periodTo: string | null,
): string {
  if (periodLabel) return periodLabel;
  if (rentMonth) return formatMonthYear(rentMonth);
  if (periodFrom && periodTo) return formatPeriodRange(periodFrom, periodTo);
  return "Rental Period";
}

function buildHraReceiptNumber(
  receiptDate: string,
  rentMonth: string | null,
  periodFrom: string | null,
): string {
  const issueToken = receiptDate.replace(/-/g, "");
  const periodToken = (rentMonth ?? periodFrom ?? receiptDate).replace(/-/g, "");
  return `HRA-${periodToken}-${issueToken}`;
}

function buildHraReceiptFilename(periodLabel: string, tenantName: string): string {
  const periodPart = slugifyFilenamePart(periodLabel);
  const tenantPart = slugifyFilenamePart(tenantName);
  return `hra-rent-receipt-${periodPart}-${tenantPart}.pdf`;
}

function slugifyFilenamePart(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 40) || "rent";
}

// ---------- helpers used across many endpoints ----------------------------

// Returns the set of group IDs the user is a member of, optionally filtered
// by group type.
async function getUserGroupIds(
  userId: string,
  type?: "household" | "personal",
): Promise<string[]> {
  const filters = [eq(groupMembers.userId, userId)];
  filters.push(ne(groupMembers.status, "left"));
  const rows = await db
    .select({ groupId: groupMembers.groupId, type: groups.type })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(...filters));
  return rows.filter((r) => !type || r.type === type).map((r) => r.groupId);
}

// Helper: union of pairwise edges across all user's groups, with per-group
// origin attached so /people and /balances can break down by group.
type PairwiseWithGroup = {
  fromId: string;
  toId: string;
  cents: number;
  groupId: string;
  groupName: string;
  groupType: "household" | "personal";
};

async function loadCrossGroupEdges(
  userId: string,
  type?: "household" | "personal",
): Promise<PairwiseWithGroup[]> {
  const ids = await getUserGroupIds(userId, type);
  if (ids.length === 0) return [];
  const groupRows = await db
    .select()
    .from(groups)
    .where(inArray(groups.id, ids));
  const groupById = new Map(groupRows.map((g) => [g.id, g]));

  const edges: PairwiseWithGroup[] = [];
  for (const gid of ids) {
    const pairwise = await computePairwiseCents(gid);
    const g = groupById.get(gid)!;
    for (const e of pairwise) {
      edges.push({
        ...e,
        groupId: gid,
        groupName: g.name,
        groupType: g.type,
      });
    }
  }
  return edges;
}

// ---------- /me/balances --------------------------------------------------

users_router.get("/me/balances", async (c) => {
  const actor = c.get("user");
  const type = c.req.query("type");
  const filterType =
    type === "household" || type === "personal" ? type : undefined;

  const edges = await loadCrossGroupEdges(actor.id, filterType);
  const myEdges = edges.filter(
    (e) => e.fromId === actor.id || e.toId === actor.id,
  );

  const byPersonAndGroup = new Map<string, Map<string, number>>(); // otherId → groupId → net cents (>0 means they owe me)
  for (const e of myEdges) {
    const otherId = e.fromId === actor.id ? e.toId : e.fromId;
    const directional = e.toId === actor.id ? e.cents : -e.cents;
    const map = byPersonAndGroup.get(otherId) ?? new Map<string, number>();
    map.set(e.groupId, (map.get(e.groupId) ?? 0) + directional);
    byPersonAndGroup.set(otherId, map);
  }

  const otherIds = Array.from(byPersonAndGroup.keys());
  const otherUsers = otherIds.length
    ? await db.select().from(users).where(inArray(users.id, otherIds))
    : [];
  const userById = new Map(otherUsers.map((u) => [u.id, u]));

  const groupRows = await db.select().from(groups);
  const groupById = new Map(groupRows.map((g) => [g.id, g]));

  let totalOwed = 0;
  let totalYouOwe = 0;
  const byPerson = otherIds.map((id) => {
    const m = byPersonAndGroup.get(id)!;
    let net = 0;
    const breakdown: Array<{ groupId: string; groupName: string; amount: string }> = [];
    for (const [gid, cents] of m) {
      net += cents;
      const g = groupById.get(gid);
      breakdown.push({
        groupId: gid,
        groupName: g?.name ?? "",
        amount: centsToMoney(cents),
      });
    }
    if (net > 0) totalOwed += net;
    else if (net < 0) totalYouOwe += -net;
    const u = userById.get(id);
    return {
      user: { id, name: u?.name ?? "", avatarUrl: u?.avatarUrl ?? null },
      netAmount: centsToMoney(net),
      breakdown,
    };
  });

  return c.json({
    totalOwed: centsToMoney(totalOwed),
    totalYouOwe: centsToMoney(totalYouOwe),
    net: centsToMoney(totalOwed - totalYouOwe),
    byPerson,
  });
});

// ---------- /me/balances/export.csv --------------------------------------

users_router.get("/me/balances/export.csv", async (c) => {
  const actor = c.get("user");
  const edges = await loadCrossGroupEdges(actor.id);
  const myEdges = edges.filter(
    (e) => e.fromId === actor.id || e.toId === actor.id,
  );

  const byPerson = new Map<string, Map<string, number>>();
  for (const e of myEdges) {
    const otherId = e.fromId === actor.id ? e.toId : e.fromId;
    const directional = e.toId === actor.id ? e.cents : -e.cents;
    const map = byPerson.get(otherId) ?? new Map<string, number>();
    map.set(e.groupId, (map.get(e.groupId) ?? 0) + directional);
    byPerson.set(otherId, map);
  }

  const ids = Array.from(byPerson.keys());
  const otherUsers = ids.length
    ? await db.select().from(users).where(inArray(users.id, ids))
    : [];
  const userById = new Map(otherUsers.map((u) => [u.id, u]));
  const groupRows = await db.select().from(groups);
  const groupById = new Map(groupRows.map((g) => [g.id, g]));

  const lines = [["Person", "Net (Person Total)", "Group", "Amount In Group"].map(csvField).join(",")];
  for (const id of ids) {
    const m = byPerson.get(id)!;
    const u = userById.get(id);
    let net = 0;
    for (const v of m.values()) net += v;
    for (const [gid, cents] of m) {
      const g = groupById.get(gid);
      lines.push(
        [
          csvField(u?.name ?? ""),
          centsToMoney(net),
          csvField(g?.name ?? ""),
          centsToMoney(cents),
        ].join(","),
      );
    }
  }

  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="my-balances-me-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  return c.body(lines.join("\n"));
});

// ---------- /me/settlements/suggestions -----------------------------------

users_router.get("/me/settlements/suggestions", async (c) => {
  const actor = c.get("user");
  const type = c.req.query("type");
  const filterType =
    type === "household" || type === "personal" ? type : undefined;

  c.header("Cache-Control", "no-store");
  const ids = await getUserGroupIds(actor.id, filterType);
  const groupRows = ids.length
    ? await db.select().from(groups).where(inArray(groups.id, ids))
    : [];
  const groupById = new Map(groupRows.map((g) => [g.id, g]));

  // For each group, compute simplified suggestions involving the user.
  let totalYouPay = 0;
  let totalYouReceive = 0;
  let transactionCount = 0;

  const groupsOut: Array<{
    group: { id: string; name: string; type: string };
    suggestions: Array<Record<string, unknown>>;
  }> = [];

  for (const gid of ids) {
    const edges = await computePairwiseCents(gid);
    const userIdsInGroup = Array.from(
      new Set(edges.flatMap((e) => [e.fromId, e.toId])),
    );
    const grpUsers = userIdsInGroup.length
      ? await db.select().from(users).where(inArray(users.id, userIdsInGroup))
      : [];
    const userById = new Map(grpUsers.map((u) => [u.id, u]));

    // Re-simplify per group using its own nets.
    const nets = new Map<string, number>();
    for (const e of edges) {
      nets.set(e.fromId, (nets.get(e.fromId) ?? 0) - e.cents);
      nets.set(e.toId, (nets.get(e.toId) ?? 0) + e.cents);
    }
    // Greedy simplify
    const debtors = Array.from(nets.entries())
      .filter(([, v]) => v < 0)
      .map(([id, v]) => ({ id, cents: -v }))
      .sort((a, b) => b.cents - a.cents);
    const creditors = Array.from(nets.entries())
      .filter(([, v]) => v > 0)
      .map(([id, v]) => ({ id, cents: v }))
      .sort((a, b) => b.cents - a.cents);
    let di = 0;
    let ci = 0;
    const suggestions: Array<Record<string, unknown>> = [];
    while (di < debtors.length && ci < creditors.length) {
      const d = debtors[di]!;
      const cr = creditors[ci]!;
      const amt = Math.min(d.cents, cr.cents);
      if (amt > 0) {
        const involvesYou = d.id === actor.id || cr.id === actor.id;
        if (involvesYou) {
          transactionCount += 1;
          if (d.id === actor.id) totalYouPay += amt;
          else totalYouReceive += amt;
          const fromU = userById.get(d.id);
          const toU = userById.get(cr.id);
          suggestions.push({
            from: { id: d.id, name: fromU?.name ?? "", avatarUrl: fromU?.avatarUrl ?? null },
            to: { id: cr.id, name: toU?.name ?? "", avatarUrl: toU?.avatarUrl ?? null },
            amount: centsToMoney(amt),
            direction: d.id === actor.id ? "you_pay" : "you_receive",
            involvesYou: true,
            summary:
              d.id === actor.id
                ? `Pay ${toU?.name ?? "?"} ${centsToMoney(amt)}`
                : `Receive ${centsToMoney(amt)} from ${fromU?.name ?? "?"}`,
          });
        }
      }
      d.cents -= amt;
      cr.cents -= amt;
      if (d.cents === 0) di += 1;
      if (cr.cents === 0) ci += 1;
    }
    if (suggestions.length > 0) {
      const g = groupById.get(gid)!;
      groupsOut.push({
        group: { id: gid, name: g.name, type: g.type },
        suggestions,
      });
    }
  }

  return c.json({
    asOf: new Date().toISOString(),
    totalYouPay: centsToMoney(totalYouPay),
    totalYouReceive: centsToMoney(totalYouReceive),
    net: centsToMoney(totalYouReceive - totalYouPay),
    groupCount: groupsOut.length,
    transactionCount,
    groups: groupsOut,
  });
});

// ---------- /me/analytics + /me/analytics/trends + export ----------------

function parsePeriod(c: import("hono").Context): { from: string; to: string } {
  const fromQ = c.req.query("from");
  const toQ = c.req.query("to");
  const def = getCurrentMonthDateRange();
  return {
    from: fromQ && isDateOnly(fromQ) ? fromQ : def.from,
    to: toQ && isDateOnly(toQ) ? toQ : def.to,
  };
}

type FlatPart = typeof expenseParticipants.$inferSelect & {
  expenseDate: string;
  expenseGroupId: string;
  expenseCategoryId: string | null;
  expenseAmount: string;
};

async function loadUserExpensesInPeriod(
  userId: string,
  from: string,
  to: string,
  groupType?: "household" | "personal",
): Promise<{
  rows: (typeof expenses.$inferSelect)[];
  parts: FlatPart[];
  groupById: Map<string, typeof groups.$inferSelect>;
}> {
  const ids = await getUserGroupIds(userId, groupType);
  if (ids.length === 0) {
    return { rows: [], parts: [], groupById: new Map() };
  }
  const [rows, parts, groupRows] = await Promise.all([
    db
      .select()
      .from(expenses)
      .where(
        and(
          inArray(expenses.groupId, ids),
          gte(expenses.date, from),
          lte(expenses.date, to),
        ),
      ),
    db
      .select({ ep: expenseParticipants, expense: expenses })
      .from(expenseParticipants)
      .innerJoin(expenses, eq(expenses.id, expenseParticipants.expenseId))
      .where(
        and(
          eq(expenseParticipants.userId, userId),
          inArray(expenses.groupId, ids),
          gte(expenses.date, from),
          lte(expenses.date, to),
        ),
      ),
    db.select().from(groups).where(inArray(groups.id, ids)),
  ]);
  const groupById = new Map(groupRows.map((g) => [g.id, g]));
  const flatParts = parts.map((p) => ({ ...p.ep, expenseDate: p.expense.date, expenseGroupId: p.expense.groupId, expenseCategoryId: p.expense.categoryId, expenseAmount: p.expense.amount }));
  return { rows, parts: flatParts, groupById };
}

users_router.get("/me/analytics", async (c) => {
  const actor = c.get("user");
  const { from, to } = parsePeriod(c);
  const { rows, parts, groupById } = await loadUserExpensesInPeriod(actor.id, from, to);

  let totalPaidCents = 0;
  let totalOwedCents = 0;
  const byGroup = new Map<string, { paid: number; owed: number }>();
  const byCategory = new Map<string | null, { paid: number; owed: number }>();

  for (const r of rows) {
    if (r.paidById === actor.id) {
      const cents = decimalToCents(r.amount);
      totalPaidCents += cents;
      const g = byGroup.get(r.groupId) ?? { paid: 0, owed: 0 };
      g.paid += cents;
      byGroup.set(r.groupId, g);
      const cat = byCategory.get(r.categoryId) ?? { paid: 0, owed: 0 };
      cat.paid += cents;
      byCategory.set(r.categoryId, cat);
    }
  }
  for (const p of parts) {
    const cents = decimalToCents(p.shareAmount);
    totalOwedCents += cents;
    const g = byGroup.get(p.expenseGroupId) ?? { paid: 0, owed: 0 };
    g.owed += cents;
    byGroup.set(p.expenseGroupId, g);
    const cat = byCategory.get(p.expenseCategoryId) ?? { paid: 0, owed: 0 };
    cat.owed += cents;
    byCategory.set(p.expenseCategoryId, cat);
  }

  const catIds = Array.from(byCategory.keys()).filter((x): x is string => !!x);
  const cats = catIds.length
    ? await db.select().from(categories).where(inArray(categories.id, catIds))
    : [];
  const catById = new Map(cats.map((c) => [c.id, c]));

  return c.json({
    period: { from, to },
    totalPaid: centsToMoney(totalPaidCents),
    totalOwed: centsToMoney(totalOwedCents),
    net: centsToMoney(totalPaidCents - totalOwedCents),
    byGroup: Array.from(byGroup.entries()).map(([gid, v]) => {
      const g = groupById.get(gid);
      return {
        groupId: gid,
        groupName: g?.name ?? "",
        type: g?.type ?? "household",
        paid: centsToMoney(v.paid),
        owed: centsToMoney(v.owed),
      };
    }),
    byCategory: Array.from(byCategory.entries()).map(([cid, v]) => {
      const cat = cid ? catById.get(cid) : null;
      return {
        categoryId: cid,
        name: cat?.name ?? "Uncategorized",
        icon: cat?.icon ?? null,
        paid: centsToMoney(v.paid),
        owed: centsToMoney(v.owed),
      };
    }),
  });
});

users_router.get("/me/analytics/trends", async (c) => {
  const actor = c.get("user");
  const { from, to } = parsePeriod(c);
  const byParam = c.req.query("by");
  const by: "day" | "week" | "month" =
    byParam === "day" || byParam === "week" || byParam === "month" ? byParam : "month";
  const type = c.req.query("type");
  const filterType =
    type === "household" || type === "personal" ? type : undefined;

  const { rows, parts, groupById } = await loadUserExpensesInPeriod(actor.id, from, to, filterType);

  type Bucket = {
    paid: number;
    owed: number;
    net: number;
    expenseCount: number;
    byCategory: Map<string | null, { paid: number; owed: number }>;
    byGroup: Map<string, { paid: number; owed: number }>;
  };
  const buckets = new Map<string, Bucket>();

  function ensure(key: string): Bucket {
    let b = buckets.get(key);
    if (!b) {
      b = { paid: 0, owed: 0, net: 0, expenseCount: 0, byCategory: new Map(), byGroup: new Map() };
      buckets.set(key, b);
    }
    return b;
  }

  for (const r of rows) {
    if (r.paidById !== actor.id) continue;
    const cents = decimalToCents(r.amount);
    const k = dateRangeKey(r.date, by);
    const b = ensure(k);
    b.paid += cents;
    b.expenseCount += 1;
    b.net = b.paid - b.owed;
    const cat = b.byCategory.get(r.categoryId) ?? { paid: 0, owed: 0 };
    cat.paid += cents;
    b.byCategory.set(r.categoryId, cat);
    const g = b.byGroup.get(r.groupId) ?? { paid: 0, owed: 0 };
    g.paid += cents;
    b.byGroup.set(r.groupId, g);
  }
  for (const p of parts) {
    const cents = decimalToCents(p.shareAmount);
    const k = dateRangeKey(p.expenseDate, by);
    const b = ensure(k);
    b.owed += cents;
    b.net = b.paid - b.owed;
    const cat = b.byCategory.get(p.expenseCategoryId) ?? { paid: 0, owed: 0 };
    cat.owed += cents;
    b.byCategory.set(p.expenseCategoryId, cat);
    const g = b.byGroup.get(p.expenseGroupId) ?? { paid: 0, owed: 0 };
    g.owed += cents;
    b.byGroup.set(p.expenseGroupId, g);
  }

  const allCatIds = new Set<string>();
  for (const b of buckets.values()) {
    for (const k of b.byCategory.keys()) if (k) allCatIds.add(k);
  }
  const cats = allCatIds.size
    ? await db
        .select()
        .from(categories)
        .where(inArray(categories.id, Array.from(allCatIds)))
    : [];
  const catById = new Map(cats.map((c) => [c.id, c]));

  return c.json({
    by,
    period: { from, to },
    buckets: Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, b]) => ({
        key,
        label: key,
        paid: centsToMoney(b.paid),
        owed: centsToMoney(b.owed),
        net: centsToMoney(b.net),
        expenseCount: b.expenseCount,
        byCategory: Array.from(b.byCategory.entries()).map(([cid, v]) => {
          const cat = cid ? catById.get(cid) : null;
          return {
            categoryId: cid,
            name: cat?.name ?? "Uncategorized",
            icon: cat?.icon ?? null,
            paid: centsToMoney(v.paid),
            owed: centsToMoney(v.owed),
          };
        }),
        byGroup: Array.from(b.byGroup.entries()).map(([gid, v]) => {
          const g = groupById.get(gid);
          return {
            groupId: gid,
            groupName: g?.name ?? "",
            type: g?.type ?? "household",
            paid: centsToMoney(v.paid),
            owed: centsToMoney(v.owed),
          };
        }),
      })),
  });
});

users_router.get("/me/analytics/export.csv", async (c) => {
  const actor = c.get("user");
  const { from, to } = parsePeriod(c);
  const { rows, parts, groupById } = await loadUserExpensesInPeriod(actor.id, from, to);

  let totalPaid = 0;
  let totalOwed = 0;
  const byGroup = new Map<string, { paid: number; owed: number }>();
  const byCategory = new Map<string | null, { paid: number; owed: number }>();

  for (const r of rows) {
    if (r.paidById !== actor.id) continue;
    const cents = decimalToCents(r.amount);
    totalPaid += cents;
    const g = byGroup.get(r.groupId) ?? { paid: 0, owed: 0 };
    g.paid += cents;
    byGroup.set(r.groupId, g);
    const cat = byCategory.get(r.categoryId) ?? { paid: 0, owed: 0 };
    cat.paid += cents;
    byCategory.set(r.categoryId, cat);
  }
  for (const p of parts) {
    const cents = decimalToCents(p.shareAmount);
    totalOwed += cents;
    const g = byGroup.get(p.expenseGroupId) ?? { paid: 0, owed: 0 };
    g.owed += cents;
    byGroup.set(p.expenseGroupId, g);
    const cat = byCategory.get(p.expenseCategoryId) ?? { paid: 0, owed: 0 };
    cat.owed += cents;
    byCategory.set(p.expenseCategoryId, cat);
  }

  const catIds = Array.from(byCategory.keys()).filter((x): x is string => !!x);
  const cats = catIds.length
    ? await db.select().from(categories).where(inArray(categories.id, catIds))
    : [];
  const catById = new Map(cats.map((c) => [c.id, c]));

  const lines = [
    "Summary",
    `Period,${from} to ${to}`,
    `Total paid,${centsToMoney(totalPaid)}`,
    `Total owed,${centsToMoney(totalOwed)}`,
    `Net,${centsToMoney(totalPaid - totalOwed)}`,
    "",
    "By Group",
    "Group,Paid,Owed",
  ];
  for (const [gid, v] of byGroup) {
    const g = groupById.get(gid);
    lines.push([csvField(g?.name ?? ""), centsToMoney(v.paid), centsToMoney(v.owed)].join(","));
  }
  lines.push("", "By Category", "Category,Paid,Owed");
  for (const [cid, v] of byCategory) {
    const cat = cid ? catById.get(cid) : null;
    lines.push(
      [
        csvField(cat?.name ?? "Uncategorized"),
        centsToMoney(v.paid),
        centsToMoney(v.owed),
      ].join(","),
    );
  }

  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="user-analytics-me-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  return c.body(lines.join("\n"));
});

// ---------- /me/people + /me/people/:id + /me/people/:id/settle -----------

users_router.get("/me/people", async (c) => {
  const actor = c.get("user");
  const myGroupIds = await getUserGroupIds(actor.id);
  if (myGroupIds.length === 0) return c.json([]);

  const [edges, sharedRows] = await Promise.all([
    loadCrossGroupEdges(actor.id),
    db
      .select({
        userId: groupMembers.userId,
        groupId: groupMembers.groupId,
      })
      .from(groupMembers)
      .where(
        and(
          inArray(groupMembers.groupId, myGroupIds),
          ne(groupMembers.userId, actor.id),
        ),
      ),
  ]);
  const myEdges = edges.filter(
    (e) => e.fromId === actor.id || e.toId === actor.id,
  );

  // Start from shared people so settled contacts stay visible.
  const perPerson = new Map<
    string,
    { youOwe: number; theyOwe: number; groups: Set<string>; lastTs: number | null }
  >();
  for (const row of sharedRows) {
    const p = perPerson.get(row.userId) ?? {
      youOwe: 0,
      theyOwe: 0,
      groups: new Set(),
      lastTs: null,
    };
    p.groups.add(row.groupId);
    perPerson.set(row.userId, p);
  }
  for (const e of myEdges) {
    const otherId = e.fromId === actor.id ? e.toId : e.fromId;
    const p = perPerson.get(otherId) ?? {
      youOwe: 0,
      theyOwe: 0,
      groups: new Set(),
      lastTs: null,
    };
    if (e.fromId === actor.id) p.youOwe += e.cents;
    else p.theyOwe += e.cents;
    p.groups.add(e.groupId);
    perPerson.set(otherId, p);
  }

  const ids = Array.from(perPerson.keys());
  if (ids.length === 0) return c.json([]);

  // Last activity per pair: most recent expense/settlement touching both.
  const [exprows, settrows, userRows] = await Promise.all([
    db
      .select({
        otherId: expenseParticipants.userId,
        ts: expenses.createdAt,
      })
      .from(expenses)
      .innerJoin(
        expenseParticipants,
        eq(expenseParticipants.expenseId, expenses.id),
      )
      .where(
        and(
          inArray(expenses.groupId, myGroupIds),
          inArray(expenseParticipants.userId, ids),
          sql`(
            ${expenses.paidById} = ${actor.id}
            OR EXISTS (
              SELECT 1
              FROM expense_participants ep_actor
              WHERE ep_actor.expense_id = ${expenses.id}
                AND ep_actor.user_id = ${actor.id}
            )
          )`,
        ),
      ),
    db
      .select({
        a: settlements.paidById,
        b: settlements.paidToId,
        ts: settlements.createdAt,
      })
      .from(settlements)
      .where(
        and(
          inArray(settlements.groupId, myGroupIds),
          sql`(${settlements.paidById} = ${actor.id} OR ${settlements.paidToId} = ${actor.id})`,
        ),
      ),
    db.select().from(users).where(inArray(users.id, ids)),
  ]);
  const userById = new Map(userRows.map((u) => [u.id, u]));

  for (const r of exprows) {
    const p = perPerson.get(r.otherId);
    if (!p) continue;
    const ts = r.ts.getTime();
    if (!p.lastTs || ts > p.lastTs) p.lastTs = ts;
  }
  for (const r of settrows) {
    const otherId = r.a === actor.id ? r.b : r.a;
    const p = perPerson.get(otherId);
    if (!p) continue;
    const ts = r.ts.getTime();
    if (!p.lastTs || ts > p.lastTs) p.lastTs = ts;
  }

  return c.json(
    ids
      .map((id) => {
        const p = perPerson.get(id)!;
        const u = userById.get(id);
        const netCents = p.theyOwe - p.youOwe;
        return {
          user: { id, name: u?.name ?? "", avatarUrl: u?.avatarUrl ?? null },
          totalYouOwe: centsToMoney(p.youOwe),
          totalTheyOwe: centsToMoney(p.theyOwe),
          net: centsToMoney(netCents),
          sharedGroupCount: p.groups.size,
          lastActivityAt: p.lastTs ? new Date(p.lastTs).toISOString() : null,
        };
      })
      .sort((a, b) => {
        const aTs = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
        const bTs = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
        if (aTs !== bTs) return bTs - aTs;

        const aNet = Math.abs(Number.parseFloat(a.net));
        const bNet = Math.abs(Number.parseFloat(b.net));
        if (aNet !== bNet) return bNet - aNet;

        return a.user.name.localeCompare(b.user.name);
      }),
  );
});

users_router.get("/me/people/:userId", async (c) => {
  const actor = c.get("user");
  const otherId = c.req.param("userId")!;
  if (otherId === actor.id) throw notFound("User not found");

  const [other] = await db.select().from(users).where(eq(users.id, otherId)).limit(1);
  if (!other) throw notFound("User not found");

  const myGroupIds = await getUserGroupIds(actor.id);
  // shared = groups where both members.
  const sharedRows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, otherId), inArray(groupMembers.groupId, myGroupIds)));
  const sharedIds = sharedRows.map((r) => r.groupId);
  if (sharedIds.length === 0) throw notFound("User not found");

  const groupRows = await db.select().from(groups).where(inArray(groups.id, sharedIds));
  const groupById = new Map(groupRows.map((g) => [g.id, g]));

  // per-group YouOwe / TheyOwe.
  const groupOut = await Promise.all(
    sharedIds.map(async (gid) => {
      const edges = await computePairwiseCents(gid);
      let youOwe = 0;
      let theyOwe = 0;
      for (const e of edges) {
        if (e.fromId === actor.id && e.toId === otherId) youOwe += e.cents;
        if (e.fromId === otherId && e.toId === actor.id) theyOwe += e.cents;
      }
      const g = groupById.get(gid)!;
      const net = theyOwe - youOwe;
      return {
        groupId: gid,
        groupName: g.name,
        type: g.type,
        youOwe: centsToMoney(youOwe),
        theyOwe: centsToMoney(theyOwe),
        net: centsToMoney(net),
        canSettle: net !== 0,
      };
    }),
  );

  const summary = groupOut.reduce(
    (acc, g) => {
      acc.youOwe += parseMoneyToCents(g.youOwe);
      acc.theyOwe += parseMoneyToCents(g.theyOwe);
      return acc;
    },
    { youOwe: 0, theyOwe: 0 },
  );

  // Recent expenses involving both: last 20.
  const recentExpenseRows = await db
    .select({
      expense: expenses,
      ep: expenseParticipants,
    })
    .from(expenses)
    .innerJoin(
      expenseParticipants,
      eq(expenseParticipants.expenseId, expenses.id),
    )
    .where(
      and(
        inArray(expenses.groupId, sharedIds),
        sql`(${expenses.paidById} = ${actor.id} OR ${expenses.paidById} = ${otherId})`,
        sql`(${expenseParticipants.userId} = ${actor.id} OR ${expenseParticipants.userId} = ${otherId})`,
      ),
    )
    .orderBy(desc(expenses.date), desc(expenses.createdAt))
    .limit(40);

  // Group participants by expense to find both yours and theirs.
  const byExpense = new Map<string, { e: typeof expenses.$inferSelect; mine?: string; theirs?: string }>();
  for (const row of recentExpenseRows) {
    const slot = byExpense.get(row.expense.id) ?? { e: row.expense };
    if (row.ep.userId === actor.id) slot.mine = row.ep.shareAmount;
    if (row.ep.userId === otherId) slot.theirs = row.ep.shareAmount;
    byExpense.set(row.expense.id, slot);
  }
  const recentExpenses = Array.from(byExpense.values())
    .slice(0, 20)
    .map((slot) => {
      const g = groupById.get(slot.e.groupId)!;
      return {
        id: slot.e.id,
        group: { id: slot.e.groupId, name: g.name, type: g.type },
        description: slot.e.description,
        amount: slot.e.amount,
        date: slot.e.date,
        paidBy: { id: slot.e.paidById, name: "" },
        yourShare: slot.mine ?? null,
        theirShare: slot.theirs ?? null,
        createdAt: slot.e.createdAt.toISOString(),
      };
    });

  const recentSettlementRows = await db
    .select()
    .from(settlements)
    .where(
      and(
        inArray(settlements.groupId, sharedIds),
        sql`(${settlements.paidById} IN (${actor.id}, ${otherId}) AND ${settlements.paidToId} IN (${actor.id}, ${otherId}))`,
      ),
    )
    .orderBy(desc(settlements.date), desc(settlements.createdAt))
    .limit(20);

  const recentSettlements = recentSettlementRows.map((s) => {
    const g = groupById.get(s.groupId)!;
    return {
      id: s.id,
      group: { id: s.groupId, name: g.name, type: g.type },
      paidBy: { id: s.paidById, name: "" },
      paidTo: { id: s.paidToId, name: "" },
      amount: s.amount,
      date: s.date,
      createdAt: s.createdAt.toISOString(),
    };
  });

  return c.json({
    user: { id: other.id, name: other.name, email: other.email, avatarUrl: other.avatarUrl },
    summary: {
      totalYouOwe: centsToMoney(summary.youOwe),
      totalTheyOwe: centsToMoney(summary.theyOwe),
      net: centsToMoney(summary.theyOwe - summary.youOwe),
    },
    groups: groupOut,
    recentExpenses,
    recentSettlements,
  });
});

users_router.post("/me/people/:userId/settle", async (c) => {
  const actor = c.get("user");
  const otherId = c.req.param("userId")!;
  if (otherId === actor.id) {
    throw unprocessable("Cannot settle with yourself");
  }
  const myGroupIds = await getUserGroupIds(actor.id);
  const sharedRows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, otherId), inArray(groupMembers.groupId, myGroupIds)));
  const sharedIds = sharedRows.map((r) => r.groupId);
  if (sharedIds.length === 0) throw notFound("User not found");

  const created: Array<typeof settlements.$inferSelect> = [];
  for (const gid of sharedIds) {
    const edges = await computePairwiseCents(gid);
    let net = 0;
    for (const e of edges) {
      if (e.fromId === actor.id && e.toId === otherId) net += e.cents;
      else if (e.fromId === otherId && e.toId === actor.id) net -= e.cents;
    }
    if (net === 0) continue;
    const paidById = net > 0 ? actor.id : otherId;
    const paidToId = net > 0 ? otherId : actor.id;
    const autoConfirm = actor.id === paidToId;
    const [s] = await db
      .insert(settlements)
      .values({
        groupId: gid,
        paidById,
        paidToId,
        amount: centsToMoney(Math.abs(net)),
        date: new Date().toISOString().slice(0, 10),
        notes: "Cross-group settle",
        status: autoConfirm ? "confirmed" : "pending",
        reviewedAt: autoConfirm ? new Date() : null,
      })
      .returning();
    if (s) {
      created.push(s);
      await recordAudit({
        groupId: gid,
        actorId: actor.id,
        action: "created",
        resourceType: "settlement",
        resourceId: s.id,
        summary: `${actor.name} recorded a payment of ${s.amount}`,
      });
      if (!autoConfirm) {
        await notify({
          kind: "settlement_request",
          settlementId: s.id,
          groupId: gid,
          recipientId: paidToId,
        });
      }
    }
  }

  if (created.length === 0) {
    throw unprocessable("Net balance is already zero");
  }

  const userRows = await db
    .select()
    .from(users)
    .where(inArray(users.id, [actor.id, otherId]));
  const userById = new Map(userRows.map((u) => [u.id, u]));

  return c.json(
    {
      settlements: created.map((s) => ({
        id: s.id,
        paidBy: {
          id: s.paidById,
          name: userById.get(s.paidById)?.name ?? "",
          avatarUrl: userById.get(s.paidById)?.avatarUrl ?? null,
        },
        paidTo: {
          id: s.paidToId,
          name: userById.get(s.paidToId)?.name ?? "",
          avatarUrl: userById.get(s.paidToId)?.avatarUrl ?? null,
        },
        amount: s.amount,
        date: s.date,
        status: s.status,
        notes: s.notes,
        reviewedAt: s.reviewedAt?.toISOString() ?? null,
        reviewNotes: s.reviewNotes,
        createdAt: s.createdAt.toISOString(),
      })),
    },
    201,
  );
});

// ---------- /me/activity + /me/dashboard ---------------------------------

users_router.get("/me/activity", async (c) => {
  const actor = c.get("user");
  const { page, limit } = parsePagination(c);
  const groupQ = c.req.query("groupId");

  const ids = groupQ ? [groupQ] : await getUserGroupIds(actor.id);
  if (ids.length === 0) {
    return c.json({ data: [], meta: buildPaginationMeta(0, page, limit) });
  }

  const filters = [inArray(auditLogs.groupId, ids)];
  const [{ total }] = (await db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(...filters))) as [{ total: number }];

  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(...filters))
    .orderBy(desc(auditLogs.createdAt))
    .offset((page - 1) * limit)
    .limit(limit);

  const groupRows = await db.select().from(groups).where(inArray(groups.id, ids));
  const groupById = new Map(groupRows.map((g) => [g.id, g]));
  const actorIds = Array.from(new Set(rows.map((r) => r.actorId)));
  const actors = actorIds.length
    ? await db.select().from(users).where(inArray(users.id, actorIds))
    : [];
  const actorById = new Map(actors.map((u) => [u.id, u]));

  return c.json({
    data: rows.map((r) => {
      const a = actorById.get(r.actorId);
      const g = groupById.get(r.groupId);
      return {
        id: r.id,
        type: `${r.resourceType}_${r.action}`,
        actor: a ? { id: a.id, name: a.name, avatarUrl: a.avatarUrl } : null,
        summary: r.summary,
        group: g ? { id: g.id, name: g.name, type: g.type } : null,
        payload: r.after ?? r.before ?? null,
        createdAt: r.createdAt.toISOString(),
      };
    }),
    meta: buildPaginationMeta(total, page, limit),
  });
});

users_router.get("/me/dashboard", async (c) => {
  const actor = c.get("user");

  const edges = await loadCrossGroupEdges(actor.id);
  let totalOwed = 0;
  let totalYouOwe = 0;
  for (const e of edges) {
    if (e.toId === actor.id) totalOwed += e.cents;
    if (e.fromId === actor.id) totalYouOwe += e.cents;
  }

  const ids = await getUserGroupIds(actor.id);
  const groupRows = ids.length ? await db.select().from(groups).where(inArray(groups.id, ids)) : [];
  const memberCountRows = ids.length
    ? await db
        .select({
          groupId: groupMembers.groupId,
          n: sql<number>`count(*)::int`,
        })
        .from(groupMembers)
        .where(inArray(groupMembers.groupId, ids))
        .groupBy(groupMembers.groupId)
    : [];
  const memberCountByGroup = new Map(memberCountRows.map((r) => [r.groupId, r.n]));
  const balanceByGroup = new Map<string, number>();
  for (const e of edges) {
    if (e.toId === actor.id) balanceByGroup.set(e.groupId, (balanceByGroup.get(e.groupId) ?? 0) + e.cents);
    if (e.fromId === actor.id) balanceByGroup.set(e.groupId, (balanceByGroup.get(e.groupId) ?? 0) - e.cents);
  }

  const recentActivity = ids.length
    ? await db
        .select({ log: auditLogs })
        .from(auditLogs)
        .where(inArray(auditLogs.groupId, ids))
        .orderBy(desc(auditLogs.createdAt))
        .limit(10)
    : [];
  const recentActorIds = Array.from(new Set(recentActivity.map((r) => r.log.actorId)));
  const recentActors = recentActorIds.length
    ? await db.select().from(users).where(inArray(users.id, recentActorIds))
    : [];
  const recentActorById = new Map(recentActors.map((u) => [u.id, u]));
  const groupById = new Map(groupRows.map((g) => [g.id, g]));

  // upcoming recurring (next 3 by recurAnchor).
  const upcoming = ids.length
    ? await db
        .select({ e: expenses })
        .from(expenses)
        .where(and(inArray(expenses.groupId, ids), eq(expenses.isRecurring, true)))
        .orderBy(asc(expenses.recurAnchor))
        .limit(3)
    : [];

  return c.json({
    user: { id: actor.id, name: actor.name, avatarUrl: null },
    balanceSummary: {
      totalOwed: centsToMoney(totalOwed),
      totalYouOwe: centsToMoney(totalYouOwe),
      net: centsToMoney(totalOwed - totalYouOwe),
    },
    groups: groupRows.map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      yourBalance: centsToMoney(balanceByGroup.get(g.id) ?? 0),
      memberCount: memberCountByGroup.get(g.id) ?? 0,
    })),
    recentActivity: recentActivity.map(({ log }) => ({
      type: `${log.resourceType}_${log.action}`,
      actor: { name: recentActorById.get(log.actorId)?.name ?? "" },
      summary: log.summary,
      group: { name: groupById.get(log.groupId)?.name ?? "" },
      createdAt: log.createdAt.toISOString(),
    })),
    upcomingRecurring: upcoming.map(({ e }) => ({
      expenseId: e.id,
      description: e.description,
      amount: e.amount,
      recurAnchor: e.recurAnchor,
      groupName: groupById.get(e.groupId)?.name ?? "",
    })),
  });
});

// ---------- csv helper ----------------------------------------------------

function csvField(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export { users_router as users };

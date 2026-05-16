import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { env } from "./env.js";

let client: S3Client | undefined;

export const UPLOAD_KINDS = [
  "receipt",
  "avatar",
  "group_cover",
  "bill_proof",
  "asset_photo",
  "deposit_proof",
  "hra_receipt_pdf",
  "other",
] as const;

export type UploadKind = (typeof UPLOAD_KINDS)[number];

export function s3(): S3Client {
  if (!client) {
    client = new S3Client({ region: env.AWS_REGION });
  }
  return client;
}

export function mimeToStorageExt(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/heic") return "heic";
  if (mime === "application/pdf") return "pdf";
  return "bin";
}

function utcYearMonth(now = new Date()) {
  return {
    year: String(now.getUTCFullYear()),
    month: String(now.getUTCMonth() + 1).padStart(2, "0"),
  };
}

export function buildUploadStorageKey(input: {
  ownerId: string;
  mimeType: string;
  kind?: UploadKind;
  groupId?: string | null;
  now?: Date;
}): string {
  const { year, month } = utcYearMonth(input.now);
  const kind = input.kind ?? "receipt";
  const ext = mimeToStorageExt(input.mimeType);
  const id = randomUUID();

  if (input.groupId) {
    return `groups/${input.groupId}/uploads/${kind}/${year}/${month}/users/${input.ownerId}/${id}.${ext}`;
  }

  return `users/${input.ownerId}/uploads/${kind}/${year}/${month}/${id}.${ext}`;
}

export function buildHraReceiptStorageKey(ownerId: string, now = new Date()): string {
  const { year, month } = utcYearMonth(now);
  return `users/${ownerId}/generated/hra-receipts/${year}/${month}/${randomUUID()}.pdf`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isUploadStorageKeyForContext(
  key: string,
  input: {
    ownerId: string;
    mimeType: string;
    kind?: UploadKind;
    groupId?: string | null;
  },
): boolean {
  const ownerId = escapeRegExp(input.ownerId);
  const groupId = input.groupId ? escapeRegExp(input.groupId) : null;
  const kind = escapeRegExp(input.kind ?? "receipt");
  const ext = escapeRegExp(mimeToStorageExt(input.mimeType));
  const year = String.raw`\d{4}`;
  const month = String.raw`(?:0[1-9]|1[0-2])`;
  const uuid = String.raw`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}`;

  const personalKey = new RegExp(
    `^users/${ownerId}/uploads/${kind}/${year}/${month}/${uuid}\\.${ext}$`,
  );
  if (personalKey.test(key)) return true;

  if (groupId) {
    const groupKey = new RegExp(
      `^groups/${groupId}/uploads/${kind}/${year}/${month}/users/${ownerId}/${uuid}\\.${ext}$`,
    );
    if (groupKey.test(key)) return true;
  }

  // Legacy keys generated before the structured layout was introduced.
  return new RegExp(`^${year}/${month}/${ownerId}/${uuid}\\.${ext}$`).test(key);
}

export function publicStorageUrl(key: string): string {
  return `/uploads/${key}`;
}

export async function presignPut(key: string, contentType: string, expiresIn = 300) {
  const cmd = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3(), cmd, { expiresIn });
}

export async function presignGet(key: string, expiresIn = 300) {
  const cmd = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key });
  return getSignedUrl(s3(), cmd, { expiresIn });
}

export function attachmentContentDisposition(filename: string): string {
  const fallback = filename
    .replace(/[/\\]/g, "-")
    .replace(/[\r\n"]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_")
    .trim() || "download";
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function presignDownload(
  key: string,
  filename: string,
  contentType = "application/octet-stream",
  expiresIn = 300,
) {
  const cmd = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ResponseContentDisposition: attachmentContentDisposition(filename),
    ResponseContentType: contentType,
  });
  return getSignedUrl(s3(), cmd, { expiresIn });
}

export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

// One-shot migration: pulls data from the old TypeORM local Postgres backend
// and writes it into the new Neon Drizzle backend.
//
// Wipes the target first. Maps users:
//   - mohakgupta102@gmail.com keeps its already-provisioned Firebase UID
//   - other users get firebase_uid = "legacy:<email>" placeholders so the
//     login handler can match-and-upgrade them by email later.
//
// Run with:
//   SOURCE_DATABASE_URL=postgresql://mohak:mohakgupta02@localhost:5433/splitwise \
//   tsx src/scripts/migrate-from-typeorm.ts

import "./_env-bootstrap.js";
import pg from "pg";

const SOURCE_URL =
  process.env.SOURCE_DATABASE_URL ??
  "postgresql://mohak:mohakgupta02@localhost:5433/splitwise";
const TARGET_URL = process.env.DATABASE_URL;
if (!TARGET_URL) throw new Error("DATABASE_URL (target Neon) is required");

const PRESERVED_FIREBASE_UIDS: Record<string, string> = {
  "mohakgupta102@gmail.com": "tBUW2ptKJVRES2NAeWVeeMORmhg2",
};

const src = new pg.Pool({ connectionString: SOURCE_URL });
const tgt = new pg.Pool({
  connectionString: TARGET_URL,
  ssl: TARGET_URL.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
});

async function counts(pool: pg.Pool, label: string) {
  const tables = [
    "users",
    "groups",
    "group_members",
    "categories",
    "tags",
    "expenses",
    "expense_participants",
    "expense_items",
    "expense_tags",
    "settlements",
    "audit_logs",
    "budgets",
    "uploaded_files",
  ];
  const parts = tables.map((t) => `SELECT '${t}' AS t, COUNT(*)::int AS c FROM ${t}`);
  const { rows } = await pool.query(parts.join(" UNION ALL "));
  console.log(`\n${label} counts:`);
  for (const r of rows) console.log(`  ${r.t.padEnd(22)} ${r.c}`);
}

async function wipeTarget() {
  console.log("\nwiping target tables…");
  await tgt.query(`
    TRUNCATE TABLE
      audit_logs,
      budgets,
      uploaded_files,
      expense_items,
      expense_tags,
      expense_participants,
      expenses,
      settlements,
      tags,
      categories,
      group_members,
      groups,
      users
    RESTART IDENTITY CASCADE
  `);
}

async function copyUsers() {
  const { rows } = await src.query(
    `SELECT id, email, name, avatar_url, upi_id, phone, created_at, updated_at
     FROM users ORDER BY created_at`,
  );
  for (const u of rows) {
    const preserved = PRESERVED_FIREBASE_UIDS[u.email];
    const firebaseUid = preserved ?? `legacy:${u.email}`;
    await tgt.query(
      `INSERT INTO users
        (id, firebase_uid, email, email_verified, phone, name, avatar_url, upi_id,
         last_sign_in_provider, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        u.id,
        firebaseUid,
        u.email,
        preserved !== undefined,
        u.phone,
        u.name,
        u.avatar_url,
        u.upi_id,
        preserved ? "password" : null,
        u.created_at,
        u.updated_at,
      ],
    );
  }
  console.log(`  users: ${rows.length}`);
}

async function copySimple(table: string, columns: string[], orderBy = "1") {
  const { rows } = await src.query(`SELECT ${columns.join(", ")} FROM ${table} ORDER BY ${orderBy}`);
  if (rows.length === 0) {
    console.log(`  ${table}: 0 (skipped)`);
    return;
  }
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
  for (const row of rows) {
    await tgt.query(
      sql,
      columns.map((c) => row[c]),
    );
  }
  console.log(`  ${table}: ${rows.length}`);
}

async function copyExpenses() {
  const { rows } = await src.query(`SELECT * FROM expenses ORDER BY created_at`);
  for (const e of rows) {
    await tgt.query(
      `INSERT INTO expenses
        (id, group_id, paid_by, amount, description, category_id, split_type, date,
         notes, is_recurring, recur_interval, recur_anchor, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::split_type,$8,$9,$10,$11::recur_interval,$12,$13,$14,$15)`,
      [
        e.id,
        e.group_id,
        e.paid_by,
        e.amount,
        e.description,
        e.category_id,
        e.split_type,
        e.date,
        e.notes,
        e.is_recurring,
        e.recur_interval,
        e.recur_anchor,
        e.created_by,
        e.created_at,
        e.updated_at,
      ],
    );
  }
  console.log(`  expenses: ${rows.length}`);
}

async function copyUploadedFiles() {
  const { rows } = await src.query(`SELECT * FROM uploaded_files ORDER BY created_at`);
  for (const u of rows) {
    await tgt.query(
      `INSERT INTO uploaded_files
        (id, owner_id, group_id, expense_id, kind, original_name, mime_type, size_bytes,
         storage_path, public_url, ocr_data, ocr_model, created_at)
       VALUES ($1,$2,$3,$4,$5::upload_kind,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        u.id,
        u.owner_id,
        u.group_id,
        u.expense_id,
        u.kind,
        u.original_name,
        u.mime_type,
        u.size_bytes,
        u.storage_path,
        u.public_url,
        u.ocr_data,
        u.ocr_model,
        u.created_at,
      ],
    );
  }
  console.log(`  uploaded_files: ${rows.length}`);
}

// pg-node serializes JS arrays as Postgres array literals (not JSON), which
// breaks jsonb columns whose contents are JSON arrays. Stringify defensively.
function jsonbParam(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return JSON.stringify(v);
}

async function copyAuditLogs() {
  const { rows } = await src.query(`SELECT * FROM audit_logs ORDER BY created_at`);
  for (const a of rows) {
    await tgt.query(
      `INSERT INTO audit_logs
        (id, group_id, actor_id, action, resource_type, resource_id, summary,
         before, after, changed_fields, created_at)
       VALUES ($1,$2,$3,$4::audit_action,$5::audit_resource_type,$6,$7,$8,$9,$10,$11)`,
      [
        a.id,
        a.group_id,
        a.actor_id,
        a.action,
        a.resource_type,
        a.resource_id,
        a.summary,
        jsonbParam(a.before),
        jsonbParam(a.after),
        jsonbParam(a.changed_fields),
        a.created_at,
      ],
    );
  }
  console.log(`  audit_logs: ${rows.length}`);
}

async function main() {
  await counts(src, "SOURCE");
  await counts(tgt, "TARGET (before)");

  await wipeTarget();

  console.log("\ncopying…");
  await copyUsers();
  await copySimple(
    "groups",
    ["id", "name", "description", "type", "created_by", "invite_code", "created_at", "updated_at"],
    "created_at",
  );
  await copySimple("group_members", ["group_id", "user_id", "role", "joined_at"], "joined_at");
  await copySimple("categories", ["id", "group_id", "name", "icon", "color"], "name");
  await copySimple("tags", ["id", "group_id", "name", "color"], "name");
  await copyExpenses();
  await copySimple(
    "expense_participants",
    ["id", "expense_id", "user_id", "share_amount", "split_input"],
    "id",
  );
  await copyUploadedFiles();
  await copySimple(
    "expense_items",
    [
      "id",
      "expense_id",
      "position",
      "name",
      "quantity",
      "unit_price",
      "total_price",
      "category_id",
      "source_file_id",
      "metadata",
      "created_at",
    ],
    "created_at",
  );
  await copySimple("expense_tags", ["expense_id", "tag_id"], "expense_id");
  await copySimple(
    "settlements",
    [
      "id",
      "group_id",
      "paid_by",
      "paid_to",
      "amount",
      "date",
      "notes",
      "status",
      "reviewed_at",
      "review_notes",
      "created_at",
    ],
    "created_at",
  );
  await copySimple(
    "budgets",
    ["id", "group_id", "category_id", "month", "amount", "created_by", "created_at", "updated_at"],
    "created_at",
  );
  await copyAuditLogs();

  await counts(tgt, "TARGET (after)");

  await src.end();
  await tgt.end();
  console.log("\n✅ migration complete");
}

main().catch(async (err) => {
  console.error("\n❌ migration failed:", err);
  await src.end().catch(() => {});
  await tgt.end().catch(() => {});
  process.exit(1);
});

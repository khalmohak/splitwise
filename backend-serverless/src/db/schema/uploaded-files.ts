import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { uploadKindEnum } from "./enums";
import { users } from "./users";
import { groups } from "./groups";
import { expenses } from "./expenses";

export const uploadedFiles = pgTable(
  "uploaded_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references((): AnyPgColumn => groups.id, {
      onDelete: "set null",
    }),
    expenseId: uuid("expense_id").references((): AnyPgColumn => expenses.id, {
      onDelete: "set null",
    }),
    kind: uploadKindEnum("kind").notNull().default("receipt"),
    originalName: varchar("original_name").notNull(),
    mimeType: varchar("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storagePath: varchar("storage_path").notNull(),
    publicUrl: varchar("public_url").notNull(),
    ocrData: jsonb("ocr_data"),
    ocrModel: varchar("ocr_model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerCreatedIdx: index("uploaded_files_owner_id_created_at_idx").on(t.ownerId, t.createdAt),
  }),
);

export const uploadedFilesRelations = relations(uploadedFiles, ({ one }) => ({
  owner: one(users, { fields: [uploadedFiles.ownerId], references: [users.id] }),
  group: one(groups, { fields: [uploadedFiles.groupId], references: [groups.id] }),
  expense: one(expenses, { fields: [uploadedFiles.expenseId], references: [expenses.id] }),
}));

export type UploadedFile = typeof uploadedFiles.$inferSelect;
export type NewUploadedFile = typeof uploadedFiles.$inferInsert;

import { relations } from "drizzle-orm";
import { date, index, numeric, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { depositEntryTypeEnum } from "./enums";
import { groups } from "./groups";
import { users } from "./users";
import { uploadedFiles } from "./uploaded-files";

export const depositLedgerEntries = pgTable(
  "deposit_ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    entryType: depositEntryTypeEnum("entry_type").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    fromUserId: uuid("from_user_id").references(() => users.id, { onDelete: "set null" }),
    toUserId: uuid("to_user_id").references(() => users.id, { onDelete: "set null" }),
    effectiveDate: date("effective_date").notNull(),
    proofFileId: uuid("proof_file_id").references(() => uploadedFiles.id, {
      onDelete: "set null",
    }),
    notes: varchar("notes", { length: 1000 }),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    groupDateIdx: index("deposit_ledger_entries_group_id_effective_date_idx").on(
      t.groupId,
      t.effectiveDate,
    ),
  }),
);

export const depositLedgerEntriesRelations = relations(depositLedgerEntries, ({ one }) => ({
  group: one(groups, {
    fields: [depositLedgerEntries.groupId],
    references: [groups.id],
  }),
  fromUser: one(users, {
    fields: [depositLedgerEntries.fromUserId],
    references: [users.id],
  }),
  toUser: one(users, {
    fields: [depositLedgerEntries.toUserId],
    references: [users.id],
  }),
  proofFile: one(uploadedFiles, {
    fields: [depositLedgerEntries.proofFileId],
    references: [uploadedFiles.id],
  }),
  createdBy: one(users, {
    fields: [depositLedgerEntries.createdById],
    references: [users.id],
  }),
}));

export type DepositLedgerEntry = typeof depositLedgerEntries.$inferSelect;
export type NewDepositLedgerEntry = typeof depositLedgerEntries.$inferInsert;

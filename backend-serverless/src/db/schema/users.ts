import { relations } from "drizzle-orm";
import { type AnyPgColumn, boolean, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { groupMembers } from "./groups";
import { expenses } from "./expenses";
import { expenseParticipants } from "./expense-participants";
import { settlements } from "./settlements";
import { uploadedFiles } from "./uploaded-files";
import { settlementMethodEnum } from "./enums";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  firebaseUid: varchar("firebase_uid", { length: 128 }).notNull().unique(),
  email: varchar("email"),
  emailVerified: boolean("email_verified").notNull().default(false),
  phone: varchar("phone"),
  name: varchar("name").notNull(),
  avatarUrl: varchar("avatar_url"),
  avatarFileId: uuid("avatar_file_id").references((): AnyPgColumn => uploadedFiles.id, {
    onDelete: "set null",
  }),
  upiId: varchar("upi_id"),
  preferredSettlementMethod: settlementMethodEnum("preferred_settlement_method"),
  lastSignInProvider: varchar("last_sign_in_provider"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many, one }) => ({
  groupMemberships: many(groupMembers),
  expensesPaid: many(expenses, { relationName: "expense_paid_by" }),
  expensesCreated: many(expenses, { relationName: "expense_created_by" }),
  expenseParticipations: many(expenseParticipants),
  settlementsMade: many(settlements, { relationName: "settlement_paid_by" }),
  settlementsReceived: many(settlements, { relationName: "settlement_paid_to" }),
  avatarFile: one(uploadedFiles, {
    fields: [users.avatarFileId],
    references: [uploadedFiles.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

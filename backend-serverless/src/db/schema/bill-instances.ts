import { relations } from "drizzle-orm";
import {
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { billInstanceStatusEnum } from "./enums";
import { billTemplates } from "./bill-templates";
import { groups } from "./groups";
import { users } from "./users";
import { uploadedFiles } from "./uploaded-files";
import { expenses } from "./expenses";

export const billInstances = pgTable(
  "bill_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => billTemplates.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 200 }).notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    dueDate: date("due_date").notNull(),
    status: billInstanceStatusEnum("status").notNull().default("due"),
    amount: numeric("amount", { precision: 12, scale: 2 }),
    defaultPayerUserId: uuid("default_payer_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actualPayerUserId: uuid("actual_payer_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    proofFileId: uuid("proof_file_id").references(() => uploadedFiles.id, {
      onDelete: "set null",
    }),
    generatedExpenseId: uuid("generated_expense_id").references(() => expenses.id, {
      onDelete: "set null",
    }),
    residentSnapshot: jsonb("resident_snapshot").notNull(),
    splitSnapshot: jsonb("split_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    groupStatusDueIdx: index("bill_instances_group_id_status_due_date_idx").on(
      t.groupId,
      t.status,
      t.dueDate,
    ),
    templatePeriodUq: uniqueIndex("bill_instances_template_period_uq").on(
      t.templateId,
      t.periodStart,
      t.periodEnd,
    ),
  }),
);

export const billInstancesRelations = relations(billInstances, ({ one }) => ({
  template: one(billTemplates, {
    fields: [billInstances.templateId],
    references: [billTemplates.id],
  }),
  group: one(groups, { fields: [billInstances.groupId], references: [groups.id] }),
  defaultPayer: one(users, {
    fields: [billInstances.defaultPayerUserId],
    references: [users.id],
  }),
  actualPayer: one(users, {
    fields: [billInstances.actualPayerUserId],
    references: [users.id],
  }),
  proofFile: one(uploadedFiles, {
    fields: [billInstances.proofFileId],
    references: [uploadedFiles.id],
  }),
  generatedExpense: one(expenses, {
    fields: [billInstances.generatedExpenseId],
    references: [expenses.id],
  }),
}));

export type BillInstance = typeof billInstances.$inferSelect;
export type NewBillInstance = typeof billInstances.$inferInsert;

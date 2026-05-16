import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { recurIntervalEnum, splitTypeEnum } from "./enums";
import { groups } from "./groups";
import { users } from "./users";
import { categories } from "./categories";
import { expenseParticipants } from "./expense-participants";
import { expenseItems } from "./expense-items";
import { expenseTags } from "./tags";

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id")
    .notNull()
    .references((): AnyPgColumn => groups.id, { onDelete: "cascade" }),
  paidById: uuid("paid_by")
    .notNull()
    .references((): AnyPgColumn => users.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  description: varchar("description").notNull(),
  categoryId: uuid("category_id").references((): AnyPgColumn => categories.id, {
    onDelete: "set null",
  }),
  splitType: splitTypeEnum("split_type").notNull(),
  date: date("date").notNull(),
  notes: text("notes"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurInterval: recurIntervalEnum("recur_interval"),
  recurAnchor: date("recur_anchor"),
  createdById: uuid("created_by")
    .notNull()
    .references((): AnyPgColumn => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const expensesRelations = relations(expenses, ({ one, many }) => ({
  group: one(groups, { fields: [expenses.groupId], references: [groups.id] }),
  paidByUser: one(users, {
    fields: [expenses.paidById],
    references: [users.id],
    relationName: "expense_paid_by",
  }),
  createdByUser: one(users, {
    fields: [expenses.createdById],
    references: [users.id],
    relationName: "expense_created_by",
  }),
  category: one(categories, { fields: [expenses.categoryId], references: [categories.id] }),
  participants: many(expenseParticipants),
  items: many(expenseItems),
  expenseTags: many(expenseTags),
}));

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;

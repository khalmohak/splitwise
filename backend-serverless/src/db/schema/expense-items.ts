import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { expenses } from "./expenses";
import { categories } from "./categories";
import { uploadedFiles } from "./uploaded-files";

export const expenseItems = pgTable(
  "expense_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 3 }),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
    totalPrice: numeric("total_price", { precision: 12, scale: 2 }).notNull(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    sourceFileId: uuid("source_file_id").references(() => uploadedFiles.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    expensePositionIdx: index("expense_items_expense_id_position_idx").on(t.expenseId, t.position),
  }),
);

export const expenseItemsRelations = relations(expenseItems, ({ one }) => ({
  expense: one(expenses, { fields: [expenseItems.expenseId], references: [expenses.id] }),
  category: one(categories, { fields: [expenseItems.categoryId], references: [categories.id] }),
  sourceFile: one(uploadedFiles, {
    fields: [expenseItems.sourceFileId],
    references: [uploadedFiles.id],
  }),
}));

export type ExpenseItem = typeof expenseItems.$inferSelect;
export type NewExpenseItem = typeof expenseItems.$inferInsert;

import { relations } from "drizzle-orm";
import { numeric, pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { groups } from "./groups";
import { categories } from "./categories";
import { users } from "./users";

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    // null = group-wide budget (across all categories)
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    month: varchar("month", { length: 7 }).notNull(), // YYYY-MM
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    createdById: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqGroupCategoryMonth: unique("UQ_budgets_group_category_month").on(
      t.groupId,
      t.categoryId,
      t.month,
    ),
  }),
);

export const budgetsRelations = relations(budgets, ({ one }) => ({
  group: one(groups, { fields: [budgets.groupId], references: [groups.id] }),
  category: one(categories, { fields: [budgets.categoryId], references: [categories.id] }),
  createdByUser: one(users, { fields: [budgets.createdById], references: [users.id] }),
}));

export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;

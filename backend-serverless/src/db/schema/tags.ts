import { relations } from "drizzle-orm";
import { pgTable, primaryKey, uuid, varchar } from "drizzle-orm/pg-core";
import { groups } from "./groups";
import { expenses } from "./expenses";

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  // null = system-wide tag (mirrors categories.group_id)
  groupId: uuid("group_id").references(() => groups.id, { onDelete: "cascade" }),
  name: varchar("name").notNull(),
  color: varchar("color"),
});

export const expenseTags = pgTable(
  "expense_tags",
  {
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.expenseId, t.tagId] }),
  }),
);

export const tagsRelations = relations(tags, ({ one, many }) => ({
  group: one(groups, { fields: [tags.groupId], references: [groups.id] }),
  expenseTags: many(expenseTags),
}));

export const expenseTagsRelations = relations(expenseTags, ({ one }) => ({
  expense: one(expenses, { fields: [expenseTags.expenseId], references: [expenses.id] }),
  tag: one(tags, { fields: [expenseTags.tagId], references: [tags.id] }),
}));

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type ExpenseTag = typeof expenseTags.$inferSelect;
export type NewExpenseTag = typeof expenseTags.$inferInsert;

import { relations } from "drizzle-orm";
import { type AnyPgColumn, pgTable, uuid, varchar } from "drizzle-orm/pg-core";
import { groups } from "./groups";
import { expenses } from "./expenses";

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  // null = system-wide default category
  groupId: uuid("group_id").references((): AnyPgColumn => groups.id, {
    onDelete: "cascade",
  }),
  name: varchar("name").notNull(),
  icon: varchar("icon"),
  color: varchar("color"),
});

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  group: one(groups, { fields: [categories.groupId], references: [groups.id] }),
  expenses: many(expenses),
}));

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

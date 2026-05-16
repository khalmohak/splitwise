import { relations } from "drizzle-orm";
import { date, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { settlementStatusEnum } from "./enums";
import { groups } from "./groups";
import { users } from "./users";

export const settlements = pgTable("settlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  paidById: uuid("paid_by")
    .notNull()
    .references(() => users.id),
  paidToId: uuid("paid_to")
    .notNull()
    .references(() => users.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  date: date("date").notNull(),
  notes: text("notes"),
  status: settlementStatusEnum("status").notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settlementsRelations = relations(settlements, ({ one }) => ({
  group: one(groups, { fields: [settlements.groupId], references: [groups.id] }),
  paidByUser: one(users, {
    fields: [settlements.paidById],
    references: [users.id],
    relationName: "settlement_paid_by",
  }),
  paidToUser: one(users, {
    fields: [settlements.paidToId],
    references: [users.id],
    relationName: "settlement_paid_to",
  }),
}));

export type Settlement = typeof settlements.$inferSelect;
export type NewSettlement = typeof settlements.$inferInsert;

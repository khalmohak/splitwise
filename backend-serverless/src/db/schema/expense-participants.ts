import { relations } from "drizzle-orm";
import { numeric, pgTable, uuid } from "drizzle-orm/pg-core";
import { expenses } from "./expenses";
import { users } from "./users";

export const expenseParticipants = pgTable("expense_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  expenseId: uuid("expense_id")
    .notNull()
    .references(() => expenses.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  shareAmount: numeric("share_amount", { precision: 12, scale: 2 }).notNull(),
  splitInput: numeric("split_input", { precision: 12, scale: 4 }),
});

export const expenseParticipantsRelations = relations(expenseParticipants, ({ one }) => ({
  expense: one(expenses, { fields: [expenseParticipants.expenseId], references: [expenses.id] }),
  user: one(users, { fields: [expenseParticipants.userId], references: [users.id] }),
}));

export type ExpenseParticipant = typeof expenseParticipants.$inferSelect;
export type NewExpenseParticipant = typeof expenseParticipants.$inferInsert;

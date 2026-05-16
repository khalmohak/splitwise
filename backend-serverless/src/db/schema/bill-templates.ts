import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  uuid,
  varchar,
  integer,
} from "drizzle-orm/pg-core";
import {
  billAmountModeEnum,
  billKindEnum,
  billSplitStrategyEnum,
  recurIntervalEnum,
} from "./enums";
import { groups } from "./groups";
import { users } from "./users";

export const billTemplates = pgTable(
  "bill_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    billKind: billKindEnum("bill_kind").notNull().default("other"),
    vendorName: varchar("vendor_name", { length: 160 }),
    amountMode: billAmountModeEnum("amount_mode").notNull().default("fixed"),
    defaultAmount: numeric("default_amount", { precision: 12, scale: 2 }),
    currency: varchar("currency", { length: 3 }).notNull().default("INR"),
    dueDay: integer("due_day").notNull(),
    cadence: recurIntervalEnum("cadence").notNull().default("monthly"),
    defaultPayerUserId: uuid("default_payer_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    splitStrategy: billSplitStrategyEnum("split_strategy")
      .notNull()
      .default("equal_active_residents"),
    splitConfig: jsonb("split_config"),
    collectProofImage: boolean("collect_proof_image").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    notes: varchar("notes", { length: 1000 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    groupActiveIdx: index("bill_templates_group_id_is_active_idx").on(t.groupId, t.isActive),
  }),
);

export const billTemplatesRelations = relations(billTemplates, ({ one }) => ({
  group: one(groups, { fields: [billTemplates.groupId], references: [groups.id] }),
  defaultPayer: one(users, {
    fields: [billTemplates.defaultPayerUserId],
    references: [users.id],
  }),
}));

export type BillTemplate = typeof billTemplates.$inferSelect;
export type NewBillTemplate = typeof billTemplates.$inferInsert;

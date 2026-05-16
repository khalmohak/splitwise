import { relations } from "drizzle-orm";
import {
  numeric,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
  date,
  index,
} from "drizzle-orm/pg-core";
import { assetStatusEnum } from "./enums";
import { groups } from "./groups";
import { uploadedFiles } from "./uploaded-files";
import { expenses } from "./expenses";
import { users } from "./users";

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    category: varchar("category", { length: 120 }),
    photoFileId: uuid("photo_file_id").references(() => uploadedFiles.id, {
      onDelete: "set null",
    }),
    purchaseDate: date("purchase_date"),
    purchaseAmount: numeric("purchase_amount", { precision: 12, scale: 2 }),
    purchaseExpenseId: uuid("purchase_expense_id").references(() => expenses.id, {
      onDelete: "set null",
    }),
    status: assetStatusEnum("status").notNull().default("active"),
    currentHolderUserId: uuid("current_holder_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    notes: varchar("notes", { length: 1000 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    groupStatusIdx: index("assets_group_id_status_idx").on(t.groupId, t.status),
  }),
);

export const assetOwnerships = pgTable(
  "asset_ownerships",
  {
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ownershipPercent: numeric("ownership_percent", { precision: 7, scale: 4 }),
    ownershipAmount: numeric("ownership_amount", { precision: 12, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.assetId, t.userId] }),
  }),
);

export const assetsRelations = relations(assets, ({ one, many }) => ({
  group: one(groups, { fields: [assets.groupId], references: [groups.id] }),
  photoFile: one(uploadedFiles, {
    fields: [assets.photoFileId],
    references: [uploadedFiles.id],
  }),
  purchaseExpense: one(expenses, {
    fields: [assets.purchaseExpenseId],
    references: [expenses.id],
  }),
  currentHolder: one(users, {
    fields: [assets.currentHolderUserId],
    references: [users.id],
  }),
  ownerships: many(assetOwnerships),
}));

export const assetOwnershipsRelations = relations(assetOwnerships, ({ one }) => ({
  asset: one(assets, { fields: [assetOwnerships.assetId], references: [assets.id] }),
  user: one(users, { fields: [assetOwnerships.userId], references: [users.id] }),
}));

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
export type AssetOwnership = typeof assetOwnerships.$inferSelect;
export type NewAssetOwnership = typeof assetOwnerships.$inferInsert;

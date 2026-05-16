import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { hraPaymentMethodEnum } from "./enums";
import { uploadedFiles } from "./uploaded-files";
import { users } from "./users";

export const hraProfiles = pgTable("hra_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
  tenantName: varchar("tenant_name", { length: 120 }),
  tenantPan: varchar("tenant_pan", { length: 20 }),
  propertyAddress: varchar("property_address", { length: 240 }),
  defaultRentAmount: numeric("default_rent_amount", { precision: 12, scale: 2 }),
  defaultPaymentMethod: hraPaymentMethodEnum("default_payment_method"),
  place: varchar("place", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hraLandlords = pgTable(
  "hra_landlords",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    nickname: varchar("nickname", { length: 80 }),
    name: varchar("name", { length: 120 }).notNull(),
    pan: varchar("pan", { length: 20 }),
    address: varchar("address", { length: 180 }),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userDefaultIdx: index("hra_landlords_user_id_is_default_idx").on(t.userId, t.isDefault),
  }),
);

export const hraReceipts = pgTable(
  "hra_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    landlordId: uuid("landlord_id").references((): AnyPgColumn => hraLandlords.id, {
      onDelete: "set null",
    }),
    pdfFileId: uuid("pdf_file_id").references((): AnyPgColumn => uploadedFiles.id, {
      onDelete: "set null",
    }),
    receiptNumber: varchar("receipt_number", { length: 40 }).notNull(),
    receiptDate: date("receipt_date").notNull(),
    paymentDate: date("payment_date").notNull(),
    rentMonth: varchar("rent_month", { length: 7 }),
    periodFrom: date("period_from"),
    periodTo: date("period_to"),
    periodLabel: varchar("period_label", { length: 80 }).notNull(),
    rentAmount: numeric("rent_amount", { precision: 12, scale: 2 }).notNull(),
    paymentMethod: hraPaymentMethodEnum("payment_method").notNull().default("other"),
    filename: varchar("filename", { length: 255 }).notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCreatedIdx: index("hra_receipts_user_id_created_at_idx").on(t.userId, t.createdAt),
  }),
);

export const hraProfilesRelations = relations(hraProfiles, ({ one }) => ({
  user: one(users, { fields: [hraProfiles.userId], references: [users.id] }),
}));

export const hraLandlordsRelations = relations(hraLandlords, ({ one, many }) => ({
  user: one(users, { fields: [hraLandlords.userId], references: [users.id] }),
  receipts: many(hraReceipts),
}));

export const hraReceiptsRelations = relations(hraReceipts, ({ one }) => ({
  user: one(users, { fields: [hraReceipts.userId], references: [users.id] }),
  landlord: one(hraLandlords, {
    fields: [hraReceipts.landlordId],
    references: [hraLandlords.id],
  }),
  pdfFile: one(uploadedFiles, {
    fields: [hraReceipts.pdfFileId],
    references: [uploadedFiles.id],
  }),
}));

export type HraProfile = typeof hraProfiles.$inferSelect;
export type NewHraProfile = typeof hraProfiles.$inferInsert;
export type HraLandlord = typeof hraLandlords.$inferSelect;
export type NewHraLandlord = typeof hraLandlords.$inferInsert;
export type HraReceipt = typeof hraReceipts.$inferSelect;
export type NewHraReceipt = typeof hraReceipts.$inferInsert;

import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
  date,
} from "drizzle-orm/pg-core";
import {
  billingPolicyEnum,
  groupTypeEnum,
  householdStatusEnum,
  memberRoleEnum,
  residentStatusEnum,
} from "./enums";
import { users } from "./users";
import { expenses } from "./expenses";
import { settlements } from "./settlements";
import { categories } from "./categories";
import { tags } from "./tags";
import { uploadedFiles } from "./uploaded-files";

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name").notNull(),
  description: varchar("description"),
  type: groupTypeEnum("type").notNull().default("household"),
  city: varchar("city", { length: 120 }),
  locality: varchar("locality", { length: 120 }),
  apartmentName: varchar("apartment_name", { length: 160 }),
  unitLabel: varchar("unit_label", { length: 120 }),
  expectedResidentCount: integer("expected_resident_count"),
  billingDay: integer("billing_day"),
  coverFileId: uuid("cover_file_id").references((): AnyPgColumn => uploadedFiles.id, {
    onDelete: "set null",
  }),
  status: householdStatusEnum("status").notNull().default("active"),
  createdById: uuid("created_by")
    .notNull()
    .references((): AnyPgColumn => users.id),
  inviteCode: varchar("invite_code").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references((): AnyPgColumn => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("member"),
    status: residentStatusEnum("status").notNull().default("active"),
    moveInDate: date("move_in_date"),
    moveOutDate: date("move_out_date"),
    roomLabel: varchar("room_label", { length: 120 }),
    billingStartPolicy: billingPolicyEnum("billing_start_policy")
      .notNull()
      .default("next_cycle"),
    billingEndPolicy: billingPolicyEnum("billing_end_policy")
      .notNull()
      .default("end_of_cycle"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.groupId, t.userId] }),
  }),
);

export const groupsRelations = relations(groups, ({ one, many }) => ({
  createdByUser: one(users, { fields: [groups.createdById], references: [users.id] }),
  coverFile: one(uploadedFiles, { fields: [groups.coverFileId], references: [uploadedFiles.id] }),
  members: many(groupMembers),
  expenses: many(expenses),
  settlements: many(settlements),
  categories: many(categories),
  tags: many(tags),
}));

export const groupMembersRelations = relations(groupMembers, ({ one }) => ({
  group: one(groups, { fields: [groupMembers.groupId], references: [groups.id] }),
  user: one(users, { fields: [groupMembers.userId], references: [users.id] }),
}));

export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type GroupMember = typeof groupMembers.$inferSelect;
export type NewGroupMember = typeof groupMembers.$inferInsert;

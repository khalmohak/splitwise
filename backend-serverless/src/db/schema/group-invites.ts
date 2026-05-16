import { relations } from "drizzle-orm";
import { index, pgTable, timestamp, uuid, varchar, date } from "drizzle-orm/pg-core";
import { inviteStatusEnum, inviteTypeEnum } from "./enums";
import { groups } from "./groups";
import { users } from "./users";

export const groupInvites = pgTable(
  "group_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    inviteToken: varchar("invite_token", { length: 80 }).notNull().unique(),
    inviteType: inviteTypeEnum("invite_type").notNull().default("link"),
    phone: varchar("phone", { length: 40 }),
    email: varchar("email", { length: 255 }),
    intendedName: varchar("intended_name", { length: 120 }),
    roomLabel: varchar("room_label", { length: 120 }),
    intendedMoveInDate: date("intended_move_in_date"),
    status: inviteStatusEnum("status").notNull().default("pending"),
    invitedById: uuid("invited_by_id")
      .notNull()
      .references(() => users.id),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    groupStatusIdx: index("group_invites_group_id_status_idx").on(t.groupId, t.status),
  }),
);

export const groupInvitesRelations = relations(groupInvites, ({ one }) => ({
  group: one(groups, { fields: [groupInvites.groupId], references: [groups.id] }),
  invitedBy: one(users, { fields: [groupInvites.invitedById], references: [users.id] }),
  acceptedBy: one(users, {
    fields: [groupInvites.acceptedByUserId],
    references: [users.id],
  }),
}));

export type GroupInvite = typeof groupInvites.$inferSelect;
export type NewGroupInvite = typeof groupInvites.$inferInsert;

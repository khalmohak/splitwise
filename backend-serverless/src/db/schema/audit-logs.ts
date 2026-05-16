import { relations } from "drizzle-orm";
import { jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { auditActionEnum, auditResourceTypeEnum } from "./enums";
import { groups } from "./groups";
import { users } from "./users";

export type AuditChange = {
  field: string;
  before: unknown;
  after: unknown;
};

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  action: auditActionEnum("action").notNull(),
  resourceType: auditResourceTypeEnum("resource_type").notNull(),
  resourceId: uuid("resource_id").notNull(),
  summary: varchar("summary").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  changedFields: jsonb("changed_fields").$type<AuditChange[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  group: one(groups, { fields: [auditLogs.groupId], references: [groups.id] }),
  actor: one(users, { fields: [auditLogs.actorId], references: [users.id] }),
}));

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

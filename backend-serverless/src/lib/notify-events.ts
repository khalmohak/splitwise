import { z } from "zod";

const uuid = z.string().uuid();
const month = z.string().regex(/^\d{4}-\d{2}$/);

export const notifyEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("welcome"),
    userId: uuid,
  }),
  z.object({
    kind: z.literal("expense_created"),
    expenseId: uuid,
    groupId: uuid,
    actorId: uuid,
    recipientIds: z.array(uuid),
  }),
  z.object({
    kind: z.literal("expense_updated"),
    expenseId: uuid,
    groupId: uuid,
    actorId: uuid,
    recipientIds: z.array(uuid),
  }),
  z.object({
    kind: z.literal("expense_deleted"),
    expenseId: uuid,
    groupId: uuid,
    actorId: uuid,
    recipientIds: z.array(uuid),
  }),
  z.object({
    kind: z.literal("settlement_request"),
    settlementId: uuid,
    groupId: uuid,
    recipientId: uuid,
  }),
  z.object({
    kind: z.literal("settlement_confirmed"),
    settlementId: uuid,
    groupId: uuid,
    recipientId: uuid,
  }),
  z.object({
    kind: z.literal("settlement_disputed"),
    settlementId: uuid,
    groupId: uuid,
    recipientId: uuid,
  }),
  z.object({
    kind: z.literal("group_created"),
    groupId: uuid,
    recipientId: uuid,
  }),
  z.object({
    kind: z.literal("added_to_group"),
    groupId: uuid,
    recipientId: uuid,
    actorId: uuid,
    role: z.enum(["admin", "member"]),
  }),
  z.object({
    kind: z.literal("member_removed"),
    groupId: uuid,
    recipientId: uuid,
    actorId: uuid,
  }),
  z.object({
    kind: z.literal("budget_exceeded"),
    groupId: uuid,
    categoryId: uuid.nullable(),
    month,
    recipientIds: z.array(uuid),
  }),
]);

export type NotifyEvent = z.infer<typeof notifyEventSchema>;

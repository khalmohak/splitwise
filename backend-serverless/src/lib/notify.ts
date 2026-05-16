import { and, eq, inArray } from "drizzle-orm";
import { enqueueAsyncJob } from "./async-jobs.js";
import { db } from "../db/client.js";
import { expenseParticipants } from "../db/schema/expense-participants.js";
import { expenses } from "../db/schema/expenses.js";
import { groups } from "../db/schema/groups.js";
import { settlements } from "../db/schema/settlements.js";
import { users, type User } from "../db/schema/users.js";
import { expenseUrl, groupUrl, groupsUrl, settlementUrl } from "./email/links.js";
import {
  addedToGroupEmail,
  expenseCreatedEmail,
  expenseDeletedEmail,
  expenseUpdatedEmail,
  groupCreatedEmail,
  memberRemovedEmail,
  settlementConfirmedEmail,
  settlementDisputedEmail,
  settlementRequestEmail,
  welcomeEmail,
} from "./email/templates.js";
import { sendEmail } from "./email/transport.js";
import { type NotifyEvent } from "./notify-events.js";

export async function notify(event: NotifyEvent): Promise<void> {
  if (process.env.NOTIFY_DEBUG === "1") {
    console.log("[notify] queue", event.kind, event);
  }

  try {
    await enqueueAsyncJob({ type: "notify", event });
  } catch (error: unknown) {
    console.error("[notify] enqueue failed", {
      kind: event.kind,
      error: error instanceof Error ? error.message : error,
    });
  }
}

export async function deliverNotification(
  event: NotifyEvent,
  jobId?: string,
): Promise<void> {
  switch (event.kind) {
    case "welcome":
      await notifyWelcome(event.userId, jobId);
      return;
    case "group_created":
      await notifyGroupCreated(event.groupId, event.recipientId, jobId);
      return;
    case "added_to_group":
      await notifyAddedToGroup(event, jobId);
      return;
    case "member_removed":
      await notifyMemberRemoved(event, jobId);
      return;
    case "expense_created":
    case "expense_updated":
    case "expense_deleted":
      await notifyExpense(event, jobId);
      return;
    case "settlement_request":
    case "settlement_confirmed":
    case "settlement_disputed":
      await notifySettlement(event, jobId);
      return;
    case "budget_exceeded":
      return;
    default:
      return;
  }
}

async function notifyWelcome(userId: string, jobId?: string): Promise<void> {
  const recipient = await loadUser(userId);
  if (!recipient?.email) return;

  await sendEmail({
    to: recipient.email,
    idempotencyKey: buildEmailIdempotencyKey(jobId, "welcome", recipient.id),
    ...welcomeEmail({
      name: recipient.name,
      dashboardUrl: groupsUrl(),
    }),
  });
}

async function notifyGroupCreated(
  groupId: string,
  recipientId: string,
  jobId?: string,
): Promise<void> {
  const [group, recipient] = await Promise.all([loadGroup(groupId), loadUser(recipientId)]);
  if (!group || !recipient?.email) return;

  await sendEmail({
    to: recipient.email,
    idempotencyKey: buildEmailIdempotencyKey(jobId, "group_created", groupId, recipient.id),
    ...groupCreatedEmail({
      name: recipient.name,
      groupName: group.name,
      groupUrl: groupUrl(groupId),
    }),
  });
}

async function notifyAddedToGroup(
  event: Extract<NotifyEvent, { kind: "added_to_group" }>,
  jobId?: string,
): Promise<void> {
  const [group, recipient, actor] = await Promise.all([
    loadGroup(event.groupId),
    loadUser(event.recipientId),
    loadUser(event.actorId),
  ]);
  if (!group || !recipient?.email) return;

  await sendEmail({
    to: recipient.email,
    idempotencyKey: buildEmailIdempotencyKey(jobId, "added_to_group", event.groupId, recipient.id),
    ...addedToGroupEmail({
      name: recipient.name,
      groupName: group.name,
      role: event.role,
      groupUrl: groupUrl(event.groupId, "members"),
      invitedByName: actor?.name ?? null,
    }),
  });
}

async function notifyMemberRemoved(
  event: Extract<NotifyEvent, { kind: "member_removed" }>,
  jobId?: string,
): Promise<void> {
  const [group, recipient, actor] = await Promise.all([
    loadGroup(event.groupId),
    loadUser(event.recipientId),
    loadUser(event.actorId),
  ]);
  if (!group || !recipient?.email) return;

  await sendEmail({
    to: recipient.email,
    idempotencyKey: buildEmailIdempotencyKey(jobId, "member_removed", event.groupId, recipient.id),
    ...memberRemovedEmail({
      recipientName: recipient.name,
      groupName: group.name,
      removedByName: actor?.name ?? null,
      groupsUrl: groupsUrl(),
    }),
  });
}

async function notifyExpense(
  event: Extract<
    NotifyEvent,
    { kind: "expense_created" | "expense_updated" | "expense_deleted" }
  >,
  jobId?: string,
): Promise<void> {
  if (event.recipientIds.length === 0) return;

  const [expense] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, event.expenseId), eq(expenses.groupId, event.groupId)))
    .limit(1);
  if (!expense) return;

  const [group, actor] = await Promise.all([
    loadGroup(event.groupId),
    loadUser(event.actorId),
  ]);
  if (!group || !actor) return;

  const participantRows = await db
    .select({ userId: expenseParticipants.userId, shareAmount: expenseParticipants.shareAmount })
    .from(expenseParticipants)
    .where(eq(expenseParticipants.expenseId, event.expenseId));
  const shareByUserId = new Map(participantRows.map((row) => [row.userId, row.shareAmount]));

  const relatedUserIds = Array.from(new Set([expense.paidById, ...event.recipientIds]));
  const userRows = relatedUserIds.length
    ? await db.select().from(users).where(inArray(users.id, relatedUserIds))
    : [];
  const userById = new Map(userRows.map((user) => [user.id, user]));
  const payer = userById.get(expense.paidById);
  if (!payer) return;

  await Promise.all(
    event.recipientIds.map(async (recipientId) => {
      const recipient = userById.get(recipientId);
      if (!recipient?.email) return;

      const templateInput = {
        recipientName: recipient.name,
        groupName: group.name,
        description: expense.description,
        amount: expense.amount,
        paidByName: payer.name,
        date: expense.date,
        yourShare: shareByUserId.get(recipientId) ?? "0.00",
      };
      const idempotencyKey = buildEmailIdempotencyKey(
        jobId,
        event.kind,
        event.expenseId,
        recipient.id,
      );

      if (event.kind === "expense_created") {
        await sendEmail({
          to: recipient.email,
          idempotencyKey,
          ...expenseCreatedEmail({
            ...templateInput,
            createdByName: actor.name,
            expenseUrl: expenseUrl(event.groupId, event.expenseId),
          }),
        });
        return;
      }

      if (event.kind === "expense_updated") {
        await sendEmail({
          to: recipient.email,
          idempotencyKey,
          ...expenseUpdatedEmail({
            ...templateInput,
            updatedByName: actor.name,
            expenseUrl: expenseUrl(event.groupId, event.expenseId),
          }),
        });
        return;
      }

      await sendEmail({
        to: recipient.email,
        idempotencyKey,
        ...expenseDeletedEmail({
          ...templateInput,
          deletedByName: actor.name,
          groupUrl: groupUrl(event.groupId),
        }),
      });
    }),
  );
}

async function notifySettlement(
  event: Extract<
    NotifyEvent,
    { kind: "settlement_request" | "settlement_confirmed" | "settlement_disputed" }
  >,
  jobId?: string,
): Promise<void> {
  const [settlement] = await db
    .select()
    .from(settlements)
    .where(and(eq(settlements.id, event.settlementId), eq(settlements.groupId, event.groupId)))
    .limit(1);
  if (!settlement) return;

  const [group, recipient] = await Promise.all([
    loadGroup(event.groupId),
    loadUser(event.recipientId),
  ]);
  if (!group || !recipient?.email) return;

  const relatedUserIds = Array.from(new Set([settlement.paidById, settlement.paidToId]));
  const userRows = relatedUserIds.length
    ? await db.select().from(users).where(inArray(users.id, relatedUserIds))
    : [];
  const userById = new Map(userRows.map((user) => [user.id, user]));
  const paidBy = userById.get(settlement.paidById);
  const paidTo = userById.get(settlement.paidToId);
  if (!paidBy || !paidTo) return;

  const paymentsUrl = settlementUrl(event.groupId);
  const idempotencyKey = buildEmailIdempotencyKey(
    jobId,
    event.kind,
    event.settlementId,
    recipient.id,
  );

  if (event.kind === "settlement_request") {
    await sendEmail({
      to: recipient.email,
      idempotencyKey,
      ...settlementRequestEmail({
        recipientName: recipient.name,
        groupName: group.name,
        payerName: paidBy.name,
        amount: settlement.amount,
        date: settlement.date,
        notes: settlement.notes,
        settlementUrl: paymentsUrl,
      }),
    });
    return;
  }

  if (event.kind === "settlement_confirmed") {
    await sendEmail({
      to: recipient.email,
      idempotencyKey,
      ...settlementConfirmedEmail({
        recipientName: recipient.name,
        groupName: group.name,
        confirmedByName: paidTo.name,
        amount: settlement.amount,
        settlementUrl: paymentsUrl,
      }),
    });
    return;
  }

  await sendEmail({
    to: recipient.email,
    idempotencyKey,
    ...settlementDisputedEmail({
      recipientName: recipient.name,
      groupName: group.name,
      disputedByName: paidTo.name,
      amount: settlement.amount,
      notes: settlement.reviewNotes ?? settlement.notes,
      settlementUrl: paymentsUrl,
    }),
  });
}

async function loadGroup(groupId: string) {
  const [group] = await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  return group;
}

async function loadUser(userId: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user;
}

function buildEmailIdempotencyKey(
  jobId: string | undefined,
  ...parts: Array<string | null | undefined>
): string | undefined {
  if (!jobId) return undefined;

  const suffix = parts
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/[^A-Za-z0-9:_-]/g, "_"))
    .join(":");

  return `${jobId}${suffix ? `:${suffix}` : ""}`.slice(0, 255);
}

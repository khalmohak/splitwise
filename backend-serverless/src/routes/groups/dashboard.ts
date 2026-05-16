import { Hono } from "hono";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { auditLogs } from "../../db/schema/audit-logs.js";
import { assetOwnerships, assets } from "../../db/schema/assets.js";
import { billInstances } from "../../db/schema/bill-instances.js";
import { billTemplates } from "../../db/schema/bill-templates.js";
import { budgets } from "../../db/schema/budgets.js";
import { categories, type Category } from "../../db/schema/categories.js";
import { depositLedgerEntries } from "../../db/schema/deposit-ledger-entries.js";
import { expenses } from "../../db/schema/expenses.js";
import { groupInvites, type GroupInvite } from "../../db/schema/group-invites.js";
import { groupMembers, groups } from "../../db/schema/groups.js";
import { settlements } from "../../db/schema/settlements.js";
import { users, type User } from "../../db/schema/users.js";
import { type AuthVariables } from "../../lib/auth.js";
import {
  centsToMoney,
  computePairwiseCents,
  computeUserNetCents,
  simplifyTransfers,
} from "../../lib/balances.js";
import { getCurrentMonthDateRange, shiftMonths } from "../../lib/date-utils.js";
import { notFound } from "../../lib/errors.js";
import {
  deriveBillStatus,
  ensureCurrentBillInstances,
  todayDateOnly,
} from "../../lib/households.js";
import { parseMoneyToCents } from "../../lib/money.js";
import { toUserMini } from "../../lib/presenters.js";
import { requireGroupMember } from "../../lib/guards.js";

type DashboardSeverity = "high" | "medium" | "low";
type DashboardTone = "info" | "warning" | "positive";

type DashboardAttention = {
  id: string;
  type: string;
  severity: DashboardSeverity;
  title: string;
  reason: string;
  amount: string | null;
  dueDate: string | null;
  user: ReturnType<typeof toUserMini> | null;
  cta: {
    kind: string;
    label: string;
    target: string;
  } | null;
};

type DashboardAttentionInternal = DashboardAttention & {
  score: number;
};

type DashboardInsight = {
  id: string;
  kind: string;
  tone: DashboardTone;
  title: string;
  body: string;
};

export const groupDashboard = new Hono<{ Variables: AuthVariables }>();

groupDashboard.get("/", async (c) => {
  const groupId = c.req.param("groupId")!;
  const actor = c.get("user");
  const actorMember = await requireGroupMember(groupId, actor.id);
  await ensureCurrentBillInstances(groupId);

  const { from, to } = getCurrentMonthDateRange();
  const currentMonth = from.slice(0, 7);
  const lastMonth = shiftMonths(currentMonth, -1);
  const lastFrom = `${lastMonth}-01`;
  const lastEndDate = new Date(`${from}T00:00:00Z`);
  lastEndDate.setUTCDate(lastEndDate.getUTCDate() - 1);
  const lastTo = lastEndDate.toISOString().slice(0, 10);

  const today = todayDateOnly();
  const weekEnd = addDays(today, 7);
  const attentionHorizon = addDays(today, 14);
  const recentPaidCutoff = addDays(today, -30);
  const recentMoveInCutoff = addDays(today, -30);

  const loadAssetsData = async () => {
    const assetRows = await db
      .select()
      .from(assets)
      .where(eq(assets.groupId, groupId));
    const assetIds = assetRows.map((row) => row.id);
    const ownershipRows = assetIds.length
      ? await db
          .select()
          .from(assetOwnerships)
          .where(inArray(assetOwnerships.assetId, assetIds))
      : [];
    return { assetRows, ownershipRows };
  };

  // Neon HTTP is sensitive to very wide fan-out. Keep the dashboard batched so
  // one page load does not burst a double-digit number of concurrent fetches.
  const [groupRows, residentRows] = await Promise.all([
    db.select().from(groups).where(eq(groups.id, groupId)).limit(1),
    db
      .select({
        member: groupMembers,
        user: users,
      })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(eq(groupMembers.groupId, groupId)),
  ]);

  const [thisMonthRows, lastMonthRows, recentExpenseRows] = await Promise.all([
    db
      .select({
        total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)::text`,
        n: sql<number>`count(*)::int`,
      })
      .from(expenses)
      .where(
        and(eq(expenses.groupId, groupId), gte(expenses.date, from), lte(expenses.date, to)),
      ),
    db
      .select({
        total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)::text`,
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.groupId, groupId),
          gte(expenses.date, lastFrom),
          lte(expenses.date, lastTo),
        ),
      ),
    db
      .select({
        id: expenses.id,
        description: expenses.description,
        amount: expenses.amount,
        date: expenses.date,
        createdAt: expenses.createdAt,
        paidById: expenses.paidById,
        categoryId: expenses.categoryId,
      })
      .from(expenses)
      .where(eq(expenses.groupId, groupId))
      .orderBy(desc(expenses.date), desc(expenses.createdAt))
      .limit(5),
  ]);

  const [nets, pairwiseEdges] = await Promise.all([
    computeUserNetCents(groupId),
    computePairwiseCents(groupId),
  ]);

  const [billRows, templateRows, budgetRows, budgetSpendRows] = await Promise.all([
    db
      .select({
        bill: billInstances,
        template: billTemplates,
      })
      .from(billInstances)
      .innerJoin(billTemplates, eq(billTemplates.id, billInstances.templateId))
      .where(eq(billInstances.groupId, groupId)),
    db
      .select()
      .from(billTemplates)
      .where(eq(billTemplates.groupId, groupId)),
    db
      .select()
      .from(budgets)
      .where(and(eq(budgets.groupId, groupId), eq(budgets.month, currentMonth))),
    db
      .select({
        categoryId: expenses.categoryId,
        total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)::text`,
      })
      .from(expenses)
      .where(
        and(eq(expenses.groupId, groupId), gte(expenses.date, from), lte(expenses.date, to)),
      )
      .groupBy(expenses.categoryId),
  ]);

  const [inviteRows, pendingSettlementRows, depositRows] = await Promise.all([
    db
      .select()
      .from(groupInvites)
      .where(and(eq(groupInvites.groupId, groupId), eq(groupInvites.status, "pending")))
      .orderBy(desc(groupInvites.createdAt)),
    db
      .select()
      .from(settlements)
      .where(and(eq(settlements.groupId, groupId), eq(settlements.status, "pending")))
      .orderBy(desc(settlements.createdAt)),
    db
      .select()
      .from(depositLedgerEntries)
      .where(eq(depositLedgerEntries.groupId, groupId))
      .orderBy(desc(depositLedgerEntries.effectiveDate), desc(depositLedgerEntries.createdAt)),
  ]);

  const [auditRows, assetsData] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.groupId, groupId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(8),
    loadAssetsData(),
  ]);

  const group = groupRows[0];
  if (!group) throw notFound("Group not found");

  const seenUserIds = new Set(residentRows.map((row) => row.user.id));
  const extraUserIds = Array.from(
    new Set(
      [
        ...recentExpenseRows.map((row) => row.paidById),
        ...pairwiseEdges.flatMap((edge) => [edge.fromId, edge.toId]),
        ...billRows.flatMap(({ bill }) =>
          [bill.defaultPayerUserId, bill.actualPayerUserId].filter(
            (id): id is string => !!id,
          ),
        ),
        ...pendingSettlementRows.flatMap((row) => [row.paidById, row.paidToId]),
        ...depositRows.flatMap((row) =>
          [row.fromUserId, row.toUserId].filter((id): id is string => !!id),
        ),
        ...assetsData.assetRows
          .map((row) => row.currentHolderUserId)
          .filter((id): id is string => !!id),
        ...auditRows.map((row) => row.actorId),
      ].filter((id) => !seenUserIds.has(id)),
    ),
  );
  const extraUsers = extraUserIds.length
    ? await db.select().from(users).where(inArray(users.id, extraUserIds))
    : [];

  const userById = new Map(
    [...residentRows.map((row) => row.user), ...extraUsers].map((user) => [user.id, user]),
  );
  const actorUser = userById.get(actor.id) ?? null;

  const residents = residentRows.map((row) => ({
    userId: row.user.id,
    name: row.user.name,
    email: row.user.email,
    avatarUrl: row.user.avatarUrl,
    upiId: row.user.upiId,
    preferredSettlementMethod: row.user.preferredSettlementMethod,
    role: row.member.role,
    status: row.member.status,
    roomLabel: row.member.roomLabel,
    moveInDate: row.member.moveInDate,
    moveOutDate: row.member.moveOutDate,
    billingStartPolicy: row.member.billingStartPolicy,
    billingEndPolicy: row.member.billingEndPolicy,
    joinedAt: row.member.joinedAt.toISOString(),
  }));

  const currentResidents = residents.filter((resident) => resident.status !== "left");
  const activeResidents = residents.filter((resident) => resident.status === "active");
  const leavingResidents = residents.filter((resident) => resident.status === "leaving");
  const leftResidents = residents.filter((resident) => resident.status === "left");
  const admins = currentResidents.filter((resident) => resident.role === "admin");
  const missingUpiResidents = currentResidents.filter((resident) => !resident.upiId);
  const missingAvatarResidents = currentResidents.filter((resident) => !resident.avatarUrl);
  const leavingSoonResidents = leavingResidents
    .filter((resident) => !!resident.moveOutDate && resident.moveOutDate <= attentionHorizon)
    .sort((a, b) => compareDateOnlyAsc(a.moveOutDate ?? today, b.moveOutDate ?? today));
  const recentMoveIns = currentResidents
    .filter((resident) => !!resident.moveInDate && resident.moveInDate >= recentMoveInCutoff)
    .sort((a, b) => compareDateOnlyAsc(b.moveInDate ?? today, a.moveInDate ?? today))
    .slice(0, 5);

  const activeInviteRows = inviteRows.filter((invite) => !isInviteExpired(invite));
  const expiredPendingInviteCount = inviteRows.length - activeInviteRows.length;
  const pendingInviteCount = activeInviteRows.length;
  const expiringSoonInviteCount = activeInviteRows.filter(
    (invite) =>
      !!invite.expiresAt &&
      invite.expiresAt.getTime() <= new Date(`${addDays(today, 3)}T23:59:59Z`).getTime(),
  ).length;
  const expectedResidentGap =
    group.expectedResidentCount == null
      ? null
      : Math.max(group.expectedResidentCount - currentResidents.length - pendingInviteCount, 0);

  const thisCents = parseMoney(thisMonthRows[0]?.total ?? "0");
  const lastCents = parseMoney(lastMonthRows[0]?.total ?? "0");
  const expenseCount = thisMonthRows[0]?.n ?? 0;
  const averageExpenseCents = expenseCount > 0 ? Math.round(thisCents / expenseCount) : 0;
  const changeCents = thisCents - lastCents;
  const changePct = lastCents > 0 ? (changeCents * 100) / lastCents : null;
  const direction = changeCents > 0 ? "up" : changeCents < 0 ? "down" : "stable";

  let youOweCents = 0;
  let youAreOwedCents = 0;
  for (const edge of pairwiseEdges) {
    if (edge.fromId === actor.id) youOweCents += edge.cents;
    if (edge.toId === actor.id) youAreOwedCents += edge.cents;
  }
  const myNetCents = nets.get(actor.id) ?? 0;

  const simplifiedBalances = simplifyTransfers(new Map(nets)).map((edge) => ({
    from: toUserMiniOrNull(userById, edge.fromId),
    to: toUserMiniOrNull(userById, edge.toId),
    amount: centsToMoney(edge.cents),
    cents: edge.cents,
  }));

  const largestOpenBalances = pairwiseEdges
    .slice()
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 5)
    .map((edge) => ({
      from: toUserMiniOrNull(userById, edge.fromId),
      to: toUserMiniOrNull(userById, edge.toId),
      amount: centsToMoney(edge.cents),
      cents: edge.cents,
    }));

  const settlementSuggestions = simplifiedBalances
    .filter((balance) => balance.from?.id === actor.id || balance.to?.id === actor.id)
    .map((balance) => {
      const directionForActor =
        balance.from?.id === actor.id
          ? "you_pay"
          : balance.to?.id === actor.id
            ? "you_receive"
            : "other";
      return {
        from: balance.from,
        to: balance.to,
        amount: balance.amount,
        direction: directionForActor,
        summary:
          directionForActor === "you_pay"
            ? `Pay ${balance.to?.name ?? "them"} ${balance.amount}`
            : directionForActor === "you_receive"
              ? `Receive ${balance.amount} from ${balance.from?.name ?? "them"}`
              : `${balance.from?.name ?? "Someone"} pays ${balance.to?.name ?? "someone"} ${balance.amount}`,
      };
    });

  const pendingSettlementAmountCents = pendingSettlementRows.reduce(
    (sum, row) => sum + parseMoneyToCents(row.amount),
    0,
  );
  const awaitingYourConfirmation = pendingSettlementRows.filter(
    (row) => row.paidToId === actor.id,
  );
  const awaitingOthersConfirmation = pendingSettlementRows.filter(
    (row) => row.paidById === actor.id,
  );

  const categoryIds = Array.from(
    new Set(
      [
        ...budgetRows.map((row) => row.categoryId).filter((id): id is string => !!id),
        ...budgetSpendRows.map((row) => row.categoryId).filter((id): id is string => !!id),
        ...recentExpenseRows.map((row) => row.categoryId).filter((id): id is string => !!id),
      ],
    ),
  );
  const categoryRows = categoryIds.length
    ? await db.select().from(categories).where(inArray(categories.id, categoryIds))
    : [];
  const categoryById = new Map(categoryRows.map((row) => [row.id, row]));

  const recentExpenses = recentExpenseRows.map((row) => ({
    id: row.id,
    description: row.description,
    amount: row.amount,
    date: row.date,
    createdAt: row.createdAt.toISOString(),
    paidBy: toUserMiniOrNull(userById, row.paidById),
    category: row.categoryId ? presentCategory(categoryById.get(row.categoryId) ?? null) : null,
  }));

  const bills = billRows.map(({ bill, template }) => {
    const effectiveStatus = deriveBillStatus(bill, today);
    const amountCents = bill.amount ? parseMoneyToCents(bill.amount) : null;
    return {
      id: bill.id,
      templateId: bill.templateId,
      label: bill.label,
      billKind: template.billKind,
      dueDate: bill.dueDate,
      status: effectiveStatus,
      rawStatus: bill.status,
      amount: bill.amount ?? null,
      amountCents,
      defaultPayer: bill.defaultPayerUserId
        ? toUserMiniOrNull(userById, bill.defaultPayerUserId)
        : null,
      actualPayer: bill.actualPayerUserId
        ? toUserMiniOrNull(userById, bill.actualPayerUserId)
        : null,
      paidAt: bill.paidAt?.toISOString() ?? null,
      proofFileId: bill.proofFileId,
      collectProofImage: template.collectProofImage,
      generatedExpenseId: bill.generatedExpenseId,
      periodStart: bill.periodStart,
      periodEnd: bill.periodEnd,
    };
  });

  const openBills = bills.filter((bill) => bill.status === "due" || bill.status === "overdue");
  const dueBills = openBills.filter((bill) => bill.status === "due");
  const overdueBills = openBills.filter((bill) => bill.status === "overdue");
  const dueTodayBills = dueBills.filter((bill) => bill.dueDate === today);
  const dueThisWeekBills = dueBills.filter((bill) => bill.dueDate >= today && bill.dueDate <= weekEnd);
  const recentlyPaidBills = bills
    .filter(
      (bill) =>
        bill.status === "paid" &&
        !!bill.paidAt &&
        bill.paidAt.slice(0, 10) >= recentPaidCutoff,
    )
    .sort((a, b) => compareDateOnlyAsc(b.paidAt?.slice(0, 10) ?? today, a.paidAt?.slice(0, 10) ?? today))
    .slice(0, 5);
  const topDueBills = openBills
    .slice()
    .sort((a, b) => compareOpenBillUrgency(a, b, today))
    .slice(0, 5);
  const openBillsAmountCents = openBills.reduce(
    (sum, bill) => sum + (bill.amountCents ?? 0),
    0,
  );
  const paidThisMonthCount = bills.filter(
    (bill) =>
      bill.status === "paid" &&
      !!bill.paidAt &&
      bill.paidAt.slice(0, 10) >= from &&
      bill.paidAt.slice(0, 10) <= to,
  ).length;
  const proofMissingPaidBills = bills.filter(
    (bill) =>
      bill.status === "paid" &&
      bill.collectProofImage &&
      !bill.proofFileId &&
      !!bill.paidAt &&
      bill.paidAt.slice(0, 10) >= recentPaidCutoff,
  );
  const unknownAmountOpenBills = openBills.filter((bill) => bill.amount == null);

  const activeTemplates = templateRows.filter((template) => template.isActive);
  const pausedTemplates = templateRows.filter((template) => !template.isActive);
  const missingPayerTemplates = activeTemplates.filter(
    (template) => !template.defaultPayerUserId,
  );

  let overallBudgetAmountCents: number | null = null;
  let overallBudgetRemainingCents: number | null = null;
  const spendByCategory = new Map<string, number>();
  for (const row of budgetSpendRows) {
    const cents = parseMoney(row.total);
    if (row.categoryId) spendByCategory.set(row.categoryId, cents);
  }

  const budgetEntries = budgetRows
    .map((budget) => {
      const amountCents = parseMoneyToCents(budget.amount);
      const spentCents = budget.categoryId
        ? spendByCategory.get(budget.categoryId) ?? 0
        : thisCents;
      const remainingCents = amountCents - spentCents;
      const usedPct = amountCents > 0 ? (spentCents * 100) / amountCents : 0;
      const status = budgetStatus(usedPct);
      if (budget.categoryId == null) {
        overallBudgetAmountCents = amountCents;
        overallBudgetRemainingCents = remainingCents;
      }
      return {
        id: budget.id,
        month: budget.month,
        category: budget.categoryId ? presentCategory(categoryById.get(budget.categoryId) ?? null) : null,
        amount: budget.amount,
        amountCents,
        spent: centsToMoney(spentCents),
        spentCents,
        remaining: centsToMoney(remainingCents),
        remainingCents,
        usedPct: usedPct.toFixed(2),
        usedPctNumber: usedPct,
        status,
        createdBy: toUserMiniOrNull(userById, budget.createdById),
        createdAt: budget.createdAt.toISOString(),
        updatedAt: budget.updatedAt.toISOString(),
      };
    })
    .sort((a, b) => compareBudgetPriority(a, b));

  const flaggedBudgets = budgetEntries.filter((entry) => entry.status !== "ok");
  const overBudgets = flaggedBudgets.filter((entry) => entry.status === "over");
  const warningBudgets = flaggedBudgets.filter((entry) => entry.status === "warning");

  const topSpendingCategory = Array.from(spendByCategory.entries())
    .sort((a, b) => b[1] - a[1])[0];
  const topSpendingCategoryEntry = topSpendingCategory
    ? categoryById.get(topSpendingCategory[0]) ?? null
    : null;

  const ownershipCountByAssetId = new Map<string, number>();
  for (const ownership of assetsData.ownershipRows) {
    ownershipCountByAssetId.set(
      ownership.assetId,
      (ownershipCountByAssetId.get(ownership.assetId) ?? 0) + 1,
    );
  }
  const activeAssets = assetsData.assetRows.filter((row) => row.status === "active");
  const assetsMissingOwnership = activeAssets.filter(
    (row) => (ownershipCountByAssetId.get(row.id) ?? 0) === 0,
  );
  const assetsMissingHolder = activeAssets.filter((row) => !row.currentHolderUserId);

  const depositNetByUser = new Map<string, number>();
  for (const row of depositRows) {
    const cents = parseMoneyToCents(row.amount);
    if (row.toUserId) {
      depositNetByUser.set(row.toUserId, (depositNetByUser.get(row.toUserId) ?? 0) + cents);
    }
    if (row.fromUserId) {
      depositNetByUser.set(row.fromUserId, (depositNetByUser.get(row.fromUserId) ?? 0) - cents);
    }
  }
  const depositNetEntries = Array.from(depositNetByUser.entries())
    .map(([userId, cents]) => ({
      user: toUserMiniOrNull(userById, userId),
      netAmount: centsToMoney(cents),
      cents,
    }))
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  const depositPoolHeldCents = Math.max(
    0,
    -Array.from(depositNetByUser.values()).reduce((sum, cents) => sum + cents, 0),
  );
  const depositProofGapCount = depositRows.filter(
    (row) => row.entryType !== "transfer" && !row.proofFileId,
  ).length;

  const activity = auditRows.map((row) => ({
    id: row.id,
    type: `${row.resourceType}_${row.action}`,
    actor: toUserMiniOrNull(userById, row.actorId),
    summary: row.summary,
    payload: row.after ?? row.before ?? null,
    createdAt: row.createdAt.toISOString(),
  }));

  const attention: DashboardAttentionInternal[] = [];

  if (overdueBills.length > 0) {
    const totalOverdueAmountCents = overdueBills.reduce(
      (sum, bill) => sum + (bill.amountCents ?? 0),
      0,
    );
    const oldestOverdue = overdueBills
      .slice()
      .sort((a, b) => compareDateOnlyAsc(a.dueDate, b.dueDate))[0]!;
    const overdueDays = dateDiffInDays(oldestOverdue.dueDate, today);
    attention.push({
      id: overdueBills.length === 1 ? `bill:${oldestOverdue.id}` : "bills:overdue",
      type: "bill_overdue",
      severity: "high",
      title:
        overdueBills.length === 1
          ? `${oldestOverdue.label} is overdue`
          : `${overdueBills.length} bills are overdue`,
      reason:
        overdueBills.length === 1
          ? `Due ${overdueDays} day${overdueDays === 1 ? "" : "s"} ago`
          : `Oldest bill is ${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`,
      amount:
        overdueBills.length === 1
          ? oldestOverdue.amount
          : centsToMoney(totalOverdueAmountCents),
      dueDate: oldestOverdue.dueDate,
      user: oldestOverdue.defaultPayer,
      cta: {
        kind: "open_bills",
        label: "Review bills",
        target: `/groups/${groupId}?tab=bills`,
      },
      score: 1000 + Math.min(overdueDays, 30),
    });
  }

  if (dueThisWeekBills.length > 0) {
    const nextDue = dueThisWeekBills
      .slice()
      .sort((a, b) => compareDateOnlyAsc(a.dueDate, b.dueDate))[0]!;
    attention.push({
      id: dueThisWeekBills.length === 1 ? `bill:${nextDue.id}:due_soon` : "bills:due_this_week",
      type: "bill_due_soon",
      severity: overdueBills.length > 0 ? "medium" : "high",
      title:
        dueThisWeekBills.length === 1
          ? `${nextDue.label} is due this week`
          : `${dueThisWeekBills.length} bills are due this week`,
      reason:
        dueThisWeekBills.length === 1
          ? `Due on ${nextDue.dueDate}`
          : `Next due date is ${nextDue.dueDate}`,
      amount: nextDue.amount,
      dueDate: nextDue.dueDate,
      user: nextDue.defaultPayer,
      cta: {
        kind: "open_bills",
        label: "Open bills",
        target: `/groups/${groupId}?tab=bills`,
      },
      score: 860 - dateDiffInDays(today, nextDue.dueDate),
    });
  }

  if (awaitingYourConfirmation.length > 0) {
    const top = awaitingYourConfirmation[0]!;
    attention.push({
      id: `settlement:${top.id}:confirm`,
      type: "settlement_confirmation",
      severity: "high",
      title:
        awaitingYourConfirmation.length === 1
          ? `${userById.get(top.paidById)?.name ?? "A flatmate"} logged a payment`
          : `${awaitingYourConfirmation.length} payments need your confirmation`,
      reason:
        awaitingYourConfirmation.length === 1
          ? `Confirm ${top.amount} received on ${top.date}`
          : `Pending confirmations slow down balances for everyone`,
      amount:
        awaitingYourConfirmation.length === 1
          ? top.amount
          : centsToMoney(
              awaitingYourConfirmation.reduce(
                (sum, row) => sum + parseMoneyToCents(row.amount),
                0,
              ),
            ),
      dueDate: top.date,
      user: toUserMiniOrNull(userById, top.paidById),
      cta: {
        kind: "open_settlements",
        label: "Review payments",
        target: `/groups/${groupId}`,
      },
      score: 930,
    });
  }

  const topSettlementSuggestion = settlementSuggestions[0];
  if (topSettlementSuggestion?.from && topSettlementSuggestion?.to) {
    attention.push({
      id: `settle:${topSettlementSuggestion.from.id}:${topSettlementSuggestion.to.id}`,
      type: "settlement_suggestion",
      severity: topSettlementSuggestion.direction === "you_pay" ? "high" : "medium",
      title:
        topSettlementSuggestion.direction === "you_pay"
          ? `Settle with ${topSettlementSuggestion.to.name}`
          : `Collect from ${topSettlementSuggestion.from.name}`,
      reason: "Largest open balance in this household right now",
      amount: topSettlementSuggestion.amount,
      dueDate: null,
      user:
        topSettlementSuggestion.direction === "you_pay"
          ? topSettlementSuggestion.to
          : topSettlementSuggestion.from,
      cta: {
        kind: "settle_balance",
        label: "Settle balance",
        target: `/groups/${groupId}`,
      },
      score: topSettlementSuggestion.direction === "you_pay" ? 900 : 780,
    });
  }

  if (overBudgets.length > 0) {
    const worst = overBudgets[0]!;
    attention.push({
      id: `budget:${worst.id}:over`,
      type: "budget_over",
      severity: "medium",
      title: worst.category ? `${worst.category.name} is over budget` : "Household budget is over",
      reason: `${worst.usedPct}% of the budget is already used this month`,
      amount: centsToMoney(Math.max(0, worst.spentCents - worst.amountCents)),
      dueDate: `${currentMonth}-01`,
      user: null,
      cta: {
        kind: "open_budgets",
        label: "Open budgets",
        target: `/groups/${groupId}/budgets`,
      },
      score: 760 + Math.round(worst.usedPctNumber),
    });
  }

  if (actorMember.role === "admin" && pendingInviteCount > 0) {
    attention.push({
      id: "invites:pending",
      type: "pending_invites",
      severity: "medium",
      title:
        pendingInviteCount === 1
          ? "1 invite is still pending"
          : `${pendingInviteCount} invites are still pending`,
      reason:
        expiringSoonInviteCount > 0
          ? `${expiringSoonInviteCount} invite${expiringSoonInviteCount === 1 ? "" : "s"} expire soon`
          : "Open invites can block rooms from being fully occupied",
      amount: null,
      dueDate: null,
      user: null,
      cta: {
        kind: "open_invites",
        label: "Review invites",
        target: `/groups/${groupId}?tab=invites`,
      },
      score: 650 + pendingInviteCount,
    });
  }

  if (!actorUser?.upiId) {
    attention.push({
      id: `resident:${actor.id}:missing_upi`,
      type: "missing_upi",
      severity: "medium",
      title: "Add your UPI ID",
      reason: "It makes settlement collection and payment flows much smoother",
      amount: null,
      dueDate: null,
      user: toUserMiniOrNull(userById, actor.id),
      cta: {
        kind: "edit_profile",
        label: "Update profile",
        target: "/settings/profile",
      },
      score: 620,
    });
  } else if (actorMember.role === "admin" && missingUpiResidents.length > 0) {
    attention.push({
      id: "residents:missing_upi",
      type: "resident_setup_gap",
      severity: "low",
      title:
        missingUpiResidents.length === 1
          ? `${missingUpiResidents[0]!.name} has no UPI ID`
          : `${missingUpiResidents.length} residents are missing UPI IDs`,
      reason: "Settlement follow-through gets harder when payout details are missing",
      amount: null,
      dueDate: null,
      user: missingUpiResidents[0]
        ? toUserMiniOrNull(userById, missingUpiResidents[0].userId)
        : null,
      cta: {
        kind: "open_residents",
        label: "Review residents",
        target: `/groups/${groupId}?tab=residents`,
      },
      score: 560 + missingUpiResidents.length,
    });
  }

  if (actorMember.role === "admin" && leavingSoonResidents.length > 0) {
    const firstLeaving = leavingSoonResidents[0]!;
    attention.push({
      id: `resident:${firstLeaving.userId}:leaving`,
      type: "resident_leaving",
      severity: "medium",
      title:
        leavingSoonResidents.length === 1
          ? `${firstLeaving.name} is leaving soon`
          : `${leavingSoonResidents.length} residents are leaving soon`,
      reason:
        leavingSoonResidents.length === 1
          ? `Move-out date is ${firstLeaving.moveOutDate}`
          : "Plan bill split changes and deposit adjustments before move-out",
      amount: null,
      dueDate: firstLeaving.moveOutDate,
      user: toUserMiniOrNull(userById, firstLeaving.userId),
      cta: {
        kind: "open_residents",
        label: "Review residents",
        target: `/groups/${groupId}?tab=residents`,
      },
      score: 640,
    });
  }

  if (actorMember.role === "admin" && missingPayerTemplates.length > 0) {
    attention.push({
      id: "templates:missing_payer",
      type: "bill_template_gap",
      severity: "medium",
      title:
        missingPayerTemplates.length === 1
          ? `${missingPayerTemplates[0]!.name} has no default payer`
          : `${missingPayerTemplates.length} bill templates have no default payer`,
      reason: "Bills are harder to act on when ownership is unclear",
      amount: null,
      dueDate: null,
      user: null,
      cta: {
        kind: "open_bills",
        label: "Review templates",
        target: `/groups/${groupId}?tab=bills`,
      },
      score: 610 + missingPayerTemplates.length,
    });
  }

  if (actorMember.role === "admin" && (assetsMissingOwnership.length > 0 || assetsMissingHolder.length > 0)) {
    attention.push({
      id: "assets:gaps",
      type: "asset_gap",
      severity: "low",
      title: "Some household assets need cleanup",
      reason: `${assetsMissingOwnership.length} without ownership, ${assetsMissingHolder.length} without a holder`,
      amount: null,
      dueDate: null,
      user: null,
      cta: {
        kind: "open_assets",
        label: "Review assets",
        target: `/groups/${groupId}?tab=assets`,
      },
      score: 520 + assetsMissingOwnership.length + assetsMissingHolder.length,
    });
  }

  const rankedAttention = attention
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 7)
    .map(({ score, ...item }) => item);

  const insights: DashboardInsight[] = [];
  if (expenseCount > 0) {
    if (direction === "up" && changeCents > 0) {
      insights.push({
        id: "spend_trend_up",
        kind: "spend_trend",
        tone: "warning",
        title: "Spending is up this month",
        body:
          changePct == null
            ? `This household spent ${centsToMoney(changeCents)} more than last month.`
            : `Spending is up ${changePct.toFixed(1)}% vs last month.`,
      });
    } else if (direction === "down" && changeCents < 0) {
      insights.push({
        id: "spend_trend_down",
        kind: "spend_trend",
        tone: "positive",
        title: "Spending is down this month",
        body:
          changePct == null
            ? `This household spent ${centsToMoney(Math.abs(changeCents))} less than last month.`
            : `Spending is down ${Math.abs(changePct).toFixed(1)}% vs last month.`,
      });
    }
  }

  if (topSpendingCategoryEntry && topSpendingCategory) {
    insights.push({
      id: "top_spending_category",
      kind: "category_spend",
      tone: "info",
      title: `${topSpendingCategoryEntry.name} is the top category this month`,
      body: `${centsToMoney(topSpendingCategory[1])} spent in ${topSpendingCategoryEntry.name}.`,
    });
  }

  if (openBills.length > 0) {
    insights.push({
      id: "open_bills",
      kind: "bill_pressure",
      tone: overdueBills.length > 0 ? "warning" : "info",
      title:
        overdueBills.length > 0
          ? "Bills need action this cycle"
          : "Upcoming bills are stacked for this cycle",
      body: `${openBills.length} open bills totaling ${centsToMoney(openBillsAmountCents)} remain.`,
    });
  }

  if (flaggedBudgets.length > 0) {
    insights.push({
      id: "budget_pressure",
      kind: "budget_pressure",
      tone: overBudgets.length > 0 ? "warning" : "info",
      title:
        overBudgets.length > 0
          ? "Budget pressure is building"
          : "A few budgets are getting tight",
      body:
        overBudgets.length > 0
          ? `${overBudgets.length} budget${overBudgets.length === 1 ? "" : "s"} already crossed 100% usage.`
          : `${warningBudgets.length} budget${warningBudgets.length === 1 ? "" : "s"} passed the 80% mark.`,
    });
  }

  if (rankedAttention.length === 0) {
    insights.push({
      id: "household_steady",
      kind: "health",
      tone: "positive",
      title: "This household looks steady",
      body: "No urgent dashboard actions are blocking the house right now.",
    });
  }

  const houseHealthOpenIssueCount =
    overdueBills.length +
    overBudgets.length +
    missingPayerTemplates.length +
    proofMissingPaidBills.length +
    assetsMissingOwnership.length +
    assetsMissingHolder.length +
    expiredPendingInviteCount +
    missingUpiResidents.length +
    missingAvatarResidents.length;
  const houseHealthStatus =
    houseHealthOpenIssueCount === 0
      ? "healthy"
      : houseHealthOpenIssueCount <= 3
        ? "watch"
        : "needs_attention";

  return c.json({
    asOf: new Date().toISOString(),
    group: {
      id: group.id,
      name: group.name,
      type: group.type,
      description: group.description,
      city: group.city,
      locality: group.locality,
      apartmentName: group.apartmentName,
      unitLabel: group.unitLabel,
      expectedResidentCount: group.expectedResidentCount,
      billingDay: group.billingDay,
      status: group.status,
      memberCount: currentResidents.length,
    },
    summary: {
      currentMonth,
      monthSpend: centsToMoney(thisCents),
      averageExpense: centsToMoney(averageExpenseCents),
      expenseCount,
      myNet: centsToMoney(myNetCents),
      youOwe: centsToMoney(youOweCents),
      youAreOwed: centsToMoney(youAreOwedCents),
      dueBills: dueBills.length,
      overdueBills: overdueBills.length,
      pendingSettlementCount: pendingSettlementRows.length,
      pendingSettlementAmount: centsToMoney(pendingSettlementAmountCents),
      pendingInviteCount,
      residentCount: currentResidents.length,
      vsLastMonth: {
        changeAmount: centsToMoney(changeCents),
        changePct: changePct == null ? null : changePct.toFixed(2),
        direction,
      },
    },
    attention: rankedAttention,
    insights: insights.slice(0, 4),
    balances: {
      simplified: simplifiedBalances.map(({ cents, ...balance }) => balance),
      myBalance: {
        net: centsToMoney(myNetCents),
        youOwe: centsToMoney(youOweCents),
        youAreOwed: centsToMoney(youAreOwedCents),
      },
      largestOpenBalances: largestOpenBalances.map(({ cents, ...balance }) => balance),
      suggestedSettlements: settlementSuggestions,
    },
    thisMonth: {
      total: centsToMoney(thisCents),
      expenseCount,
      averageExpense: centsToMoney(averageExpenseCents),
      vsLastMonth: {
        changeAmount: centsToMoney(changeCents),
        changePct: changePct == null ? null : changePct.toFixed(2),
        direction,
      },
    },
    recentExpenses,
    bills: {
      dueCount: dueBills.length,
      overdueCount: overdueBills.length,
      dueTodayCount: dueTodayBills.length,
      dueThisWeekCount: dueThisWeekBills.length,
      paidThisMonthCount,
      openAmount: centsToMoney(openBillsAmountCents),
      unknownAmountCount: unknownAmountOpenBills.length,
      upcoming: topDueBills,
      topDue: topDueBills,
      recentlyPaid: recentlyPaidBills,
      templates: {
        activeCount: activeTemplates.length,
        pausedCount: pausedTemplates.length,
        missingPayerCount: missingPayerTemplates.length,
        variableAmountCount: activeTemplates.filter((template) => template.amountMode === "variable").length,
      },
    },
    budgets: {
      month: currentMonth,
      configuredCount: budgetEntries.length,
      overall:
        overallBudgetAmountCents == null
          ? null
          : {
              amount: centsToMoney(overallBudgetAmountCents),
              spent: centsToMoney(thisCents),
              remaining: centsToMoney(overallBudgetRemainingCents ?? 0),
              status:
                overallBudgetAmountCents > 0
                  ? budgetStatus((thisCents * 100) / overallBudgetAmountCents)
                  : "ok",
            },
      overCount: overBudgets.length,
      warningCount: warningBudgets.length,
      remainingThisMonth:
        overallBudgetRemainingCents == null
          ? null
          : centsToMoney(overallBudgetRemainingCents),
      flagged: flaggedBudgets.slice(0, 5).map(({ amountCents, spentCents, remainingCents, usedPctNumber, ...entry }) => entry),
      entries: budgetEntries.map(({ amountCents, spentCents, remainingCents, usedPctNumber, ...entry }) => entry),
    },
    residents: {
      activeCount: activeResidents.length,
      leavingCount: leavingResidents.length,
      leftCount: leftResidents.length,
      adminCount: admins.length,
      pendingInviteCount,
      expectedResidentCount: group.expectedResidentCount,
      expectedGapCount: expectedResidentGap,
      missingUpiCount: missingUpiResidents.length,
      missingAvatarCount: missingAvatarResidents.length,
      admins: admins.map((resident) => ({
        userId: resident.userId,
        name: resident.name,
        avatarUrl: resident.avatarUrl,
      })),
      leavingSoon: leavingSoonResidents.map((resident) => ({
        userId: resident.userId,
        name: resident.name,
        avatarUrl: resident.avatarUrl,
        moveOutDate: resident.moveOutDate,
        roomLabel: resident.roomLabel,
      })),
      recentMoveIns: recentMoveIns.map((resident) => ({
        userId: resident.userId,
        name: resident.name,
        avatarUrl: resident.avatarUrl,
        moveInDate: resident.moveInDate,
        roomLabel: resident.roomLabel,
      })),
      missingUpi: missingUpiResidents.slice(0, 5).map((resident) => ({
        userId: resident.userId,
        name: resident.name,
        avatarUrl: resident.avatarUrl,
      })),
      missingAvatar: missingAvatarResidents.slice(0, 5).map((resident) => ({
        userId: resident.userId,
        name: resident.name,
      })),
    },
    deposits: {
      entryCount: depositRows.length,
      poolHeld: centsToMoney(depositPoolHeldCents),
      netByUser: depositNetEntries.map(({ cents, ...entry }) => entry),
      proofGapCount: depositProofGapCount,
      lastEntryAt: depositRows[0]?.createdAt.toISOString() ?? null,
    },
    houseHealth: {
      status: houseHealthStatus,
      openIssueCount: houseHealthOpenIssueCount,
      billTemplatesWithoutDefaultPayer: missingPayerTemplates.length,
      pausedTemplates: pausedTemplates.length,
      proofMissingOnRecentPaidBills: proofMissingPaidBills.length,
      assetsMissingOwnership: assetsMissingOwnership.length,
      assetsMissingHolder: assetsMissingHolder.length,
      expiredPendingInvites: expiredPendingInviteCount,
      missingResidentUpi: missingUpiResidents.length,
      missingResidentAvatar: missingAvatarResidents.length,
    },
    settlements: {
      pendingCount: pendingSettlementRows.length,
      pendingAmount: centsToMoney(pendingSettlementAmountCents),
      awaitingYourConfirmation: awaitingYourConfirmation.length,
      awaitingOthersConfirmation: awaitingOthersConfirmation.length,
    },
    activity,
    recentActivity: activity.slice(0, 5),
  });
});

function addDays(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function budgetStatus(usedPct: number): "ok" | "warning" | "over" {
  if (usedPct > 100) return "over";
  if (usedPct >= 80) return "warning";
  return "ok";
}

function compareBudgetPriority(
  a: { status: "ok" | "warning" | "over"; usedPctNumber: number },
  b: { status: "ok" | "warning" | "over"; usedPctNumber: number },
) {
  const order = { over: 0, warning: 1, ok: 2 };
  const statusDiff = order[a.status] - order[b.status];
  if (statusDiff !== 0) return statusDiff;
  return b.usedPctNumber - a.usedPctNumber;
}

function compareDateOnlyAsc(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareOpenBillUrgency(
  a: { status: string; dueDate: string; amountCents: number | null },
  b: { status: string; dueDate: string; amountCents: number | null },
  today: string,
): number {
  const aStatusScore = a.status === "overdue" ? 0 : 1;
  const bStatusScore = b.status === "overdue" ? 0 : 1;
  if (aStatusScore !== bStatusScore) return aStatusScore - bStatusScore;
  const dateDiff = compareDateOnlyAsc(a.dueDate, b.dueDate);
  if (dateDiff !== 0) return dateDiff;
  const aAmount = a.amountCents ?? 0;
  const bAmount = b.amountCents ?? 0;
  if (a.status === "overdue" && b.status === "overdue" && a.dueDate !== b.dueDate) {
    return compareDateOnlyAsc(a.dueDate, b.dueDate);
  }
  if (a.dueDate === today && b.dueDate !== today) return -1;
  if (b.dueDate === today && a.dueDate !== today) return 1;
  return bAmount - aAmount;
}

function dateDiffInDays(fromDateOnly: string, toDateOnly: string): number {
  const start = new Date(`${fromDateOnly}T00:00:00Z`).getTime();
  const end = new Date(`${toDateOnly}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((end - start) / 86400000));
}

function isInviteExpired(invite: Pick<GroupInvite, "expiresAt">): boolean {
  return !!invite.expiresAt && invite.expiresAt.getTime() < Date.now();
}

function parseMoney(s: string): number {
  if (s.includes(".")) {
    const [whole, fraction = "00"] = s.split(".");
    return parseMoneyToCents(`${whole}.${(fraction + "00").slice(0, 2)}`);
  }
  return parseMoneyToCents(`${s}.00`);
}

function presentCategory(category: Category | null) {
  if (!category) return null;
  return {
    id: category.id,
    name: category.name,
    icon: category.icon,
    color: category.color,
    groupId: category.groupId,
  };
}

function toUserMiniOrNull(
  userById: Map<string, User>,
  userId: string,
) {
  const user = userById.get(userId);
  return user ? toUserMini(user) : null;
}

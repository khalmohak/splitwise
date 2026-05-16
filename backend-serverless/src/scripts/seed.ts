// Seeds the database with 2 loginable Firebase test users and a household that
// exercises the newer shared-home schema: resident metadata, bill templates,
// bill instances, bill-generated expenses, ad hoc expenses, settlements,
// budgets, tracked invites, deposits, and assets.
//
// Idempotent: re-running reuses Firebase users by email and deletes prior seed
// groups by name before recreating them.
//
// Run with: yarn db:seed (or `tsx src/scripts/seed.ts`)
//
// Login credentials:
//   talo_admin1@gmail.com / TestPass123!
//   talo_member1@gmail.com / TestPass123!

// Must be the first import: loads .env and stubs seed-only env defaults before
// modules import env validation.
import "./_env-bootstrap.js";

import { randomBytes } from "node:crypto";
import { inArray } from "drizzle-orm";
import type { FirebaseError } from "firebase-admin";

import { db } from "../db/client.js";
import {
  assetOwnerships,
  assets,
  billInstances,
  billTemplates,
  budgets,
  categories,
  depositLedgerEntries,
  expenseItems,
  expenseParticipants,
  expenseTags,
  expenses,
  groupInvites,
  groupMembers,
  groups,
  settlements,
  tags,
  users,
} from "../db/schema/index.js";
import { adminAuth } from "../lib/firebase-admin.js";
import {
  buildPeriodLabel,
  buildSplitSnapshot,
  computeBillParticipantShares,
  dueDateForMonth,
  loadResidentSnapshotForPeriod,
} from "../lib/households.js";
import { splitByWeights, splitEqual, sumMoney } from "../lib/money.js";

const PASSWORD = "TestPass123!";
const HOUSEHOLD_NAME = "Talo Demo Flat (seed)";
const LEGACY_GROUP_NAMES = [
  "Apartment 4B (seed)",
  "Goa Weekend (seed)",
];

const TEST_USERS = [
  {
    key: "admin",
    email: "talo_admin1@gmail.com",
    name: "Talo Admin 1",
    upiId: "talo.admin1@oksbi",
    preferredSettlementMethod: "upi" as const,
    roomLabel: "Room A",
  },
  {
    key: "member",
    email: "talo_member1@gmail.com",
    name: "Talo Member 1",
    upiId: "talo.member1@okhdfcbank",
    preferredSettlementMethod: "upi" as const,
    roomLabel: "Room B",
  },
] as const;

type UserKey = (typeof TEST_USERS)[number]["key"];
type UserIds = Record<UserKey, string>;
type BillTemplateRow = typeof billTemplates.$inferSelect;

const today = new Date(
  Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  ),
);

function money(value: number): string {
  return value.toFixed(2);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function atUtcHour(dateOnly: string, hour = 9): Date {
  return new Date(`${dateOnly}T${String(hour).padStart(2, "0")}:00:00Z`);
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daysAgo(days: number): string {
  return isoDate(addDays(today, -days));
}

function daysFromNow(days: number): string {
  return isoDate(addDays(today, days));
}

function monthBounds(offset = 0): { periodStart: string; periodEnd: string } {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + offset;
  const periodStart = new Date(Date.UTC(year, month, 1));
  const periodEnd = new Date(Date.UTC(year, month + 1, 0));
  return {
    periodStart: isoDate(periodStart),
    periodEnd: isoDate(periodEnd),
  };
}

function dateForMonthOffset(offset: number, day: number): string {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + offset;
  const monthEnd = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const clampedDay = Math.min(Math.max(day, 1), monthEnd);
  return isoDate(new Date(Date.UTC(year, month, clampedDay)));
}

function currentMonthKey(): string {
  return monthBounds(0).periodStart.slice(0, 7);
}

function createInviteToken(): string {
  return randomBytes(18).toString("base64url");
}

function idByName(rows: Array<{ id: string; name: string }>): Map<string, string> {
  return new Map(rows.map((row) => [row.name, row.id]));
}

function mustGet<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label} was not found while seeding`);
  }
  return value;
}

function dueStatusForDate(dueDate: string): "due" | "overdue" {
  return dueDate < isoDate(today) ? "overdue" : "due";
}

async function ensureFirebaseUser(email: string, name: string): Promise<string> {
  const auth = await adminAuth();
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.updateUser(existing.uid, {
      password: PASSWORD,
      displayName: name,
      emailVerified: true,
    });
    return existing.uid;
  } catch (error) {
    const code = (error as FirebaseError)?.code;
    if (code !== "auth/user-not-found") throw error;
  }

  const created = await auth.createUser({
    email,
    password: PASSWORD,
    displayName: name,
    emailVerified: true,
  });
  return created.uid;
}

async function upsertDbUser(
  firebaseUid: string,
  seedUser: (typeof TEST_USERS)[number],
): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      firebaseUid,
      email: seedUser.email,
      emailVerified: true,
      name: seedUser.name,
      upiId: seedUser.upiId,
      preferredSettlementMethod: seedUser.preferredSettlementMethod,
      lastSignInProvider: "password",
    })
    .onConflictDoUpdate({
      target: users.firebaseUid,
      set: {
        email: seedUser.email,
        emailVerified: true,
        name: seedUser.name,
        upiId: seedUser.upiId,
        preferredSettlementMethod: seedUser.preferredSettlementMethod,
        lastSignInProvider: "password",
      },
    })
    .returning({ id: users.id });

  if (!row) throw new Error(`failed to upsert user ${seedUser.email}`);
  return row.id;
}

async function tearDownPriorSeed() {
  const targetNames = [HOUSEHOLD_NAME, ...LEGACY_GROUP_NAMES];
  const existing = await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(inArray(groups.name, targetNames));

  if (existing.length === 0) return;

  await db.delete(groups).where(
    inArray(
      groups.id,
      existing.map((group) => group.id),
    ),
  );

  console.log(`  cleared ${existing.length} prior seed group(s)`);
}

async function seedHouseholdGroup(uids: UserIds) {
  console.log(`\nseeding household: ${HOUSEHOLD_NAME}`);

  const adminMoveInDate = dateForMonthOffset(-5, 3);
  const memberMoveInDate = dateForMonthOffset(-4, 10);

  const [group] = await db
    .insert(groups)
    .values({
      name: HOUSEHOLD_NAME,
      description: "Two-person demo flat with bills, expenses, invites, and assets.",
      type: "household",
      city: "Bengaluru",
      locality: "HSR Layout",
      apartmentName: "Lakeview Residency",
      unitLabel: "B-504",
      expectedResidentCount: 2,
      billingDay: 5,
      status: "active",
      createdById: uids.admin,
      inviteCode: `seed-${Date.now().toString(36)}`,
    })
    .returning({ id: groups.id });
  if (!group) throw new Error("household insert failed");
  const groupId = group.id;

  await db.insert(groupMembers).values([
    {
      groupId: group.id,
      userId: uids.admin,
      role: "admin",
      status: "active",
      moveInDate: adminMoveInDate,
      roomLabel: mustGet(TEST_USERS.find((user) => user.key === "admin"), "admin seed user").roomLabel,
      billingStartPolicy: "next_cycle",
      billingEndPolicy: "end_of_cycle",
    },
    {
      groupId: group.id,
      userId: uids.member,
      role: "member",
      status: "active",
      moveInDate: memberMoveInDate,
      roomLabel: mustGet(TEST_USERS.find((user) => user.key === "member"), "member seed user")
        .roomLabel,
      billingStartPolicy: "next_cycle",
      billingEndPolicy: "end_of_cycle",
    },
  ]);

  const categoryRows = await db
    .insert(categories)
    .values([
      { groupId: group.id, name: "Rent", icon: "home", color: "#2563eb" },
      { groupId: group.id, name: "Utilities", icon: "bolt", color: "#f59e0b" },
      { groupId: group.id, name: "Groceries", icon: "cart", color: "#16a34a" },
      { groupId: group.id, name: "Eating Out", icon: "plate", color: "#dc2626" },
      { groupId: group.id, name: "House Stuff", icon: "box", color: "#8b5cf6" },
      { groupId: group.id, name: "Cleaning", icon: "sparkles", color: "#0f766e" },
    ])
    .returning({ id: categories.id, name: categories.name });
  const categoryIds = idByName(categoryRows);

  const tagRows = await db
    .insert(tags)
    .values([
      { groupId: group.id, name: "monthly", color: "#0ea5e9" },
      { groupId: group.id, name: "urgent", color: "#dc2626" },
      { groupId: group.id, name: "house-upgrade", color: "#7c3aed" },
      { groupId: group.id, name: "social", color: "#db2777" },
    ])
    .returning({ id: tags.id, name: tags.name });
  const tagIds = idByName(tagRows);

  await db.insert(budgets).values([
    {
      groupId: group.id,
      categoryId: mustGet(categoryIds.get("Groceries"), "Groceries category"),
      month: currentMonthKey(),
      amount: money(12000),
      createdById: uids.admin,
    },
    {
      groupId: group.id,
      categoryId: mustGet(categoryIds.get("Utilities"), "Utilities category"),
      month: currentMonthKey(),
      amount: money(6500),
      createdById: uids.admin,
    },
    {
      groupId: group.id,
      categoryId: mustGet(categoryIds.get("House Stuff"), "House Stuff category"),
      month: currentMonthKey(),
      amount: money(4500),
      createdById: uids.admin,
    },
    {
      groupId: group.id,
      categoryId: null,
      month: currentMonthKey(),
      amount: money(65000),
      createdById: uids.admin,
    },
  ]);

  const templateRows = await db
    .insert(billTemplates)
    .values([
      {
        groupId: group.id,
        name: "Rent",
        billKind: "rent",
        amountMode: "fixed",
        defaultAmount: money(42000),
        currency: "INR",
        dueDay: 5,
        defaultPayerUserId: uids.admin,
        splitStrategy: "fixed_shares",
        splitConfig: {
          entries: [
            { userId: uids.admin, weight: 7 },
            { userId: uids.member, weight: 5 },
          ],
        },
        collectProofImage: false,
        isActive: true,
        notes: "Landlord prefers the transfer before the 5th.",
      },
      {
        groupId: group.id,
        name: "Electricity",
        billKind: "electricity",
        amountMode: "variable",
        defaultAmount: null,
        currency: "INR",
        dueDay: 18,
        defaultPayerUserId: uids.member,
        splitStrategy: "equal_active_residents",
        splitConfig: null,
        collectProofImage: true,
        isActive: true,
        notes: "Amount changes every month after the meter reading.",
      },
      {
        groupId: group.id,
        name: "Wi-Fi",
        billKind: "wifi",
        amountMode: "fixed",
        defaultAmount: money(999),
        currency: "INR",
        dueDay: 12,
        defaultPayerUserId: uids.admin,
        splitStrategy: "equal_active_residents",
        splitConfig: null,
        collectProofImage: true,
        isActive: true,
        notes: "ACT autopay fails often, so this is paid manually in the app.",
      },
      {
        groupId: group.id,
        name: "Maid",
        billKind: "maid",
        amountMode: "fixed",
        defaultAmount: money(2600),
        currency: "INR",
        dueDay: 27,
        defaultPayerUserId: uids.member,
        splitStrategy: "custom_snapshot",
        splitConfig: {
          entries: [
            { userId: uids.admin, weight: 3 },
            { userId: uids.member, weight: 2 },
          ],
        },
        collectProofImage: false,
        isActive: true,
        notes: "Cash or UPI depending on the week.",
      },
      {
        groupId: group.id,
        name: "Maintenance",
        billKind: "maintenance",
        amountMode: "fixed",
        defaultAmount: money(2400),
        currency: "INR",
        dueDay: 30,
        defaultPayerUserId: uids.admin,
        splitStrategy: "equal_active_residents",
        splitConfig: null,
        collectProofImage: false,
        isActive: true,
        notes: "Apartment association monthly fee.",
      },
      {
        groupId: group.id,
        name: "Gas Cylinder",
        billKind: "gas",
        amountMode: "variable",
        defaultAmount: null,
        currency: "INR",
        dueDay: 28,
        defaultPayerUserId: uids.member,
        splitStrategy: "equal_active_residents",
        splitConfig: null,
        collectProofImage: false,
        isActive: false,
        notes: "Paused because the flat now uses pipeline gas.",
      },
    ])
    .returning();
  const templateByName = new Map(templateRows.map((row) => [row.name, row]));

  async function addExpense(opts: {
    amount: string;
    description: string;
    paidBy: string;
    date: string;
    splitType: "equal" | "exact" | "percentage" | "shares";
    categoryId?: string | null;
    notes?: string | null;
    isRecurring?: boolean;
    recurInterval?: "weekly" | "monthly" | "yearly" | null;
    recurAnchor?: string | null;
    shares: Array<{
      userId: string;
      shareAmount: string;
      splitInput?: string | null;
    }>;
    tagIds?: string[];
    items?: Array<{
      name: string;
      quantity?: number;
      unitPrice?: string;
      totalPrice: string;
      categoryId?: string | null;
    }>;
    createdBy?: string;
  }): Promise<string> {
    if (sumMoney(opts.shares.map((share) => share.shareAmount)) !== opts.amount) {
      throw new Error(
        `share sum does not match amount for expense "${opts.description}"`,
      );
    }

    const [expense] = await db
      .insert(expenses)
      .values({
        groupId,
        paidById: opts.paidBy,
        amount: opts.amount,
        description: opts.description,
        categoryId: opts.categoryId ?? null,
        splitType: opts.splitType,
        date: opts.date,
        notes: opts.notes ?? null,
        isRecurring: opts.isRecurring ?? false,
        recurInterval: opts.recurInterval ?? null,
        recurAnchor: opts.recurAnchor ?? null,
        createdById: opts.createdBy ?? opts.paidBy,
      })
      .returning({ id: expenses.id });
    if (!expense) throw new Error(`expense insert failed for "${opts.description}"`);

    await db.insert(expenseParticipants).values(
      opts.shares.map((share) => ({
        expenseId: expense.id,
        userId: share.userId,
        shareAmount: share.shareAmount,
        splitInput: share.splitInput ?? null,
      })),
    );

    if (opts.tagIds && opts.tagIds.length > 0) {
      await db.insert(expenseTags).values(
        opts.tagIds.map((tagId) => ({
          expenseId: expense.id,
          tagId,
        })),
      );
    }

    if (opts.items && opts.items.length > 0) {
      await db.insert(expenseItems).values(
        opts.items.map((item, index) => ({
          expenseId: expense.id,
          position: index,
          name: item.name,
          quantity: item.quantity != null ? item.quantity.toFixed(3) : null,
          unitPrice: item.unitPrice ?? null,
          totalPrice: item.totalPrice,
          categoryId: item.categoryId ?? null,
          sourceFileId: null,
          metadata: null,
        })),
      );
    }

    return expense.id;
  }

  async function addBillInstance(
    template: BillTemplateRow,
    opts: {
      monthOffset: number;
      amount: string | null;
      status?: "due" | "overdue" | "paid" | "skipped" | "cancelled";
      actualPayerUserId?: string | null;
      generatedExpenseId?: string | null;
      paidDate?: string | null;
    },
  ): Promise<string> {
    const { periodStart, periodEnd } = monthBounds(opts.monthOffset);
    const residentSnapshot = await loadResidentSnapshotForPeriod(
      groupId,
      periodStart,
      periodEnd,
    );
    if (residentSnapshot.length === 0) {
      throw new Error(`no residents available for ${template.name} ${periodStart}`);
    }

    const splitSnapshot = buildSplitSnapshot(template, residentSnapshot);
    const dueDate = dueDateForMonth(periodStart, template.dueDay);
    const [bill] = await db
      .insert(billInstances)
      .values({
        templateId: template.id,
        groupId,
        label: buildPeriodLabel(template.name, periodStart),
        periodStart,
        periodEnd,
        dueDate,
        status: opts.status ?? dueStatusForDate(dueDate),
        amount: opts.amount,
        defaultPayerUserId: template.defaultPayerUserId ?? null,
        actualPayerUserId: opts.actualPayerUserId ?? null,
        paidAt: opts.paidDate ? atUtcHour(opts.paidDate) : null,
        proofFileId: null,
        generatedExpenseId: opts.generatedExpenseId ?? null,
        residentSnapshot: residentSnapshot as unknown as object,
        splitSnapshot: splitSnapshot as unknown as object,
      })
      .returning({ id: billInstances.id });
    if (!bill) {
      throw new Error(`bill instance insert failed for ${template.name}`);
    }

    return bill.id;
  }

  async function addPaidBill(
    template: BillTemplateRow,
    opts: {
      monthOffset: number;
      amount: string;
      paidBy: string;
      paidDay: number;
      notes?: string | null;
    },
  ): Promise<string> {
    const { periodStart, periodEnd } = monthBounds(opts.monthOffset);
    const residentSnapshot = await loadResidentSnapshotForPeriod(
      groupId,
      periodStart,
      periodEnd,
    );
    if (residentSnapshot.length === 0) {
      throw new Error(`no residents available for ${template.name} ${periodStart}`);
    }

    const splitSnapshot = buildSplitSnapshot(template, residentSnapshot);
    const paidDate = dateForMonthOffset(opts.monthOffset, opts.paidDay);
    const shares = computeBillParticipantShares(opts.amount, splitSnapshot);
    const expenseId = await addExpense({
      amount: opts.amount,
      description: buildPeriodLabel(template.name, periodStart),
      paidBy: opts.paidBy,
      date: paidDate,
      splitType: "exact",
      categoryId: null,
      notes: opts.notes ?? template.notes ?? null,
      isRecurring: true,
      recurInterval: template.cadence,
      recurAnchor: periodStart,
      shares: shares.map((share) => ({
        userId: share.userId,
        shareAmount: share.shareAmount,
        splitInput: share.splitInput,
      })),
    });

    return addBillInstance(template, {
      monthOffset: opts.monthOffset,
      amount: opts.amount,
      status: "paid",
      actualPayerUserId: opts.paidBy,
      generatedExpenseId: expenseId,
      paidDate,
    });
  }

  const rentTemplate = mustGet(templateByName.get("Rent"), "Rent template");
  const electricityTemplate = mustGet(
    templateByName.get("Electricity"),
    "Electricity template",
  );
  const wifiTemplate = mustGet(templateByName.get("Wi-Fi"), "Wi-Fi template");
  const maidTemplate = mustGet(templateByName.get("Maid"), "Maid template");
  const maintenanceTemplate = mustGet(
    templateByName.get("Maintenance"),
    "Maintenance template",
  );

  await addPaidBill(rentTemplate, {
    monthOffset: -2,
    amount: money(42000),
    paidBy: uids.admin,
    paidDay: 4,
  });
  await addPaidBill(rentTemplate, {
    monthOffset: -1,
    amount: money(42000),
    paidBy: uids.admin,
    paidDay: 4,
  });
  await addBillInstance(rentTemplate, {
    monthOffset: 0,
    amount: money(42000),
  });

  await addPaidBill(electricityTemplate, {
    monthOffset: -2,
    amount: money(2310),
    paidBy: uids.member,
    paidDay: 18,
  });
  await addPaidBill(electricityTemplate, {
    monthOffset: -1,
    amount: money(2480),
    paidBy: uids.member,
    paidDay: 19,
  });
  await addBillInstance(electricityTemplate, {
    monthOffset: 0,
    amount: money(2860),
  });

  await addPaidBill(wifiTemplate, {
    monthOffset: -2,
    amount: money(999),
    paidBy: uids.admin,
    paidDay: 11,
  });
  await addPaidBill(wifiTemplate, {
    monthOffset: -1,
    amount: money(999),
    paidBy: uids.admin,
    paidDay: 12,
  });
  await addBillInstance(wifiTemplate, {
    monthOffset: 0,
    amount: money(999),
  });

  await addPaidBill(maidTemplate, {
    monthOffset: -2,
    amount: money(2600),
    paidBy: uids.member,
    paidDay: 26,
  });
  await addPaidBill(maidTemplate, {
    monthOffset: -1,
    amount: money(2600),
    paidBy: uids.member,
    paidDay: 27,
  });
  await addBillInstance(maidTemplate, {
    monthOffset: 0,
    amount: money(2600),
  });

  await addBillInstance(maintenanceTemplate, {
    monthOffset: -1,
    amount: money(2400),
    status: "skipped",
  });
  await addBillInstance(maintenanceTemplate, {
    monthOffset: 0,
    amount: money(2400),
  });

  const groceriesEqualShares = splitEqual(money(2187), 2);
  await addExpense({
    amount: money(2187),
    description: "BigBasket restock",
    paidBy: uids.member,
    date: daysAgo(21),
    splitType: "equal",
    categoryId: mustGet(categoryIds.get("Groceries"), "Groceries category"),
    notes: "Pantry refill plus cleaning supplies.",
    shares: [
      { userId: uids.admin, shareAmount: groceriesEqualShares[0]! },
      { userId: uids.member, shareAmount: groceriesEqualShares[1]! },
    ],
    tagIds: [mustGet(tagIds.get("monthly"), "monthly tag")],
    items: [
      {
        name: "Atta 10kg",
        quantity: 1,
        unitPrice: money(420),
        totalPrice: money(420),
        categoryId: mustGet(categoryIds.get("Groceries"), "Groceries category"),
      },
      {
        name: "Milk + curd",
        quantity: 1,
        unitPrice: money(220),
        totalPrice: money(220),
        categoryId: mustGet(categoryIds.get("Groceries"), "Groceries category"),
      },
      {
        name: "Vegetables and fruit",
        quantity: 1,
        unitPrice: money(645),
        totalPrice: money(645),
        categoryId: mustGet(categoryIds.get("Groceries"), "Groceries category"),
      },
      {
        name: "Cleaning refills",
        quantity: 1,
        unitPrice: money(902),
        totalPrice: money(902),
        categoryId: mustGet(categoryIds.get("Cleaning"), "Cleaning category"),
      },
    ],
  });

  await addExpense({
    amount: money(1680),
    description: "Housewarming dinner",
    paidBy: uids.admin,
    date: daysAgo(12),
    splitType: "exact",
    categoryId: mustGet(categoryIds.get("Eating Out"), "Eating Out category"),
    notes: "Admin ordered dessert, so the split is uneven.",
    shares: [
      { userId: uids.admin, shareAmount: money(980), splitInput: money(980) },
      { userId: uids.member, shareAmount: money(700), splitInput: money(700) },
    ],
    tagIds: [mustGet(tagIds.get("social"), "social tag")],
  });

  const streamingShares = splitByWeights(money(899), [70, 30]);
  await addExpense({
    amount: money(899),
    description: "Weekend streaming bundle",
    paidBy: uids.admin,
    date: daysAgo(8),
    splitType: "percentage",
    categoryId: mustGet(categoryIds.get("Utilities"), "Utilities category"),
    notes: "Admin took the annual add-on, member only wanted the sports pass.",
    shares: [
      { userId: uids.admin, shareAmount: streamingShares[0]!, splitInput: "70.0000" },
      { userId: uids.member, shareAmount: streamingShares[1]!, splitInput: "30.0000" },
    ],
    tagIds: [mustGet(tagIds.get("social"), "social tag")],
  });

  const vacuumExpenseId = await addExpense({
    amount: money(7890),
    description: "Vacuum cleaner",
    paidBy: uids.admin,
    date: daysAgo(6),
    splitType: "equal",
    categoryId: mustGet(categoryIds.get("House Stuff"), "House Stuff category"),
    notes: "Purchased after the old shared broom setup became unmanageable.",
    shares: [
      { userId: uids.admin, shareAmount: money(3945) },
      { userId: uids.member, shareAmount: money(3945) },
    ],
    tagIds: [mustGet(tagIds.get("house-upgrade"), "house-upgrade tag")],
  });

  const storageShares = splitByWeights(money(1540), [2, 1]);
  const storageExpenseId = await addExpense({
    amount: money(1540),
    description: "IKEA bins + hooks",
    paidBy: uids.member,
    date: daysAgo(3),
    splitType: "shares",
    categoryId: mustGet(categoryIds.get("House Stuff"), "House Stuff category"),
    notes: "Admin took more of the wardrobe storage, so the split uses shares.",
    shares: [
      { userId: uids.admin, shareAmount: storageShares[0]!, splitInput: "2.0000" },
      { userId: uids.member, shareAmount: storageShares[1]!, splitInput: "1.0000" },
    ],
    tagIds: [
      mustGet(tagIds.get("house-upgrade"), "house-upgrade tag"),
      mustGet(tagIds.get("urgent"), "urgent tag"),
    ],
  });

  const [vacuumAsset] = await db
    .insert(assets)
    .values({
      groupId: group.id,
      name: "Vacuum Cleaner",
      category: "Cleaning",
      photoFileId: null,
      purchaseDate: daysAgo(6),
      purchaseAmount: money(7890),
      purchaseExpenseId: vacuumExpenseId,
      status: "active",
      currentHolderUserId: uids.member,
      notes: "Lives next to the shoe cabinet.",
    })
    .returning({ id: assets.id });
  if (!vacuumAsset) throw new Error("vacuum asset insert failed");

  const [storageAsset] = await db
    .insert(assets)
    .values({
      groupId: group.id,
      name: "Wardrobe storage set",
      category: "Storage",
      photoFileId: null,
      purchaseDate: daysAgo(3),
      purchaseAmount: money(1540),
      purchaseExpenseId: storageExpenseId,
      status: "transferred",
      currentHolderUserId: uids.admin,
      notes: "Transferred to admin after the room reshuffle.",
    })
    .returning({ id: assets.id });
  if (!storageAsset) throw new Error("storage asset insert failed");

  await db.insert(assetOwnerships).values([
    {
      assetId: vacuumAsset.id,
      userId: uids.admin,
      ownershipPercent: "50.0000",
      ownershipAmount: money(3945),
    },
    {
      assetId: vacuumAsset.id,
      userId: uids.member,
      ownershipPercent: "50.0000",
      ownershipAmount: money(3945),
    },
    {
      assetId: storageAsset.id,
      userId: uids.admin,
      ownershipPercent: "66.6667",
      ownershipAmount: storageShares[0]!,
    },
    {
      assetId: storageAsset.id,
      userId: uids.member,
      ownershipPercent: "33.3333",
      ownershipAmount: storageShares[1]!,
    },
  ]);

  await db.insert(depositLedgerEntries).values([
    {
      groupId: group.id,
      entryType: "contribution",
      amount: money(25000),
      fromUserId: uids.admin,
      toUserId: null,
      effectiveDate: dateForMonthOffset(-4, 3),
      proofFileId: null,
      notes: "Initial security deposit contribution.",
      createdById: uids.admin,
    },
    {
      groupId: group.id,
      entryType: "contribution",
      amount: money(25000),
      fromUserId: uids.member,
      toUserId: null,
      effectiveDate: dateForMonthOffset(-4, 4),
      proofFileId: null,
      notes: "Initial security deposit contribution.",
      createdById: uids.admin,
    },
    {
      groupId: group.id,
      entryType: "transfer",
      amount: money(5000),
      fromUserId: uids.admin,
      toUserId: uids.member,
      effectiveDate: daysAgo(18),
      proofFileId: null,
      notes: "Deposit share adjusted after the room change.",
      createdById: uids.admin,
    },
    {
      groupId: group.id,
      entryType: "refund",
      amount: money(2000),
      fromUserId: null,
      toUserId: uids.member,
      effectiveDate: daysAgo(1),
      proofFileId: null,
      notes: "Broker refunded duplicate key charges.",
      createdById: uids.admin,
    },
  ]);

  await db.insert(settlements).values([
    {
      groupId: group.id,
      paidById: uids.member,
      paidToId: uids.admin,
      amount: money(3500),
      date: daysAgo(7),
      notes: "Settled earlier grocery and wifi backlog.",
      status: "confirmed",
      reviewedAt: atUtcHour(daysAgo(7), 11),
      reviewNotes: "Matched with the UPI transfer reference.",
    },
    {
      groupId: group.id,
      paidById: uids.member,
      paidToId: uids.admin,
      amount: money(1200),
      date: daysAgo(2),
      notes: "Partial settle after the dinner and storage purchase.",
      status: "pending",
    },
  ]);

  await db.insert(groupInvites).values([
    {
      groupId: group.id,
      inviteToken: createInviteToken(),
      inviteType: "email",
      phone: null,
      email: TEST_USERS[1].email,
      intendedName: TEST_USERS[1].name,
      roomLabel: TEST_USERS[1].roomLabel,
      intendedMoveInDate: memberMoveInDate,
      status: "accepted",
      invitedById: uids.admin,
      acceptedByUserId: uids.member,
      acceptedAt: atUtcHour(memberMoveInDate, 10),
      expiresAt: atUtcHour(dateForMonthOffset(-4, 25), 23),
      createdAt: atUtcHour(dateForMonthOffset(-4, 5), 9),
      updatedAt: atUtcHour(memberMoveInDate, 10),
    },
    {
      groupId: group.id,
      inviteToken: createInviteToken(),
      inviteType: "email",
      phone: null,
      email: "talo_guest1@gmail.com",
      intendedName: "Talo Guest 1",
      roomLabel: "Flex Room",
      intendedMoveInDate: daysFromNow(14),
      status: "pending",
      invitedById: uids.admin,
      acceptedByUserId: null,
      acceptedAt: null,
      expiresAt: atUtcHour(daysFromNow(10), 23),
    },
    {
      groupId: group.id,
      inviteToken: createInviteToken(),
      inviteType: "phone",
      phone: "+919900001111",
      email: null,
      intendedName: "Talo Viewer",
      roomLabel: "Room B",
      intendedMoveInDate: daysFromNow(30),
      status: "revoked",
      invitedById: uids.admin,
      acceptedByUserId: null,
      acceptedAt: null,
      expiresAt: atUtcHour(daysFromNow(30), 23),
      createdAt: atUtcHour(daysAgo(15), 9),
      updatedAt: atUtcHour(daysAgo(14), 9),
    },
  ]);

  console.log(
    "  household done: 6 templates, 14 bill instances, 13 expenses, 2 settlements, 4 budgets",
  );
}

async function main() {
  console.log("seeding test users...");

  const ids = {} as Record<UserKey, string>;
  for (const seedUser of TEST_USERS) {
    const firebaseUid = await ensureFirebaseUser(seedUser.email, seedUser.name);
    const dbId = await upsertDbUser(firebaseUid, seedUser);
    ids[seedUser.key] = dbId;
    console.log(`  ${seedUser.email} -> firebase=${firebaseUid} db=${dbId}`);
  }

  console.log("\nclearing prior seed groups...");
  await tearDownPriorSeed();

  await seedHouseholdGroup(ids as UserIds);

  console.log("\nseed complete");
  console.log(`\nPassword for both accounts: ${PASSWORD}`);
  for (const seedUser of TEST_USERS) {
    console.log(`  ${seedUser.email}`);
  }
}

main().catch((error) => {
  console.error("seed failed:", error);
  process.exit(1);
});

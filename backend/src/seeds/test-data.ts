import { hash } from "bcrypt";
import { IsNull } from "typeorm";

import { AppDataSource } from "../data-source";
import { Category } from "../entity/Category";
import { Expense } from "../entity/Expense";
import { ExpenseParticipant } from "../entity/ExpenseParticipant";
import { Group } from "../entity/Group";
import { GroupMember } from "../entity/GroupMember";
import { GroupType, MemberRole, RecurInterval, SplitType } from "../entity/enums";
import { Settlement } from "../entity/Settlement";
import { Tag } from "../entity/Tag";
import { User } from "../entity/User";
import { formatDateOnly } from "../utils/date";
import { formatCents } from "../utils/money";
import { seedSystemCategories } from "./constants";

type DemoUserKey = "mohak" | "raj" | "priya" | "ananya";
type DemoUsers = Record<DemoUserKey, User>;

type SplitConfig =
  | { type: SplitType.EQUAL }
  | { type: SplitType.EXACT; shares: Partial<Record<DemoUserKey, number>> }
  | { type: SplitType.PERCENTAGE; shares: Partial<Record<DemoUserKey, number>> }
  | { type: SplitType.SHARES; shares: Partial<Record<DemoUserKey, number>> };

type ExpenseSeed = {
  group: Group;
  members: DemoUserKey[];
  description: string;
  amountCents: number;
  paidBy: DemoUserKey;
  category: Category | null;
  tags: Tag[];
  date: string;
  split: SplitConfig;
  notes?: string | null;
  isRecurring?: boolean;
  recurInterval?: RecurInterval | null;
  recurAnchor?: string | null;
};

const demoPassword = "Password123";
const demoUsers: { key: DemoUserKey; name: string; email: string }[] = [
  { key: "mohak", name: "Mohak Demo", email: "mohak.demo@example.com" },
  { key: "raj", name: "Raj Demo", email: "raj.demo@example.com" },
  { key: "priya", name: "Priya Demo", email: "priya.demo@example.com" },
  { key: "ananya", name: "Ananya Demo", email: "ananya.demo@example.com" },
];
const demoGroupNames = ["Flat 4B Demo", "Goa Trip Demo", "Raj & Mohak Demo"];

const daysAgo = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - days);

  return formatDateOnly(date);
};

const getRepository = <T extends object>(entity: new () => T) =>
  AppDataSource.getRepository(entity);

const clearDemoGroups = async (): Promise<void> => {
  const groups = await getRepository(Group)
    .createQueryBuilder("group")
    .where("group.name IN (:...names)", { names: demoGroupNames })
    .getMany();
  const groupIds = groups.map((group) => group.id);

  if (groupIds.length === 0) {
    return;
  }

  const expenses = await getRepository(Expense)
    .createQueryBuilder("expense")
    .select(["expense.id"])
    .where("expense.groupId IN (:...groupIds)", { groupIds })
    .getMany();
  const expenseIds = expenses.map((expense) => expense.id);

  if (expenseIds.length > 0) {
    await AppDataSource.query(
      "DELETE FROM expense_tags WHERE expense_id = ANY($1::uuid[])",
      [expenseIds],
    );
    await AppDataSource.query(
      "DELETE FROM expense_participants WHERE expense_id = ANY($1::uuid[])",
      [expenseIds],
    );
  }

  await AppDataSource.query("DELETE FROM settlements WHERE group_id = ANY($1::uuid[])", [
    groupIds,
  ]);
  await AppDataSource.query("DELETE FROM expenses WHERE group_id = ANY($1::uuid[])", [
    groupIds,
  ]);
  await AppDataSource.query("DELETE FROM tags WHERE group_id = ANY($1::uuid[])", [
    groupIds,
  ]);
  await AppDataSource.query(
    "DELETE FROM categories WHERE group_id = ANY($1::uuid[])",
    [groupIds],
  );
  await AppDataSource.query(
    "DELETE FROM group_members WHERE group_id = ANY($1::uuid[])",
    [groupIds],
  );
  await AppDataSource.query("DELETE FROM groups WHERE id = ANY($1::uuid[])", [
    groupIds,
  ]);
};

const upsertDemoUsers = async (): Promise<DemoUsers> => {
  const userRepository = getRepository(User);
  const passwordHash = await hash(demoPassword, 10);
  const users = {} as DemoUsers;

  for (const demoUser of demoUsers) {
    const existingUser = await userRepository.findOne({
      where: { email: demoUser.email },
    });
    const user =
      existingUser ??
      userRepository.create({
        email: demoUser.email,
        avatarUrl: null,
      });

    user.name = demoUser.name;
    user.passwordHash = passwordHash;
    users[demoUser.key] = await userRepository.save(user);
  }

  return users;
};

const createGroup = async (
  name: string,
  description: string,
  type: GroupType,
  createdBy: User,
): Promise<Group> =>
  getRepository(Group).save(
    getRepository(Group).create({
      name,
      description,
      type,
      createdById: createdBy.id,
    }),
  );

const addMembers = async (
  group: Group,
  users: DemoUsers,
  members: DemoUserKey[],
  admin: DemoUserKey,
): Promise<void> => {
  await getRepository(GroupMember).save(
    members.map((member) =>
      getRepository(GroupMember).create({
        groupId: group.id,
        userId: users[member].id,
        role: member === admin ? MemberRole.ADMIN : MemberRole.MEMBER,
      }),
    ),
  );
};

const createCategory = async (
  group: Group,
  name: string,
  icon: string,
  color: string,
): Promise<Category> =>
  getRepository(Category).save(
    getRepository(Category).create({
      groupId: group.id,
      name,
      icon,
      color,
    }),
  );

const createTags = async (
  group: Group,
  tags: { name: string; color: string }[],
): Promise<Record<string, Tag>> => {
  const savedTags = await getRepository(Tag).save(
    tags.map((tag) =>
      getRepository(Tag).create({
        groupId: group.id,
        name: tag.name,
        color: tag.color,
      }),
    ),
  );

  return Object.fromEntries(savedTags.map((tag) => [tag.name, tag]));
};

const getSystemCategoryMap = async (): Promise<Record<string, Category>> => {
  const categories = await getRepository(Category).find({
    where: { groupId: IsNull() },
  });

  return Object.fromEntries(categories.map((category) => [category.name, category]));
};

const allocateRemainder = (
  amountCents: number,
  rawShares: { user: DemoUserKey; weight: number; input: string | null }[],
): { user: DemoUserKey; shareCents: number; input: string | null }[] => {
  const totalWeight = rawShares.reduce((total, share) => total + share.weight, 0);
  let remainingCents = amountCents;

  return rawShares.map((share, index) => {
    const shareCents =
      index === rawShares.length - 1
        ? remainingCents
        : Math.round((amountCents * share.weight) / totalWeight);
    remainingCents -= shareCents;

    return {
      user: share.user,
      shareCents,
      input: share.input,
    };
  });
};

const buildParticipantShares = (
  members: DemoUserKey[],
  amountCents: number,
  split: SplitConfig,
): { user: DemoUserKey; shareCents: number; input: string | null }[] => {
  if (split.type === SplitType.EQUAL) {
    return allocateRemainder(
      amountCents,
      members.map((member) => ({ user: member, weight: 1, input: null })),
    );
  }

  if (split.type === SplitType.EXACT) {
    const shares = members.map((member) => ({
      user: member,
      shareCents: split.shares[member] ?? 0,
      input: formatCents(split.shares[member] ?? 0),
    }));
    const assignedCents = shares.reduce((total, share) => total + share.shareCents, 0);
    const adjustedLastShare = shares[shares.length - 1].shareCents + amountCents - assignedCents;

    if (assignedCents > amountCents || adjustedLastShare < 0) {
      return allocateRemainder(
        amountCents,
        members.map((member) => ({
          user: member,
          weight: split.shares[member] ?? 1,
          input: null,
        })),
      ).map((share) => ({
        ...share,
        input: formatCents(share.shareCents),
      }));
    }

    shares[shares.length - 1].shareCents = adjustedLastShare;
    shares[shares.length - 1].input = formatCents(adjustedLastShare);

    return shares;
  }

  return allocateRemainder(
    amountCents,
    members.map((member) => {
      const weight = split.shares[member] ?? 0;

      return {
        user: member,
        weight,
        input: String(weight),
      };
    }),
  );
};

const createExpense = async (users: DemoUsers, seed: ExpenseSeed): Promise<Expense> => {
  const expenseRepository = getRepository(Expense);
  const expense = await expenseRepository.save(
    expenseRepository.create({
      groupId: seed.group.id,
      paidById: users[seed.paidBy].id,
      amount: formatCents(seed.amountCents),
      description: seed.description,
      categoryId: seed.category?.id ?? null,
      splitType: seed.split.type,
      date: seed.date,
      notes: seed.notes ?? null,
      isRecurring: seed.isRecurring ?? false,
      recurInterval: seed.recurInterval ?? null,
      recurAnchor: seed.recurAnchor ?? null,
      createdById: users[seed.paidBy].id,
      tags: seed.tags,
    }),
  );
  const participantShares = buildParticipantShares(
    seed.members,
    seed.amountCents,
    seed.split,
  );

  await getRepository(ExpenseParticipant).save(
    participantShares.map((participant) =>
      getRepository(ExpenseParticipant).create({
        expenseId: expense.id,
        userId: users[participant.user].id,
        shareAmount: formatCents(participant.shareCents),
        splitInput: participant.input,
      }),
    ),
  );

  return expense;
};

const createSettlement = async (
  group: Group,
  users: DemoUsers,
  paidBy: DemoUserKey,
  paidTo: DemoUserKey,
  amountCents: number,
  date: string,
  notes: string,
): Promise<Settlement> =>
  getRepository(Settlement).save(
    getRepository(Settlement).create({
      groupId: group.id,
      paidById: users[paidBy].id,
      paidToId: users[paidTo].id,
      amount: formatCents(amountCents),
      date,
      notes,
    }),
  );

const seedExpenses = async (
  users: DemoUsers,
  flat: Group,
  goa: Group,
  personal: Group,
): Promise<number> => {
  const systemCategories = await getSystemCategoryMap();
  const flatMaintenance = await createCategory(flat, "Maintenance", "🛠️", "#64748B");
  const flatSupplies = await createCategory(flat, "Shared Supplies", "🧴", "#14B8A6");
  const goaActivities = await createCategory(goa, "Activities", "🏄", "#0EA5E9");
  const personalShopping = await createCategory(personal, "Shopping", "🛍️", "#A855F7");
  const flatTags = await createTags(flat, [
    { name: "Monthly", color: "#6366F1" },
    { name: "Utilities", color: "#F59E0B" },
    { name: "Kitchen", color: "#10B981" },
    { name: "Repairs", color: "#64748B" },
  ]);
  const goaTags = await createTags(goa, [
    { name: "Goa trip", color: "#06B6D4" },
    { name: "Food crawl", color: "#F97316" },
    { name: "Transport", color: "#8B5CF6" },
    { name: "Beach day", color: "#0EA5E9" },
  ]);
  const personalTags = await createTags(personal, [
    { name: "Weekend", color: "#EC4899" },
    { name: "Dinner", color: "#F97316" },
    { name: "Errands", color: "#84CC16" },
  ]);
  const expenseSeeds: ExpenseSeed[] = [];
  const flatMembers: DemoUserKey[] = ["mohak", "raj", "priya", "ananya"];
  const goaMembers: DemoUserKey[] = ["mohak", "raj", "priya", "ananya"];
  const personalMembers: DemoUserKey[] = ["mohak", "raj"];
  const flatPayers: DemoUserKey[] = ["mohak", "raj", "priya", "ananya"];
  const foodDescriptions = [
    "Weekly groceries",
    "Vegetables and fruits",
    "Milk and breakfast supplies",
    "Late-night snacks",
    "Kitchen restock",
    "Cleaning supplies",
  ];

  for (let month = 0; month < 4; month += 1) {
    expenseSeeds.push({
      group: flat,
      members: flatMembers,
      description: `Flat rent month ${month + 1}`,
      amountCents: 880000,
      paidBy: "mohak",
      category: systemCategories.Rent,
      tags: [flatTags.Monthly],
      date: daysAgo(month * 30 + 2),
      split: { type: SplitType.EQUAL },
      notes: "Recurring rent seeded for dashboard testing",
      isRecurring: month === 0,
      recurInterval: month === 0 ? RecurInterval.MONTHLY : null,
      recurAnchor: month === 0 ? daysAgo(2) : null,
    });
    expenseSeeds.push({
      group: flat,
      members: flatMembers,
      description: `Internet and OTT month ${month + 1}`,
      amountCents: 320000,
      paidBy: "raj",
      category: systemCategories.Internet,
      tags: [flatTags.Monthly, flatTags.Utilities],
      date: daysAgo(month * 30 + 5),
      split: {
        type: SplitType.PERCENTAGE,
        shares: { mohak: 25, raj: 25, priya: 25, ananya: 25 },
      },
      isRecurring: month === 0,
      recurInterval: month === 0 ? RecurInterval.MONTHLY : null,
      recurAnchor: month === 0 ? daysAgo(5) : null,
    });
    expenseSeeds.push({
      group: flat,
      members: flatMembers,
      description: `Electricity bill month ${month + 1}`,
      amountCents: 260000 + month * 12000,
      paidBy: "priya",
      category: systemCategories.Utilities,
      tags: [flatTags.Utilities],
      date: daysAgo(month * 30 + 8),
      split: { type: SplitType.EQUAL },
    });
  }

  for (let index = 0; index < 42; index += 1) {
    expenseSeeds.push({
      group: flat,
      members: flatMembers,
      description: foodDescriptions[index % foodDescriptions.length],
      amountCents: 90000 + (index % 7) * 17500,
      paidBy: flatPayers[index % flatPayers.length],
      category: index % 5 === 0 ? flatSupplies : systemCategories.Groceries,
      tags: index % 4 === 0 ? [flatTags.Kitchen, flatTags.Monthly] : [flatTags.Kitchen],
      date: daysAgo(index * 2 + 1),
      split:
        index % 6 === 0
          ? {
              type: SplitType.EXACT,
              shares: {
                mohak: 50000,
                raj: 35000,
                priya: 25000,
                ananya: 15000,
              },
            }
          : { type: SplitType.EQUAL },
      notes: index % 9 === 0 ? "Imported from demo seed" : null,
    });
  }

  for (let index = 0; index < 8; index += 1) {
    expenseSeeds.push({
      group: flat,
      members: flatMembers,
      description: index % 2 === 0 ? "Plumber visit" : "Common area repairs",
      amountCents: 150000 + index * 18000,
      paidBy: index % 2 === 0 ? "ananya" : "raj",
      category: flatMaintenance,
      tags: [flatTags.Repairs],
      date: daysAgo(index * 9 + 3),
      split: {
        type: SplitType.SHARES,
        shares: { mohak: 1, raj: 1, priya: 1, ananya: 2 },
      },
    });
  }

  const goaDescriptions = [
    "Airport cab",
    "Beach shack lunch",
    "Scooter rental",
    "Villa booking",
    "Water sports",
    "Cafe breakfast",
    "Dinner at Panjim",
    "Fuel refill",
    "Club entry",
    "Airport snacks",
    "Spice plantation tickets",
    "Souvenir run",
  ];

  for (let index = 0; index < 24; index += 1) {
    const transport = index % 4 === 0 || index % 4 === 2;

    expenseSeeds.push({
      group: goa,
      members: goaMembers,
      description: goaDescriptions[index % goaDescriptions.length],
      amountCents: 70000 + (index % 8) * 45000,
      paidBy: flatPayers[(index + 1) % flatPayers.length],
      category: transport
        ? systemCategories.Transport
        : index % 5 === 0
          ? goaActivities
          : systemCategories["Food & Dining"],
      tags: transport
        ? [goaTags["Goa trip"], goaTags.Transport]
        : [goaTags["Goa trip"], index % 3 === 0 ? goaTags["Beach day"] : goaTags["Food crawl"]],
      date: daysAgo(18 - (index % 6) + Math.floor(index / 6)),
      split:
        index % 7 === 0
          ? {
              type: SplitType.PERCENTAGE,
              shares: { mohak: 40, raj: 20, priya: 20, ananya: 20 },
            }
          : { type: SplitType.EQUAL },
      notes: "Goa Trip Demo",
    });
  }

  for (let index = 0; index < 16; index += 1) {
    expenseSeeds.push({
      group: personal,
      members: personalMembers,
      description: index % 3 === 0 ? "Dinner split" : index % 3 === 1 ? "Movie tickets" : "Errands",
      amountCents: 45000 + (index % 6) * 22000,
      paidBy: index % 2 === 0 ? "mohak" : "raj",
      category:
        index % 3 === 0
          ? systemCategories["Food & Dining"]
          : index % 3 === 1
            ? systemCategories.Entertainment
            : personalShopping,
      tags: index % 3 === 2 ? [personalTags.Errands] : [personalTags.Weekend, personalTags.Dinner],
      date: daysAgo(index * 3 + 2),
      split:
        index % 4 === 0
          ? {
              type: SplitType.EXACT,
              shares: { mohak: 30000, raj: 50000 },
            }
          : { type: SplitType.EQUAL },
    });
  }

  for (const expenseSeed of expenseSeeds) {
    await createExpense(users, expenseSeed);
  }

  await createSettlement(flat, users, "raj", "mohak", 125000, daysAgo(6), "Partial rent settlement");
  await createSettlement(flat, users, "ananya", "priya", 86000, daysAgo(11), "Electricity reimbursement");
  await createSettlement(flat, users, "priya", "raj", 72000, daysAgo(20), "Shared supplies cleanup");
  await createSettlement(goa, users, "mohak", "priya", 180000, daysAgo(9), "Goa villa advance");
  await createSettlement(goa, users, "raj", "ananya", 95000, daysAgo(7), "Trip transfer");
  await createSettlement(goa, users, "ananya", "mohak", 64000, daysAgo(5), "Cab reimbursement");
  await createSettlement(personal, users, "raj", "mohak", 53000, daysAgo(4), "Weekend expenses");
  await createSettlement(personal, users, "mohak", "raj", 41000, daysAgo(16), "Movie and dinner");

  return expenseSeeds.length;
};

const run = async (): Promise<void> => {
  await AppDataSource.initialize();

  try {
    const constantsResult = await seedSystemCategories();
    await clearDemoGroups();

    const users = await upsertDemoUsers();
    const flat = await createGroup(
      "Flat 4B Demo",
      "Shared apartment demo group with recurring household expenses",
      GroupType.HOUSEHOLD,
      users.mohak,
    );
    const goa = await createGroup(
      "Goa Trip Demo",
      "Trip/event demo group with dense expenses and tags",
      GroupType.PERSONAL,
      users.priya,
    );
    const personal = await createGroup(
      "Raj & Mohak Demo",
      "Two-person personal expense demo group",
      GroupType.PERSONAL,
      users.raj,
    );

    await addMembers(flat, users, ["mohak", "raj", "priya", "ananya"], "mohak");
    await addMembers(goa, users, ["mohak", "raj", "priya", "ananya"], "priya");
    await addMembers(personal, users, ["mohak", "raj"], "raj");

    const expenseCount = await seedExpenses(users, flat, goa, personal);

    console.log("Seeded demo data.");
    console.log(
      `System categories created: ${constantsResult.created}, updated: ${constantsResult.updated}, unchanged: ${constantsResult.unchanged}.`,
    );
    console.log(`Users: ${demoUsers.length}. Groups: 3. Expenses: ${expenseCount}. Settlements: 8.`);
    console.log(`Demo password for all users: ${demoPassword}`);
    console.log(`Login emails: ${demoUsers.map((user) => user.email).join(", ")}`);
  } finally {
    await AppDataSource.destroy();
  }
};

run().catch((error: unknown) => {
  console.error("Failed to seed demo data.", error);
  process.exit(1);
});

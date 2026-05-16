import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { groupInvites, type GroupInvite } from "../db/schema/group-invites.js";
import { groupMembers, groups, type Group, type GroupMember } from "../db/schema/groups.js";
import { type User } from "../db/schema/users.js";

export type UserResponse = {
  id: string;
  firebaseUid: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  name: string;
  avatarUrl: string | null;
  avatarFileId: string | null;
  upiId: string | null;
  preferredSettlementMethod: User["preferredSettlementMethod"] | null;
  lastSignInProvider: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ActiveHouseholdResponse = {
  id: string;
  name: string;
  type: Group["type"];
  city: string | null;
  locality: string | null;
  unitLabel: string | null;
  apartmentName: string | null;
  coverFileId: string | null;
  status: Group["status"];
  memberRole: GroupMember["role"];
};

export type OnboardingState = {
  needsName: boolean;
  needsGroup: boolean;
  needsUpiId: boolean;
  needsAvatar: boolean;
  nextStep:
    | "profile"
    | "create_or_join_household"
    | "add_upi"
    | "add_avatar"
    | "done";
};

export type PendingOnboardingInviteResponse = {
  id: string;
  inviteToken: string;
  inviteType: GroupInvite["inviteType"];
  phone: string | null;
  email: string | null;
  intendedName: string | null;
  roomLabel: string | null;
  intendedMoveInDate: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  alreadyMember: boolean;
  group: {
    id: string;
    name: string;
    type: Group["type"];
    city: string | null;
    locality: string | null;
    apartmentName: string | null;
    unitLabel: string | null;
    coverFileId: string | null;
    status: Group["status"];
  };
};

export const STARTER_BILL_PRESETS = [
  {
    key: "rent",
    name: "Rent",
    billKind: "rent",
    amountMode: "fixed",
    cadence: "monthly",
    splitStrategy: "equal_active_residents",
    suggestedDueDay: 1,
    collectProofImage: false,
  },
  {
    key: "electricity",
    name: "Electricity",
    billKind: "electricity",
    amountMode: "variable",
    cadence: "monthly",
    splitStrategy: "equal_active_residents",
    suggestedDueDay: 10,
    collectProofImage: true,
  },
  {
    key: "maid",
    name: "Maid",
    billKind: "maid",
    amountMode: "fixed",
    cadence: "monthly",
    splitStrategy: "equal_active_residents",
    suggestedDueDay: 5,
    collectProofImage: false,
  },
  {
    key: "cook",
    name: "Cook",
    billKind: "cook",
    amountMode: "fixed",
    cadence: "monthly",
    splitStrategy: "equal_active_residents",
    suggestedDueDay: 5,
    collectProofImage: false,
  },
  {
    key: "wifi",
    name: "Wi-Fi",
    billKind: "wifi",
    amountMode: "fixed",
    cadence: "monthly",
    splitStrategy: "equal_active_residents",
    suggestedDueDay: 8,
    collectProofImage: false,
  },
  {
    key: "maintenance",
    name: "Maintenance",
    billKind: "maintenance",
    amountMode: "fixed",
    cadence: "monthly",
    splitStrategy: "equal_active_residents",
    suggestedDueDay: 1,
    collectProofImage: false,
  },
  {
    key: "water",
    name: "Water Cans",
    billKind: "water",
    amountMode: "variable",
    cadence: "monthly",
    splitStrategy: "equal_active_residents",
    suggestedDueDay: 15,
    collectProofImage: false,
  },
  {
    key: "gas",
    name: "Gas Refill",
    billKind: "gas",
    amountMode: "variable",
    cadence: "monthly",
    splitStrategy: "equal_active_residents",
    suggestedDueDay: 20,
    collectProofImage: false,
  },
  {
    key: "subscription",
    name: "Subscriptions",
    billKind: "subscription",
    amountMode: "fixed",
    cadence: "monthly",
    splitStrategy: "equal_active_residents",
    suggestedDueDay: 3,
    collectProofImage: false,
  },
] as const;

export function presentUser(u: User): UserResponse {
  return {
    id: u.id,
    firebaseUid: u.firebaseUid,
    email: u.email,
    emailVerified: u.emailVerified,
    phone: u.phone,
    name: u.name,
    avatarUrl: u.avatarUrl,
    avatarFileId: u.avatarFileId,
    upiId: u.upiId,
    preferredSettlementMethod: u.preferredSettlementMethod ?? null,
    lastSignInProvider: u.lastSignInProvider,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

export function buildOnboardingState(
  user: Pick<User, "name" | "upiId" | "avatarUrl" | "avatarFileId">,
  activeHouseholds: ActiveHouseholdResponse[],
): OnboardingState {
  const needsName = user.name.trim().length === 0 || user.name === "User";
  const needsGroup = activeHouseholds.length === 0;
  const needsUpiId = !user.upiId;
  const needsAvatar = !user.avatarUrl && !user.avatarFileId;

  return {
    needsName,
    needsGroup,
    needsUpiId,
    needsAvatar,
    nextStep: needsName
      ? "profile"
      : needsGroup
        ? "create_or_join_household"
        : needsUpiId
          ? "add_upi"
          : needsAvatar
            ? "add_avatar"
            : "done",
  };
}

export async function listActiveHouseholds(userId: string): Promise<ActiveHouseholdResponse[]> {
  return db
    .select({
      id: groups.id,
      name: groups.name,
      type: groups.type,
      city: groups.city,
      locality: groups.locality,
      unitLabel: groups.unitLabel,
      apartmentName: groups.apartmentName,
      coverFileId: groups.coverFileId,
      status: groups.status,
      memberRole: groupMembers.role,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(groupMembers.userId, userId),
        ne(groupMembers.status, "left"),
        eq(groups.status, "active"),
      ),
    )
    .orderBy(desc(groups.updatedAt));
}

export function isInviteExpired(invite: Pick<GroupInvite, "expiresAt">): boolean {
  return !!invite.expiresAt && invite.expiresAt.getTime() < Date.now();
}

export async function listPendingOnboardingInvites(
  user: Pick<User, "id" | "email" | "phone">,
): Promise<PendingOnboardingInviteResponse[]> {
  const identityFilters = [];
  if (user.email) identityFilters.push(eq(groupInvites.email, user.email.toLowerCase()));
  if (user.phone) identityFilters.push(eq(groupInvites.phone, user.phone));

  const identityClause =
    identityFilters.length === 0
      ? null
      : identityFilters.length === 1
        ? identityFilters[0]!
        : or(...identityFilters);
  if (!identityClause) return [];

  const rows = await db
    .select({
      invite: groupInvites,
      group: groups,
    })
    .from(groupInvites)
    .innerJoin(groups, eq(groups.id, groupInvites.groupId))
    .where(
      and(
        eq(groupInvites.status, "pending"),
        eq(groups.status, "active"),
        identityClause,
      ),
    )
    .orderBy(desc(groupInvites.createdAt));

  const activeRows = rows.filter((row) => !isInviteExpired(row.invite));
  if (activeRows.length === 0) return [];

  const groupIds = Array.from(new Set(activeRows.map((row) => row.group.id)));
  const memberships = groupIds.length
    ? await db
        .select({ groupId: groupMembers.groupId })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.userId, user.id),
            ne(groupMembers.status, "left"),
            inArray(groupMembers.groupId, groupIds),
          ),
        )
    : [];
  const memberGroupIds = new Set(memberships.map((row) => row.groupId));

  return activeRows.map((row) => ({
    id: row.invite.id,
    inviteToken: row.invite.inviteToken,
    inviteType: row.invite.inviteType,
    phone: row.invite.phone,
    email: row.invite.email,
    intendedName: row.invite.intendedName,
    roomLabel: row.invite.roomLabel,
    intendedMoveInDate: row.invite.intendedMoveInDate,
    expiresAt: row.invite.expiresAt?.toISOString() ?? null,
    createdAt: row.invite.createdAt.toISOString(),
    updatedAt: row.invite.updatedAt.toISOString(),
    alreadyMember: memberGroupIds.has(row.group.id),
    group: {
      id: row.group.id,
      name: row.group.name,
      type: row.group.type,
      city: row.group.city,
      locality: row.group.locality,
      apartmentName: row.group.apartmentName,
      unitLabel: row.group.unitLabel,
      coverFileId: row.group.coverFileId,
      status: row.group.status,
    },
  }));
}

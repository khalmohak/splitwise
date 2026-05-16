// Shared response presenters. Kept thin — most endpoint-specific shaping is
// done in-route. These cover the recurring shapes that show up across many
// endpoints (member, user-mini, expense, settlement).

import type { User } from "../db/schema/users.js";
import type { Group, GroupMember } from "../db/schema/groups.js";
import type { Settlement } from "../db/schema/settlements.js";

export type UserMini = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type MemberResponse = UserMini & {
  userId: string;
  email: string | null;
  role: GroupMember["role"];
  status?: GroupMember["status"];
  moveInDate?: string | null;
  moveOutDate?: string | null;
  roomLabel?: string | null;
  billingStartPolicy?: GroupMember["billingStartPolicy"];
  billingEndPolicy?: GroupMember["billingEndPolicy"];
  joinedAt: string;
};

export type GroupDetailResponse = {
  id: string;
  name: string;
  type: Group["type"];
  description: string | null;
  city?: string | null;
  locality?: string | null;
  apartmentName?: string | null;
  unitLabel?: string | null;
  expectedResidentCount?: number | null;
  billingDay?: number | null;
  coverFileId?: string | null;
  status?: Group["status"];
  pendingInviteCount?: number;
  createdBy: { id: string; name: string };
  members: MemberResponse[];
  createdAt: string;
  updatedAt: string;
  inviteCode?: string | null;
};

export type SettlementResponse = {
  id: string;
  paidBy: UserMini;
  paidTo: UserMini;
  amount: string;
  date: string;
  notes: string | null;
  status: Settlement["status"];
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
};

export function toUserMini(u: Pick<User, "id" | "name" | "avatarUrl">): UserMini {
  return { id: u.id, name: u.name, avatarUrl: u.avatarUrl };
}

export function toMemberResponse(
  m: Pick<
    GroupMember,
    | "role"
    | "joinedAt"
    | "userId"
    | "status"
    | "moveInDate"
    | "moveOutDate"
    | "roomLabel"
    | "billingStartPolicy"
    | "billingEndPolicy"
  >,
  user: Pick<User, "id" | "name" | "email" | "avatarUrl">,
): MemberResponse {
  return {
    userId: user.id,
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    role: m.role,
    status: m.status,
    moveInDate: m.moveInDate ?? null,
    moveOutDate: m.moveOutDate ?? null,
    roomLabel: m.roomLabel ?? null,
    billingStartPolicy: m.billingStartPolicy,
    billingEndPolicy: m.billingEndPolicy,
    joinedAt: m.joinedAt.toISOString(),
  };
}

export function toSettlementResponse(
  s: Settlement,
  paidBy: Pick<User, "id" | "name" | "avatarUrl">,
  paidTo: Pick<User, "id" | "name" | "avatarUrl">,
): SettlementResponse {
  return {
    id: s.id,
    paidBy: toUserMini(paidBy),
    paidTo: toUserMini(paidTo),
    amount: s.amount,
    date: s.date,
    notes: s.notes,
    status: s.status,
    reviewedAt: s.reviewedAt ? s.reviewedAt.toISOString() : null,
    reviewNotes: s.reviewNotes,
    createdAt: s.createdAt.toISOString(),
  };
}

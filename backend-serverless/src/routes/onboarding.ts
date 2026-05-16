import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, txClient } from "../db/client.js";
import { billTemplates } from "../db/schema/bill-templates.js";
import { groupInvites, type GroupInvite } from "../db/schema/group-invites.js";
import { groupMembers, groups } from "../db/schema/groups.js";
import { uploadedFiles, type UploadedFile } from "../db/schema/uploaded-files.js";
import { users, type User } from "../db/schema/users.js";
import { requireAuth, type AuthVariables } from "../lib/auth.js";
import { badRequest, notFound } from "../lib/errors.js";
import { ensureCurrentBillInstances, todayDateOnly } from "../lib/households.js";
import { parseJson } from "../lib/http.js";
import { isMoneyString } from "../lib/money.js";
import {
  STARTER_BILL_PRESETS,
  buildOnboardingState,
  isInviteExpired,
  listActiveHouseholds,
  listPendingOnboardingInvites,
  presentUser,
} from "../lib/onboarding.js";
import { notify } from "../lib/notify.js";
import { relativeOrAbsoluteUrlSchema } from "../lib/validation.js";

export const onboarding = new Hono<{ Variables: AuthVariables }>();

onboarding.use("*", requireAuth);

const ALLOWED_AVATAR_FILE_KINDS: UploadedFile["kind"][] = ["avatar", "other"];
const ALLOWED_GROUP_COVER_FILE_KINDS: UploadedFile["kind"][] = ["group_cover", "other"];
const SUGGESTED_DUE_DAY_BY_KIND = new Map(
  STARTER_BILL_PRESETS.map((preset) => [preset.billKind, preset.suggestedDueDay] as const),
);

const onboardingProfileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  avatarUrl: relativeOrAbsoluteUrlSchema.nullable().optional(),
  avatarFileId: z.string().uuid().nullable().optional(),
  upiId: z.string().trim().min(1).max(120).nullable().optional(),
  preferredSettlementMethod: z.enum(["upi", "bank_transfer", "cash", "other"]).nullable().optional(),
});

const onboardingHouseholdSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  locality: z.string().trim().max(120).nullable().optional(),
  apartmentName: z.string().trim().max(160).nullable().optional(),
  unitLabel: z.string().trim().max(120).nullable().optional(),
  expectedResidentCount: z.number().int().min(1).max(100).nullable().optional(),
  billingDay: z.number().int().min(1).max(31).nullable().optional(),
  coverFileId: z.string().uuid().nullable().optional(),
});

const onboardingBillTemplateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  billKind: z
    .enum([
      "rent",
      "electricity",
      "maid",
      "cook",
      "wifi",
      "maintenance",
      "water",
      "gas",
      "subscription",
      "other",
    ])
    .optional(),
  vendorName: z.string().trim().max(160).nullable().optional(),
  amountMode: z.enum(["fixed", "variable"]).optional(),
  defaultAmount: z.string().nullable().optional(),
  currency: z.string().trim().length(3).optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
  defaultPayerUserId: z.string().uuid().nullable().optional(),
  assignToCreator: z.boolean().optional(),
  splitStrategy: z
    .enum(["equal_active_residents", "fixed_shares", "room_based", "custom_snapshot"])
    .optional(),
  splitConfig: z.record(z.unknown()).nullable().optional(),
  collectProofImage: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

const onboardingInviteSchema = z.object({
  inviteType: z.enum(["link", "phone", "email"]).optional(),
  phone: z.string().trim().min(1).max(40).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  intendedName: z.string().trim().min(1).max(120).nullable().optional(),
  roomLabel: z.string().trim().max(120).nullable().optional(),
  intendedMoveInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  expiresInDays: z.number().int().min(1).max(90).optional(),
});

const createHouseholdSchema = z.object({
  profile: onboardingProfileSchema.optional(),
  household: onboardingHouseholdSchema,
  billTemplates: z.array(onboardingBillTemplateSchema).max(20).optional(),
  invites: z.array(onboardingInviteSchema).max(50).optional(),
});

const acceptInviteSchema = z.object({
  token: z.string().trim().min(1).max(80),
  profile: onboardingProfileSchema.optional(),
  moveInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  roomLabel: z.string().trim().max(120).nullable().optional(),
});

type OnboardingProfileInput = z.infer<typeof onboardingProfileSchema>;
type OnboardingBillTemplateInput = z.infer<typeof onboardingBillTemplateSchema>;
type OnboardingInviteInput = z.infer<typeof onboardingInviteSchema>;

type UserMini = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

type UserNameMini = {
  id: string;
  name: string;
};

function createInviteToken(): string {
  return randomBytes(18).toString("base64url");
}

async function getUserOrThrow(id: string): Promise<User> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw notFound("User not found");
  return user;
}

async function assertOwnedFile(
  fileId: string | null | undefined,
  ownerId: string,
  allowedKinds: UploadedFile["kind"][],
): Promise<UploadedFile | null> {
  if (!fileId) return null;
  const [file] = await db
    .select()
    .from(uploadedFiles)
    .where(eq(uploadedFiles.id, fileId))
    .limit(1);
  if (!file || file.ownerId !== ownerId) throw notFound("File not found");
  if (!allowedKinds.includes(file.kind)) {
    throw badRequest("File kind is not valid for this onboarding step", "INVALID_FILE_KIND");
  }
  return file;
}

function normalizeProfilePatch(body: OnboardingProfileInput | undefined) {
  if (!body) return null;
  const patch: Partial<
    Pick<User, "name" | "avatarUrl" | "avatarFileId" | "upiId" | "preferredSettlementMethod">
  > = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.avatarUrl !== undefined) patch.avatarUrl = body.avatarUrl;
  if (body.avatarFileId !== undefined) patch.avatarFileId = body.avatarFileId;
  if (body.upiId !== undefined) patch.upiId = body.upiId;
  if (body.preferredSettlementMethod !== undefined) {
    patch.preferredSettlementMethod = body.preferredSettlementMethod;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function suggestedDueDayForKind(
  billKind: NonNullable<OnboardingBillTemplateInput["billKind"]> | "other",
  householdBillingDay: number | null | undefined,
): number {
  const presetDay =
    billKind === "other" ? undefined : SUGGESTED_DUE_DAY_BY_KIND.get(billKind);
  return householdBillingDay ?? presetDay ?? 1;
}

function normalizeBillTemplateInput(
  body: OnboardingBillTemplateInput,
  actorId: string,
  householdBillingDay: number | null | undefined,
) {
  if (body.defaultAmount != null && body.defaultAmount !== "" && !isMoneyString(body.defaultAmount)) {
    throw badRequest("defaultAmount must be a money string", "INVALID_DEFAULT_AMOUNT");
  }
  if (
    body.assignToCreator &&
    body.defaultPayerUserId &&
    body.defaultPayerUserId !== actorId
  ) {
    throw badRequest(
      "defaultPayerUserId conflicts with assignToCreator",
      "INVALID_DEFAULT_PAYER",
    );
  }

  const billKind = body.billKind ?? "other";
  const defaultPayerUserId =
    body.defaultPayerUserId ?? (body.assignToCreator ? actorId : null);
  if (defaultPayerUserId && defaultPayerUserId !== actorId) {
    throw notFound("Resident not found");
  }

  return {
    name: body.name,
    billKind,
    vendorName: body.vendorName ?? null,
    amountMode: body.amountMode ?? "fixed",
    defaultAmount: body.defaultAmount ?? null,
    currency: (body.currency ?? "INR").toUpperCase(),
    dueDay: body.dueDay ?? suggestedDueDayForKind(billKind, householdBillingDay),
    cadence: "monthly" as const,
    defaultPayerUserId,
    splitStrategy: body.splitStrategy ?? "equal_active_residents",
    splitConfig: body.splitConfig ?? null,
    collectProofImage: body.collectProofImage ?? false,
    isActive: body.isActive ?? true,
    notes: body.notes ?? null,
  };
}

function normalizeInviteInput(body: OnboardingInviteInput) {
  const inviteType = body.inviteType ?? "link";
  if (inviteType === "phone" && !body.phone) {
    throw badRequest("phone is required for phone invites", "PHONE_REQUIRED");
  }
  if (inviteType === "email" && !body.email) {
    throw badRequest("email is required for email invites", "EMAIL_REQUIRED");
  }

  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + (body.expiresInDays ?? 14));

  return {
    inviteType,
    phone: body.phone ?? null,
    email: body.email ? body.email.toLowerCase() : null,
    intendedName: body.intendedName ?? null,
    roomLabel: body.roomLabel ?? null,
    intendedMoveInDate: body.intendedMoveInDate ?? null,
    expiresAt,
  };
}

function presentTemplate(
  template: typeof billTemplates.$inferSelect,
  defaultPayer?: UserMini,
) {
  return {
    id: template.id,
    name: template.name,
    billKind: template.billKind,
    vendorName: template.vendorName,
    amountMode: template.amountMode,
    defaultAmount: template.defaultAmount,
    currency: template.currency,
    dueDay: template.dueDay,
    cadence: template.cadence,
    defaultPayer: defaultPayer
      ? {
          id: defaultPayer.id,
          name: defaultPayer.name,
          avatarUrl: defaultPayer.avatarUrl,
        }
      : null,
    splitStrategy: template.splitStrategy,
    splitConfig: template.splitConfig,
    collectProofImage: template.collectProofImage,
    isActive: template.isActive,
    notes: template.notes,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

function presentInvite(
  invite: typeof groupInvites.$inferSelect,
  invitedBy?: UserNameMini,
) {
  return {
    id: invite.id,
    inviteToken: invite.inviteToken,
    inviteType: invite.inviteType,
    phone: invite.phone,
    email: invite.email,
    intendedName: invite.intendedName,
    roomLabel: invite.roomLabel,
    intendedMoveInDate: invite.intendedMoveInDate,
    status: invite.status,
    invitedBy: invitedBy ? { id: invitedBy.id, name: invitedBy.name } : null,
    acceptedBy: null,
    acceptedAt: invite.acceptedAt?.toISOString() ?? null,
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    createdAt: invite.createdAt.toISOString(),
    updatedAt: invite.updatedAt.toISOString(),
  };
}

async function loadActiveInviteByToken(token: string): Promise<GroupInvite> {
  const [invite] = await db
    .select()
    .from(groupInvites)
    .where(eq(groupInvites.inviteToken, token))
    .limit(1);
  if (!invite || invite.status !== "pending" || isInviteExpired(invite)) {
    throw notFound("Invite link is invalid or has expired");
  }
  return invite;
}

async function loadInvitePreview(token: string, actorId: string) {
  const invite = await loadActiveInviteByToken(token);
  const [group] = await db
    .select()
    .from(groups)
    .where(eq(groups.id, invite.groupId))
    .limit(1);
  if (!group || group.status !== "active") {
    throw notFound("Invite link is invalid or has expired");
  }

  const [{ memberCount }] = (await db
    .select({ memberCount: sql<number>`count(*)::int` })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, group.id), ne(groupMembers.status, "left")))) as [
    { memberCount: number },
  ];

  const [self] = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, group.id),
        eq(groupMembers.userId, actorId),
        ne(groupMembers.status, "left"),
      ),
    )
    .limit(1);

  return {
    invite: {
      id: invite.id,
      inviteToken: invite.inviteToken,
      inviteType: invite.inviteType,
      roomLabel: invite.roomLabel,
      intendedMoveInDate: invite.intendedMoveInDate,
      intendedName: invite.intendedName,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
    },
    group: {
      id: group.id,
      name: group.name,
      type: group.type,
      city: group.city,
      locality: group.locality,
      apartmentName: group.apartmentName,
      unitLabel: group.unitLabel,
      coverFileId: group.coverFileId,
      memberCount,
    },
    alreadyMember: !!self,
  };
}

async function buildBootstrapResponse(userId: string, inviteToken?: string | null) {
  const user = await getUserOrThrow(userId);
  const [activeHouseholds, pendingInvites, invitePreview] = await Promise.all([
    listActiveHouseholds(userId),
    listPendingOnboardingInvites(user),
    inviteToken ? loadInvitePreview(inviteToken, userId) : Promise.resolve(null),
  ]);

  return {
    user: presentUser(user),
    onboarding: buildOnboardingState(user, activeHouseholds),
    activeHouseholds,
    pendingInvites,
    invitePreview,
    presets: {
      billTemplates: STARTER_BILL_PRESETS,
    },
  };
}

onboarding.get("/", async (c) => {
  const actor = c.get("user");
  const inviteToken = c.req.query("inviteToken");
  return c.json(await buildBootstrapResponse(actor.id, inviteToken));
});

onboarding.patch("/profile", async (c) => {
  const actor = c.get("user");
  const body = await parseJson(c, onboardingProfileSchema);

  if (body.avatarFileId !== undefined) {
    await assertOwnedFile(body.avatarFileId, actor.id, ALLOWED_AVATAR_FILE_KINDS);
  }

  const patch = normalizeProfilePatch(body);
  if (patch) {
    await db
      .update(users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(users.id, actor.id));
  }

  return c.json(await buildBootstrapResponse(actor.id));
});

onboarding.post("/create-household", async (c) => {
  const actor = c.get("user");
  const body = await parseJson(c, createHouseholdSchema);

  if (body.profile?.avatarFileId !== undefined) {
    await assertOwnedFile(body.profile.avatarFileId, actor.id, ALLOWED_AVATAR_FILE_KINDS);
  }
  if (body.household.coverFileId !== undefined) {
    await assertOwnedFile(body.household.coverFileId, actor.id, ALLOWED_GROUP_COVER_FILE_KINDS);
  }

  const profilePatch = normalizeProfilePatch(body.profile);
  const templates = (body.billTemplates ?? []).map((template) =>
    normalizeBillTemplateInput(template, actor.id, body.household.billingDay ?? null),
  );
  const invites = (body.invites ?? []).map(normalizeInviteInput);
  const tx = txClient();

  const result = await tx.transaction(async (tx2) => {
    if (profilePatch) {
      await tx2
        .update(users)
        .set({ ...profilePatch, updatedAt: new Date() })
        .where(eq(users.id, actor.id));
    }

    const [createdGroup] = await tx2
      .insert(groups)
      .values({
        name: body.household.name,
        description: body.household.description ?? null,
        type: "household",
        city: body.household.city ?? null,
        locality: body.household.locality ?? null,
        apartmentName: body.household.apartmentName ?? null,
        unitLabel: body.household.unitLabel ?? null,
        expectedResidentCount: body.household.expectedResidentCount ?? null,
        billingDay: body.household.billingDay ?? null,
        coverFileId: body.household.coverFileId ?? null,
        createdById: actor.id,
      })
      .returning();
    if (!createdGroup) throw new Error("group insert returned no row");

    await tx2.insert(groupMembers).values({
      groupId: createdGroup.id,
      userId: actor.id,
      role: "admin",
      status: "active",
      moveInDate: todayDateOnly(),
    });

    if (body.household.coverFileId) {
      await tx2
        .update(uploadedFiles)
        .set({ groupId: createdGroup.id })
        .where(eq(uploadedFiles.id, body.household.coverFileId));
    }

    const createdTemplates =
      templates.length > 0
        ? await tx2
            .insert(billTemplates)
            .values(
              templates.map((template) => ({
                groupId: createdGroup.id,
                ...template,
              })),
            )
            .returning()
        : [];

    const createdInvites =
      invites.length > 0
        ? await tx2
            .insert(groupInvites)
            .values(
              invites.map((invite) => ({
                groupId: createdGroup.id,
                inviteToken: createInviteToken(),
                status: "pending" as const,
                invitedById: actor.id,
                ...invite,
              })),
            )
            .returning()
        : [];

    return {
      groupId: createdGroup.id,
      createdTemplates,
      createdInvites,
    };
  });

  await notify({ kind: "group_created", groupId: result.groupId, recipientId: actor.id });
  if (result.createdTemplates.length > 0) {
    await ensureCurrentBillInstances(result.groupId);
  }

  const bootstrap = await buildBootstrapResponse(actor.id);
  const household = bootstrap.activeHouseholds.find((item) => item.id === result.groupId) ?? null;
  const defaultPayer: UserMini = {
    id: bootstrap.user.id,
    name: bootstrap.user.name,
    avatarUrl: bootstrap.user.avatarUrl,
  };
  const invitedBy: UserNameMini = {
    id: bootstrap.user.id,
    name: bootstrap.user.name,
  };

  return c.json(
    {
      ...bootstrap,
      household,
      createdBillTemplates: result.createdTemplates.map((template) =>
        presentTemplate(
          template,
          template.defaultPayerUserId === bootstrap.user.id ? defaultPayer : undefined,
        ),
      ),
      createdInvites: result.createdInvites.map((invite) => presentInvite(invite, invitedBy)),
    },
    201,
  );
});

onboarding.post("/accept-invite", async (c) => {
  const actor = c.get("user");
  const body = await parseJson(c, acceptInviteSchema);

  if (body.profile?.avatarFileId !== undefined) {
    await assertOwnedFile(body.profile.avatarFileId, actor.id, ALLOWED_AVATAR_FILE_KINDS);
  }

  const invite = await loadActiveInviteByToken(body.token);
  const [group] = await db
    .select()
    .from(groups)
    .where(eq(groups.id, invite.groupId))
    .limit(1);
  if (!group || group.status !== "active") {
    throw notFound("Invite link is invalid or has expired");
  }

  const profilePatch = normalizeProfilePatch(body.profile);
  const moveInDate = body.moveInDate ?? invite.intendedMoveInDate ?? todayDateOnly();
  const roomLabel = body.roomLabel ?? invite.roomLabel ?? null;
  const tx = txClient();

  await tx.transaction(async (tx2) => {
    if (profilePatch) {
      await tx2
        .update(users)
        .set({ ...profilePatch, updatedAt: new Date() })
        .where(eq(users.id, actor.id));
    }

    await tx2
      .insert(groupMembers)
      .values({
        groupId: invite.groupId,
        userId: actor.id,
        role: "member",
        status: "active",
        moveInDate,
        roomLabel,
      })
      .onConflictDoUpdate({
        target: [groupMembers.groupId, groupMembers.userId],
        set: {
          role: "member",
          status: "active",
          moveInDate,
          roomLabel,
          moveOutDate: null,
          billingStartPolicy: "next_cycle",
          billingEndPolicy: "end_of_cycle",
        },
      });

    await tx2
      .update(groupInvites)
      .set({
        status: "accepted",
        acceptedByUserId: actor.id,
        acceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(groupInvites.id, invite.id));
  });

  const bootstrap = await buildBootstrapResponse(actor.id);
  const household = bootstrap.activeHouseholds.find((item) => item.id === invite.groupId) ?? null;

  return c.json({
    ...bootstrap,
    groupId: invite.groupId,
    household,
  });
});

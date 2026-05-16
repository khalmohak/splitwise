import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, type User } from "../db/schema/users.js";
import { requireAuth, type AuthVariables } from "../lib/auth.js";
import { enqueueAsyncJob } from "../lib/async-jobs.js";
import { adminAuth } from "../lib/firebase-admin.js";
import { parseJson } from "../lib/http.js";
import {
  buildOnboardingState,
  listActiveHouseholds,
  presentUser,
} from "../lib/onboarding.js";
import { relativeOrAbsoluteUrlSchema } from "../lib/validation.js";

export const auth = new Hono<{ Variables: AuthVariables }>();

async function getUserById(id: string): Promise<User> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: "user not found" });
  return row;
}

// POST /auth/session — client calls this right after Firebase sign-in.
// The middleware already verified the token and JIT-provisioned the row;
// this endpoint just confirms back the canonical user.
auth.post("/session", requireAuth, async (c) => {
  const { id } = c.get("user");
  const user = await getUserById(id);
  const activeHouseholds = await listActiveHouseholds(id);

  return c.json({
    user: presentUser(user),
    onboarding: buildOnboardingState(user, activeHouseholds),
    activeHouseholds,
  });
});

// GET /auth/me — current user profile.
auth.get("/me", requireAuth, async (c) => {
  const { id } = c.get("user");
  const user = await getUserById(id);
  return c.json({ user: presentUser(user) });
});

// PATCH /auth/me — update fields the user owns. Email/phone/emailVerified
// are intentionally excluded — those reflect Firebase identity state and
// are updated server-side from the next sign-in's token.
const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  avatarUrl: relativeOrAbsoluteUrlSchema.nullable().optional(),
  avatarFileId: z.string().uuid().nullable().optional(),
  upiId: z.string().trim().min(1).max(120).nullable().optional(),
  preferredSettlementMethod: z.enum(["upi", "bank_transfer", "cash", "other"]).nullable().optional(),
});

auth.patch("/me", requireAuth, async (c) => {
  const body = await parseJson(c, updateMeSchema);
  if (Object.keys(body).length === 0) {
    const { id } = c.get("user");
    const user = await getUserById(id);
    return c.json({ user: presentUser(user) });
  }
  const { id } = c.get("user");
  const [row] = await db
    .update(users)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  if (!row) throw new HTTPException(404, { message: "user not found" });
  return c.json({ user: presentUser(row) });
});

// POST /auth/logout — revoke all refresh tokens for this user. The current
// ID token stays valid until its natural expiry (~1h max), but refresh
// fails on every device. Client should also drop tokens locally.
auth.post("/logout", requireAuth, async (c) => {
  const { firebaseUid } = c.get("user");
  const fb = await adminAuth();
  await fb.revokeRefreshTokens(firebaseUid);
  return c.body(null, 204);
});

// DELETE /auth/me — delete the user's account.
//
// Order matters: we revoke tokens first so the user can't keep authing
// while we delete, then attempt the DB delete. If there's active data
// (expenses, settlements, etc. that FK to this user without cascade) the
// DB rejects with 23503 and we surface a 409 — the user must clear their
// activity before we can hard-delete. Only after DB succeeds do we delete
// the Firebase user.
auth.delete("/me", requireAuth, async (c) => {
  const { id, firebaseUid } = c.get("user");
  const fb = await adminAuth();

  await fb.revokeRefreshTokens(firebaseUid);

  try {
    await db.delete(users).where(eq(users.id, id));
  } catch (err: unknown) {
    if (isPgForeignKeyError(err)) {
      throw new HTTPException(409, {
        message:
          "account has activity; leave all groups and remove expenses/settlements you authored before deleting",
      });
    }
    throw err;
  }

  // DB deleted — now remove from Firebase. If this fails the user is
  // already gone from our DB; their next sign-in would JIT-create a
  // fresh row, which is recoverable but not ideal. We log and proceed.
  try {
    await fb.deleteUser(firebaseUid);
  } catch (err) {
    console.error("firebase deleteUser failed after DB delete", {
      firebaseUid,
      err: err instanceof Error ? err.message : err,
    });
  }

  return c.body(null, 204);
});

// POST /auth/email-verification — generate a Firebase verification link and
// enqueue the branded email. In local debug mode we also return the raw link
// so flows can be tested without mailbox access.
auth.post("/email-verification", requireAuth, async (c) => {
  const { email, name } = c.get("user");
  if (!email) {
    throw new HTTPException(422, { message: "user has no email on file" });
  }
  const fb = await adminAuth();
  const link = await fb.generateEmailVerificationLink(email);
  await enqueueAsyncJob({
    type: "email_verification",
    to: email,
    name: name || nameFromEmail(email),
    verifyUrl: link,
  });
  if (process.env.NOTIFY_DEBUG === "1") {
    return c.json({ message: "verification email sent", link });
  }
  return c.json({ message: "verification email sent" });
});

// POST /auth/password-reset — unauthed. Generates and emails a Firebase reset
// link. We swallow user-not-found errors so attackers cannot enumerate emails.
const resetSchema = z.object({ email: z.string().email() });

auth.post("/password-reset", async (c) => {
  const { email } = await parseJson(c, resetSchema);
  const fb = await adminAuth();
  const normalizedEmail = email.trim().toLowerCase();
  try {
    const link = await fb.generatePasswordResetLink(normalizedEmail);
    const [knownUser] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);
    await enqueueAsyncJob({
      type: "password_reset",
      to: normalizedEmail,
      name: knownUser?.name ?? nameFromEmail(normalizedEmail),
      resetUrl: link,
    });
    if (process.env.NOTIFY_DEBUG === "1") {
      return c.json({
        message: "if that email is registered, a reset link has been sent",
        link,
      });
    }
    return c.json({
      message: "if that email is registered, a reset link has been sent",
    });
  } catch (err) {
    if (isFirebaseUserNotFound(err)) {
      return c.json({
        message: "if that email is registered, a reset link has been sent",
      });
    }
    throw err;
  }
});

function isPgForeignKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23503"
  );
}

function isFirebaseUserNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "auth/user-not-found"
  );
}

function nameFromEmail(email: string): string {
  const [local] = email.split("@");
  return local?.trim() || "there";
}

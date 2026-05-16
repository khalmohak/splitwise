import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, type User } from "../db/schema/users.js";
import { env } from "./env.js";
import { notify } from "./notify.js";
import { adminAuth } from "./firebase-admin.js";

// Firebase publishes its public keys at this endpoint. JWKS is cached
// internally by jose so verification stays a sub-ms in-memory op once warm.
const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

const jwks = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
const ISSUER = `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`;
const AUDIENCE = env.FIREBASE_PROJECT_ID;

type FirebasePayload = JWTPayload & {
  email?: string;
  email_verified?: boolean;
  phone_number?: string;
  name?: string;
  picture?: string;
  firebase?: {
    sign_in_provider?: string;
    identities?: Record<string, unknown>;
  };
};

export type AuthUser = {
  id: string;            // internal users.id (UUID)
  sub: string;           // alias for id (back-compat)
  firebaseUid: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  name: string;
  signInProvider: string | null;
  claims: FirebasePayload;
};

export type AuthVariables = { user: AuthUser };

export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const header = c.req.header("authorization") ?? c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      throw new HTTPException(401, { message: "missing bearer token" });
    }
    const token = header.slice("Bearer ".length).trim();

    const payload = await verifyFirebaseToken(token);

    const firebaseUid = payload.sub;
    if (!firebaseUid) {
      throw new HTTPException(401, { message: "token missing sub" });
    }

    const { user, created } = await upsertUserFromToken(firebaseUid, payload);
    if (created) {
      await notify({ kind: "welcome", userId: user.id });
    }

    c.set("user", {
      id: user.id,
      sub: user.id,
      firebaseUid: user.firebaseUid,
      email: user.email,
      emailVerified: user.emailVerified,
      phone: user.phone,
      name: user.name,
      signInProvider: user.lastSignInProvider,
      claims: payload,
    });

    await next();
  },
);

async function verifyFirebaseToken(token: string): Promise<FirebasePayload> {
  try {
    const verified = await jwtVerify<FirebasePayload>(token, jwks, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return verified.payload;
  } catch (joseError) {
    try {
      const fb = await adminAuth();
      const decoded = await fb.verifyIdToken(token);
      return {
        ...decoded,
        firebase: decoded.firebase as FirebasePayload["firebase"],
      };
    } catch (adminError) {
      console.error("[auth] token verification failed", {
        joseError: joseError instanceof Error ? joseError.message : joseError,
        adminError: adminError instanceof Error ? adminError.message : adminError,
        projectId: env.FIREBASE_PROJECT_ID,
      });
      throw new HTTPException(401, { message: "invalid token" });
    }
  }
}

// JIT-provision a users row on first verified request, and keep mutable
// profile fields (email, phone, photo, provider) in sync with the latest
// token. Returns the row.
async function upsertUserFromToken(
  firebaseUid: string,
  payload: FirebasePayload,
): Promise<{ user: User; created: boolean }> {
  const email = payload.email ?? null;
  const phone = payload.phone_number ?? null;
  const name =
    payload.name?.trim() ||
    email?.split("@")[0] ||
    phone ||
    "User";
  const avatarUrl = payload.picture ?? null;
  const emailVerified = payload.email_verified === true;
  const provider = payload.firebase?.sign_in_provider ?? null;

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.firebaseUid, firebaseUid))
    .limit(1);

  if (!existing) {
    try {
      const [created] = await db
        .insert(users)
        .values({
          firebaseUid,
          email,
          emailVerified,
          phone,
          name,
          avatarUrl,
          lastSignInProvider: provider,
        })
        .returning();
      if (!created) {
        throw new HTTPException(500, { message: "user provisioning failed" });
      }
      return { user: created, created: true };
    } catch (err: unknown) {
      if (!isPgUniqueViolation(err)) throw err;
    }
  }

  const updatePatch = {
    email: email ?? existing?.email ?? null,
    emailVerified: email ? emailVerified : existing?.emailVerified ?? emailVerified,
    phone: phone ?? existing?.phone ?? null,
    lastSignInProvider: provider,
    updatedAt: sql`now()`,
    ...(existing && isPlaceholderName(existing.name) && !isPlaceholderName(name)
      ? { name }
      : {}),
    ...(existing && !existing.avatarFileId && !existing.avatarUrl && avatarUrl
      ? { avatarUrl }
      : {}),
  };

  const [updated] = await db
    .update(users)
    .set(updatePatch)
    .where(eq(users.firebaseUid, firebaseUid))
    .returning();

  if (!updated) {
    const [fallback] = await db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, firebaseUid))
      .limit(1);
    if (!fallback) {
      throw new HTTPException(500, { message: "user provisioning failed" });
    }
    return { user: fallback, created: false };
  }

  return { user: updated, created: false };
}

function isPgUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

function isPlaceholderName(name: string): boolean {
  return name.trim().length === 0 || name === "User";
}

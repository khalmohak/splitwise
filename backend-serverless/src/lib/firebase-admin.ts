import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cert,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { env } from "./env.js";

// Lazy singleton. Firebase Admin is ~50MB+ of transitive deps; we don't
// want it loaded on cold start for the hot verification path. Routes that
// need user management (custom claims, revocation, password reset links,
// etc.) call adminAuth() and pay the cost only when used.
let _app: App | undefined;

async function loadServiceAccount(): Promise<ServiceAccount> {
  if (env.FIREBASE_SERVICE_ACCOUNT_B64) {
    const json = Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_B64, "base64").toString("utf8");
    return JSON.parse(json) as ServiceAccount;
  }
  // `||` (not `??`) so an empty-string override in .env still falls back to
  // the default path. zod's .optional() lets through "" as well as undefined.
  const path =
    env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    join(process.cwd(), "firebase-service-account-key.json");
  const buf = await readFile(path, "utf8");
  return JSON.parse(buf) as ServiceAccount;
}

async function getApp(): Promise<App> {
  if (_app) return _app;
  const existing = getApps()[0];
  if (existing) {
    _app = existing;
    return _app;
  }
  const credential = cert(await loadServiceAccount());
  _app = initializeApp({ credential, projectId: env.FIREBASE_PROJECT_ID });
  return _app;
}

export async function adminAuth(): Promise<Auth> {
  return getAuth(await getApp());
}

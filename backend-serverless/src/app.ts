import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { respondError } from "./lib/errors.js";
import { env } from "./lib/env.js";
import { health } from "./routes/health.js";
import { auth } from "./routes/auth.js";
import { onboarding } from "./routes/onboarding.js";
import { users } from "./routes/users.js";
import { groups } from "./routes/groups.js";
import { invites } from "./routes/invites.js";
import { categories } from "./routes/categories.js";
import { files } from "./routes/files.js";
import { newsletter } from "./routes/newsletter.js";
import { presignDownload, presignGet } from "./lib/s3.js";

export const app = new Hono();

app.use("*", logger());

// Explicit allow-list. Must stay in sync with serverless.yml's
// httpApi.cors.allowedOrigins — API Gateway handles preflights before they
// reach the Lambda, so a mismatch silently breaks the browser.
const EXACT_ALLOWED_ORIGINS = new Set([
  "https://talo.club",
  "https://www.talo.club",
  "https://app.talo.club",
  "https://dev.app.talo.club",
]);

const LOCAL_DEV_ORIGIN =
  /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

const PRIVATE_DEV_ORIGIN =
  /^https?:\/\/(?:(?:10|100)\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d{1,5})?$/;

function isAllowedOrigin(origin: string): boolean {
  if (EXACT_ALLOWED_ORIGINS.has(origin)) return true;
  if (LOCAL_DEV_ORIGIN.test(origin)) return true;
  return env.STAGE !== "prod" && PRIVATE_DEV_ORIGIN.test(origin);
}

app.use(
  "*",
  cors({
    origin: (origin) => {
      // Non-browser callers (curl, native apps) don't send Origin; let them through.
      if (!origin) return origin;
      return isAllowedOrigin(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 86400,
  }),
);

// /health stays unprefixed for load balancer / API Gateway health checks.
app.route("/health", health);

// Everything else under /api to match the Express reference's API.md.
const api = new Hono();
api.get("/uploads/*", async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/api\/uploads\//, ""));
  if (!key || key === c.req.path) {
    return c.json({ error: "Resource not found", code: "NOT_FOUND" }, 404);
  }
  if (key.toLowerCase().endsWith(".pdf")) {
    const filename = key.split("/").pop() || "download.pdf";
    return c.redirect(await presignDownload(key, filename, "application/pdf", 300), 302);
  }
  return c.redirect(await presignGet(key, 300), 302);
});
api.route("/auth", auth);
api.route("/onboarding", onboarding);
api.route("/users", users);
api.route("/groups", groups);
api.route("/invites", invites);
api.route("/categories", categories);
api.route("/files", files);
api.route("/newsletter", newsletter);
app.route("/api", api);

app.notFound((c) => c.json({ error: "Resource not found", code: "NOT_FOUND" }, 404));
app.onError((err, c) => respondError(c, err));

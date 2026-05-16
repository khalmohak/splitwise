import { z } from "zod";

const optionalUrlEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed === "undefined" ||
    trimmed === "null" ||
    trimmed === "[object Object]"
  ) {
    return undefined;
  }
  return trimmed;
}, z.string().url().optional());

const schema = z.object({
  STAGE: z.string().default("dev"),
  DATABASE_URL: z.string().url(),
  S3_BUCKET: z.string().min(1),
  AWS_REGION: z.string().default("ap-south-1"),

  // Async notifications and Resend email transport.
  ASYNC_JOBS_QUEUE_URL: optionalUrlEnv,
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().default("noreply@talk.talo.club"),

  // Firebase Auth
  FIREBASE_PROJECT_ID: z.string().min(1),
  // Base64-encoded service account JSON. Preferred for Lambda (load from
  // Secrets Manager / SSM). Falls back to a local file when omitted in dev.
  FIREBASE_SERVICE_ACCOUNT_B64: z.string().optional(),
  // Path to service account JSON for local dev only.
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),

  // OpenAI is optional. When absent, /expenses/suggest and /files/parse-receipt
  // gracefully degrade.
  OPENAI_API_KEY: z.string().optional(),

  // Frontend base URL used in invite links (matches APP_BASE_URL in the
  // Express reference).
  APP_BASE_URL: z.string().url().default("http://localhost:5173"),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;

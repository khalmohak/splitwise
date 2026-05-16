import { Resend } from "resend";
import { env } from "../env.js";
import type { EmailTemplate } from "./templates.js";

export type SendEmailInput = EmailTemplate & {
  to: string | string[];
  idempotencyKey?: string;
};

let _client: Resend | undefined;

function resendClient(): Resend {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  if (!_client) {
    _client = new Resend(env.RESEND_API_KEY);
  }
  return _client;
}

export function isEmailEnabled(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (!env.RESEND_API_KEY) {
    const message = `skipped "${input.subject}" because RESEND_API_KEY is not configured`;
    if (env.STAGE === "prod") {
      throw new Error(message);
    }
    if (process.env.NOTIFY_DEBUG === "1") {
      console.log(`[email] ${message}`);
    }
    return;
  }

  const toAddresses = Array.isArray(input.to) ? input.to : [input.to];
  if (toAddresses.length === 0) return;

  const response = await resendClient().emails.send(
    {
      from: env.RESEND_FROM_EMAIL,
      to: toAddresses,
      subject: input.subject,
      html: input.html,
      text: input.text,
    },
    input.idempotencyKey
      ? { idempotencyKey: input.idempotencyKey }
      : undefined,
  );

  if (response.error) {
    throw new Error(
      `[${response.error.name}] ${response.error.message}${
        response.error.statusCode ? ` (status ${response.error.statusCode})` : ""
      }`,
    );
  }
}

export function sendEmailSafely(input: SendEmailInput): Promise<void> {
  return sendEmail(input).catch((error: unknown) => {
    console.error("[email] unexpected send failure", {
      subject: input.subject,
      to: input.to,
      error: error instanceof Error ? error.message : error,
    });
  });
}

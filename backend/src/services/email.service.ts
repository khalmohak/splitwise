import { Resend } from "resend";

import { env } from "../config/env";
import type { EmailTemplate } from "./email-templates";

type SendEmailInput = EmailTemplate & {
  to: string | string[];
};

const resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;

export const isEmailEnabled = (): boolean =>
  Boolean(resend && env.resendFromEmail);

export const sendEmail = async (input: SendEmailInput): Promise<void> => {
  if (!isEmailEnabled()) {
    if (env.nodeEnv === "development") {
      console.log(
        `Email skipped. Configure RESEND_API_KEY and RESEND_FROM_EMAIL to send "${input.subject}".`,
      );
    }
    return;
  }

  const { error } = await resend!.emails.send({
    from: env.resendFromEmail,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });

  if (error) {
    console.error("Failed to send email.", error);
  }
};

export const sendEmailSafely = (input: SendEmailInput): void => {
  sendEmail(input).catch((error: unknown) => {
    console.error("Unexpected email error.", error);
  });
};

import {
  emailVerificationEmail,
  groupInviteEmail,
  passwordResetEmail,
} from "./email/templates.js";
import { sendEmail } from "./email/transport.js";
import { deliverNotification } from "./notify.js";
import type { AsyncJob } from "./async-jobs.js";

export async function deliverAsyncJob(job: AsyncJob): Promise<void> {
  switch (job.type) {
    case "notify":
      await deliverNotification(job.event, job.jobId);
      return;
    case "email_verification":
      await sendEmail({
        to: job.to,
        idempotencyKey: job.jobId,
        ...emailVerificationEmail({
          name: job.name,
          verifyUrl: job.verifyUrl,
        }),
      });
      return;
    case "password_reset":
      await sendEmail({
        to: job.to,
        idempotencyKey: job.jobId,
        ...passwordResetEmail({
          name: job.name,
          resetUrl: job.resetUrl,
        }),
      });
      return;
    case "group_invite_email":
      await sendEmail({
        to: job.to,
        idempotencyKey: job.jobId,
        ...groupInviteEmail({
          groupName: job.groupName,
          inviterName: job.inviterName,
          inviteUrl: job.inviteUrl,
        }),
      });
      return;
  }
}

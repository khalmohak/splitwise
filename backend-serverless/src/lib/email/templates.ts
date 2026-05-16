import { emailTheme } from "./theme.js";

export type EmailTemplate = {
  subject: string;
  text: string;
  html: string;
};

type Detail = {
  label: string;
  value: string;
};

type Accent = "forest" | "coral" | "lime";

type EmailAction = {
  label: string;
  href: string;
};

type BaseTemplateInput = {
  preview: string;
  eyebrow: string;
  title: string;
  intro: string;
  details?: Detail[];
  action?: EmailAction;
  footer?: string;
  legal?: string;
  accent?: Accent;
};

const { colors, fontFamily, radius, shadow, brandName } = emailTheme;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const accentColor = (accent: Accent | undefined): string => {
  if (accent === "coral") return colors.accentCoral;
  if (accent === "lime") return colors.accentLime;
  return colors.accentForest;
};

const detailRows = (details: Detail[] = []): string =>
  details
    .map(
      (detail) => `
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid ${colors.appBorder}; color: ${colors.appMuted}; font-size: 13px; line-height: 1.4;">
            ${escapeHtml(detail.label)}
          </td>
          <td align="right" style="padding: 12px 0; border-bottom: 1px solid ${colors.appBorder}; color: ${colors.appText}; font-size: 14px; line-height: 1.4; font-weight: 700;">
            ${escapeHtml(detail.value)}
          </td>
        </tr>
      `,
    )
    .join("");

const actionBlock = (action?: EmailAction, accent?: Accent): string => {
  if (!action) return "";
  const buttonColor = colors.accentForest;
  return `
    <div style="margin-top: 22px;">
      <a
        href="${escapeHtml(action.href)}"
        style="
          display: inline-block;
          padding: 13px 18px;
          border-radius: ${radius.tile};
          background: ${buttonColor};
          color: #ffffff;
          font-size: 14px;
          line-height: 1;
          font-weight: 700;
          text-decoration: none;
        "
      >
        ${escapeHtml(action.label)}
      </a>
      <p style="margin: 12px 0 0; color: ${colors.appMuted}; font-size: 12px; line-height: 1.6;">
        If the button does not work, open this link:<br />
        <a href="${escapeHtml(action.href)}" style="color: ${colors.accentForest}; text-decoration: underline; word-break: break-all;">
          ${escapeHtml(action.href)}
        </a>
      </p>
    </div>
  `;
};

function layoutEmail(input: BaseTemplateInput): string {
  const accent = accentColor(input.accent);

  return `
    <!doctype html>
    <html lang="en">
      <body style="margin: 0; padding: 0; background: ${colors.appBg}; font-family: ${fontFamily}; color: ${colors.appText};">
        <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">
          ${escapeHtml(input.preview)}
        </div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: ${colors.appBg}; padding: 28px 14px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px;">
                <tr>
                  <td style="padding: 0 0 18px 0;">
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding-right: 10px;">
                          <div style="width: 36px; height: 36px; border-radius: 12px; background: ${colors.appText}; color: ${colors.appBgWarm}; font-size: 22px; line-height: 36px; font-weight: 800; text-align: center;">
                            t
                          </div>
                        </td>
                        <td style="color: ${colors.appText}; font-size: 22px; line-height: 1; font-weight: 800; text-transform: lowercase;">
                          ${brandName}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="background: ${colors.surfaceBase}; border: 1px solid ${colors.appBorder}; border-radius: ${radius.card}; box-shadow: ${shadow.soft}; overflow: hidden;">
                    <div style="height: 5px; background: ${accent};"></div>
                    <div style="padding: 26px 26px;">
                      <div style="display: inline-block; padding: 6px 10px; border-radius: ${radius.pill}; background: ${colors.surfaceSoft}; color: ${colors.accentForest}; font-size: 11px; line-height: 1; font-weight: 700; text-transform: uppercase;">
                        ${escapeHtml(input.eyebrow)}
                      </div>
                      <h1 style="margin: 16px 0 10px; color: ${colors.appText}; font-size: 24px; line-height: 1.2; font-weight: 800;">
                        ${escapeHtml(input.title)}
                      </h1>
                      <p style="margin: 0; color: ${colors.appMuted}; font-size: 15px; line-height: 1.65;">
                        ${escapeHtml(input.intro)}
                      </p>
                      ${
                        input.details?.length
                          ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top: 22px; border-collapse: collapse;">${detailRows(input.details)}</table>`
                          : ""
                      }
                      ${actionBlock(input.action, input.accent)}
                      <div style="margin-top: 22px; padding: 14px 16px; background: ${colors.appBgWarm}; border: 1px solid ${colors.appBorder}; border-radius: ${radius.tile}; color: ${colors.appMuted}; font-size: 13px; line-height: 1.6;">
                        ${escapeHtml(input.footer ?? "Open the app to see the latest details.")}
                      </div>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 4px 0; color: ${colors.appMuted}; font-size: 12px; line-height: 1.6;">
                    ${escapeHtml(input.legal ?? `You are receiving this email because someone used ${brandName}.`)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

function layoutNewsletterEmail(): string {
  const preview = "A monthly product note from talo: useful, quiet, and built from real flats.";
  const insightRows: Detail[] = [
    {
      label: "What we wrote",
      value: "Plain-English notes on rent, groceries, HRA, and shared-home money.",
    },
    {
      label: "What we shipped",
      value: "A short product changelog with the thinking behind the details.",
    },
    {
      label: "What flats taught us",
      value: "Patterns from real homes: quiet rules, late rent, UPI habits, fridge politics.",
    },
  ];

  return `
    <!doctype html>
    <html lang="en">
      <body style="margin: 0; padding: 0; background: ${colors.appBg}; font-family: ${fontFamily}; color: ${colors.appText};">
        <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">
          ${escapeHtml(preview)}
        </div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: ${colors.appBg}; padding: 34px 14px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 640px;">
                <tr>
                  <td style="padding: 0 0 18px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td>
                          <div style="color: ${colors.appText}; font-size: 24px; line-height: 1; font-weight: 800; letter-spacing: 0; text-transform: lowercase;">
                            ${brandName}
                          </div>
                        </td>
                        <td align="right" style="color: ${colors.appMuted}; font-size: 12px; line-height: 1.4;">
                          The quiet newsletter
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="background: ${colors.appText}; border-radius: 22px; overflow: hidden; box-shadow: ${shadow.soft};">
                    <div style="padding: 34px 34px 30px; background: ${colors.appText}; color: ${colors.appBgWarm};">
                      <div style="display: inline-block; padding: 7px 11px; border-radius: ${radius.pill}; background: rgba(111, 221, 113, 0.14); color: ${colors.accentLime}; font-size: 11px; line-height: 1; font-weight: 800; text-transform: uppercase;">
                        You are in
                      </div>
                      <h1 style="margin: 22px 0 0; color: ${colors.appBgWarm}; font-size: 38px; line-height: 1.04; font-weight: 800; letter-spacing: 0;">
                        One quiet email, once a month.
                      </h1>
                      <p style="margin: 18px 0 0; max-width: 500px; color: rgba(255, 253, 248, 0.78); font-size: 16px; line-height: 1.72;">
                        This is not a launch blast. It is a monthly field note from the product: what we noticed while building for shared homes, what changed inside ${brandName}, and what real flats keep teaching us about money.
                      </p>
                    </div>
                    <div style="height: 6px; background: linear-gradient(90deg, ${colors.accentLime}, ${colors.accentCoral}, ${colors.accentForest});"></div>
                    <div style="padding: 28px 34px 34px; background: ${colors.surfaceBase};">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                        ${insightRows
                          .map(
                            (row) => `
                              <tr>
                                <td style="padding: 18px 0; border-bottom: 1px solid ${colors.appBorder}; vertical-align: top;">
                                  <div style="color: ${colors.accentForest}; font-size: 12px; line-height: 1.2; font-weight: 800; text-transform: uppercase;">
                                    ${escapeHtml(row.label)}
                                  </div>
                                  <div style="margin-top: 7px; color: ${colors.appText}; font-size: 15px; line-height: 1.65;">
                                    ${escapeHtml(row.value)}
                                  </div>
                                </td>
                              </tr>
                            `,
                          )
                          .join("")}
                      </table>
                      <div style="margin-top: 26px; padding: 20px 22px; border-radius: ${radius.card}; background: ${colors.appBgWarm}; border: 1px solid ${colors.appBorder};">
                        <div style="color: ${colors.appText}; font-size: 18px; line-height: 1.25; font-weight: 800;">
                          The promise
                        </div>
                        <p style="margin: 9px 0 0; color: ${colors.appMuted}; font-size: 14px; line-height: 1.75;">
                          No discount codes. No pretend urgency. No weekly noise. If it lands in your inbox, it should make the product feel more thoughtful or your flat a little easier to run.
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 18px 4px 0; color: ${colors.appMuted}; font-size: 12px; line-height: 1.6;">
                    You are receiving this because you subscribed to ${brandName} notes. You can reply to any issue; a human reads it.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

export const welcomeEmail = (input: { name: string; dashboardUrl: string }): EmailTemplate => ({
  subject: `Welcome to ${brandName}`,
  text: `Hi ${input.name}, your ${brandName} account is ready. Open your rooms here: ${input.dashboardUrl}`,
  html: layoutEmail({
    preview: `Your ${brandName} account is ready.`,
    eyebrow: "Account ready",
    title: `Welcome, ${input.name}`,
    intro: "Your account is ready. Start a household, invite your people, and keep shared bills in one place.",
    action: { label: "Open your rooms", href: input.dashboardUrl },
    footer: "If you signed up with a shared invite, that room will be waiting for you after you log in.",
    legal: `You are receiving this email because a new ${brandName} account was created with your email address.`,
    accent: "forest",
  }),
});

export const emailVerificationEmail = (input: {
  name: string;
  verifyUrl: string;
}): EmailTemplate => ({
  subject: `Verify your ${brandName} email`,
  text: `Hi ${input.name}, verify your email for ${brandName}: ${input.verifyUrl}`,
  html: layoutEmail({
    preview: `Verify your email for ${brandName}.`,
    eyebrow: "Verify email",
    title: "Confirm your email",
    intro: `Hi ${input.name}, click below to confirm this email address for your ${brandName} account.`,
    action: { label: "Verify email", href: input.verifyUrl },
    footer: "If you did not request this, you can ignore this email.",
    legal: `You are receiving this email because someone requested email verification for ${brandName}.`,
    accent: "forest",
  }),
});

export const newsletterSubscriptionEmail = (): EmailTemplate => ({
  subject: "The quiet list: you're in",
  text:
    "You're subscribed to talo notes. One quiet email, once a month: what we wrote, what we shipped, and what real flats taught us. No discount codes, no pretend urgency.",
  html: layoutNewsletterEmail(),
});

export const passwordResetEmail = (input: {
  name: string;
  resetUrl: string;
}): EmailTemplate => ({
  subject: `Reset your ${brandName} password`,
  text: `Hi ${input.name}, use this link to reset your ${brandName} password: ${input.resetUrl}`,
  html: layoutEmail({
    preview: `Reset your ${brandName} password.`,
    eyebrow: "Password reset",
    title: "Reset your password",
    intro: `Hi ${input.name}, we received a request to reset your password. This link expires based on your Firebase auth policy.`,
    action: { label: "Reset password", href: input.resetUrl },
    footer: "If you did not request a reset, you can ignore this email.",
    legal: `You are receiving this email because someone requested a password reset for ${brandName}.`,
    accent: "coral",
  }),
});

export const groupInviteEmail = (input: {
  groupName: string;
  inviterName: string;
  inviteUrl: string;
}): EmailTemplate => ({
  subject: `${input.inviterName} invited you to ${input.groupName}`,
  text: `${input.inviterName} invited you to join "${input.groupName}" on ${brandName}. Open the invite here: ${input.inviteUrl}`,
  html: layoutEmail({
    preview: `${input.inviterName} invited you to join ${input.groupName}.`,
    eyebrow: "Room invite",
    title: `Join ${input.groupName}`,
    intro: `${input.inviterName} invited you into this room on ${brandName}. Open the invite and sign in to join.`,
    details: [
      { label: "Room", value: input.groupName },
      { label: "Invited by", value: input.inviterName },
    ],
    action: { label: "Open invite", href: input.inviteUrl },
    footer: "If you do not have an account yet, create one with this same email and then open the invite link again.",
    legal: `You are receiving this email because ${input.inviterName} sent you a ${brandName} invite.`,
    accent: "forest",
  }),
});

export const groupCreatedEmail = (input: {
  name: string;
  groupName: string;
  groupUrl: string;
}): EmailTemplate => ({
  subject: `Room created: ${input.groupName}`,
  text: `Hi ${input.name}, your room "${input.groupName}" is ready in ${brandName}. Open it here: ${input.groupUrl}`,
  html: layoutEmail({
    preview: `Your room "${input.groupName}" is ready.`,
    eyebrow: "New room",
    title: input.groupName,
    intro: `Hi ${input.name}, your room is set up and you are the admin. Invite your people when you are ready.`,
    details: [{ label: "Room", value: input.groupName }],
    action: { label: "Open room", href: input.groupUrl },
    accent: "lime",
  }),
});

export const addedToGroupEmail = (input: {
  name: string;
  groupName: string;
  role: string;
  groupUrl: string;
  invitedByName?: string | null;
}): EmailTemplate => ({
  subject: `You were added to ${input.groupName}`,
  text: `Hi ${input.name}, you were added to "${input.groupName}" as ${input.role}${input.invitedByName ? ` by ${input.invitedByName}` : ""}. Open it here: ${input.groupUrl}`,
  html: layoutEmail({
    preview: `You were added to ${input.groupName}.`,
    eyebrow: "Added to room",
    title: `You are in ${input.groupName}`,
    intro: `Hi ${input.name}, you were added to this room${input.invitedByName ? ` by ${input.invitedByName}` : ""}. You can now check balances and add expenses.`,
    details: [
      { label: "Room", value: input.groupName },
      { label: "Role", value: input.role },
      ...(input.invitedByName ? [{ label: "Added by", value: input.invitedByName }] : []),
    ],
    action: { label: "Open room", href: input.groupUrl },
    accent: "forest",
  }),
});

export const memberRemovedEmail = (input: {
  recipientName: string;
  groupName: string;
  removedByName?: string | null;
  groupsUrl: string;
}): EmailTemplate => ({
  subject: `You were removed from ${input.groupName}`,
  text: `Hi ${input.recipientName}, you were removed from "${input.groupName}"${input.removedByName ? ` by ${input.removedByName}` : ""}.`,
  html: layoutEmail({
    preview: `You were removed from ${input.groupName}.`,
    eyebrow: "Removed from room",
    title: `Removed from ${input.groupName}`,
    intro: `Hi ${input.recipientName}, you no longer have access to this room${input.removedByName ? ` because ${input.removedByName} removed you` : ""}.`,
    details: [
      { label: "Room", value: input.groupName },
      ...(input.removedByName ? [{ label: "Removed by", value: input.removedByName }] : []),
    ],
    action: { label: "Open your rooms", href: input.groupsUrl },
    accent: "coral",
  }),
});

export const expenseCreatedEmail = (input: {
  recipientName: string;
  groupName: string;
  description: string;
  amount: string;
  paidByName: string;
  createdByName: string;
  date: string;
  yourShare: string;
  expenseUrl: string;
}): EmailTemplate => ({
  subject: `New expense in ${input.groupName}: ${input.description}`,
  text: `Hi ${input.recipientName}, ${input.createdByName} added "${input.description}" in ${input.groupName}. Total: ${input.amount}. Your share: ${input.yourShare}. Open it here: ${input.expenseUrl}`,
  html: layoutEmail({
    preview: `${input.createdByName} added ${input.description}.`,
    eyebrow: "New expense",
    title: input.description,
    intro: `Hi ${input.recipientName}, ${input.createdByName} added a new expense in ${input.groupName}.`,
    details: [
      { label: "Total amount", value: input.amount },
      { label: "Your share", value: input.yourShare },
      { label: "Paid by", value: input.paidByName },
      { label: "Added by", value: input.createdByName },
      { label: "Date", value: input.date },
    ],
    action: { label: "View expense", href: input.expenseUrl },
    footer: "Open the app to review the split and your latest balances.",
    accent: "forest",
  }),
});

export const expenseUpdatedEmail = (input: {
  recipientName: string;
  groupName: string;
  description: string;
  amount: string;
  paidByName: string;
  updatedByName: string;
  date: string;
  yourShare: string;
  expenseUrl: string;
}): EmailTemplate => ({
  subject: `Expense updated in ${input.groupName}: ${input.description}`,
  text: `Hi ${input.recipientName}, ${input.updatedByName} updated "${input.description}" in ${input.groupName}. Total: ${input.amount}. Your share: ${input.yourShare}. Open it here: ${input.expenseUrl}`,
  html: layoutEmail({
    preview: `${input.updatedByName} updated ${input.description}.`,
    eyebrow: "Expense updated",
    title: input.description,
    intro: `Hi ${input.recipientName}, ${input.updatedByName} updated an expense in ${input.groupName}.`,
    details: [
      { label: "Total amount", value: input.amount },
      { label: "Your share", value: input.yourShare },
      { label: "Paid by", value: input.paidByName },
      { label: "Updated by", value: input.updatedByName },
      { label: "Date", value: input.date },
    ],
    action: { label: "Review changes", href: input.expenseUrl },
    footer: "Open the app to see the full split and updated balances.",
    accent: "forest",
  }),
});

export const expenseDeletedEmail = (input: {
  recipientName: string;
  groupName: string;
  description: string;
  amount: string;
  paidByName: string;
  deletedByName: string;
  groupUrl: string;
}): EmailTemplate => ({
  subject: `Expense removed in ${input.groupName}: ${input.description}`,
  text: `Hi ${input.recipientName}, ${input.deletedByName} removed "${input.description}" (${input.amount}) from ${input.groupName}. Paid by ${input.paidByName}. Open the room here: ${input.groupUrl}`,
  html: layoutEmail({
    preview: `${input.deletedByName} removed ${input.description}.`,
    eyebrow: "Expense removed",
    title: input.description,
    intro: `Hi ${input.recipientName}, ${input.deletedByName} removed an expense from ${input.groupName}.`,
    details: [
      { label: "Amount", value: input.amount },
      { label: "Paid by", value: input.paidByName },
      { label: "Removed by", value: input.deletedByName },
    ],
    action: { label: "Open room", href: input.groupUrl },
    footer: "Your balances may have changed after this removal.",
    accent: "coral",
  }),
});

export const settlementRequestEmail = (input: {
  recipientName: string;
  groupName: string;
  payerName: string;
  amount: string;
  date: string;
  notes: string | null;
  settlementUrl: string;
}): EmailTemplate => ({
  subject: `${input.payerName} says they paid you ${input.amount}`,
  text: `Hi ${input.recipientName}, ${input.payerName} recorded a payment of ${input.amount} to you in ${input.groupName}. Confirm or dispute it here: ${input.settlementUrl}`,
  html: layoutEmail({
    preview: `${input.payerName} recorded a payment of ${input.amount}.`,
    eyebrow: "Payment request",
    title: `${input.payerName} paid you ${input.amount}`,
    intro: `Hi ${input.recipientName}, ${input.payerName} recorded a payment in ${input.groupName}. Confirm it if it looks right or dispute it if not.`,
    details: [
      { label: "Room", value: input.groupName },
      { label: "Amount", value: input.amount },
      { label: "Paid by", value: input.payerName },
      { label: "Date", value: input.date },
      ...(input.notes ? [{ label: "Notes", value: input.notes }] : []),
    ],
    action: { label: "Review payment", href: input.settlementUrl },
    footer: "Until you confirm it, this payment does not change the balance.",
    accent: "lime",
  }),
});

export const settlementConfirmedEmail = (input: {
  recipientName: string;
  groupName: string;
  confirmedByName: string;
  amount: string;
  settlementUrl: string;
}): EmailTemplate => ({
  subject: `Your payment of ${input.amount} was confirmed`,
  text: `Hi ${input.recipientName}, ${input.confirmedByName} confirmed your payment of ${input.amount} in ${input.groupName}. Open the room here: ${input.settlementUrl}`,
  html: layoutEmail({
    preview: `${input.confirmedByName} confirmed your payment.`,
    eyebrow: "Payment confirmed",
    title: "Payment confirmed",
    intro: `Hi ${input.recipientName}, ${input.confirmedByName} confirmed your payment of ${input.amount} in ${input.groupName}.`,
    details: [
      { label: "Room", value: input.groupName },
      { label: "Amount", value: input.amount },
      { label: "Confirmed by", value: input.confirmedByName },
    ],
    action: { label: "Open payments", href: input.settlementUrl },
    accent: "forest",
  }),
});

export const settlementDisputedEmail = (input: {
  recipientName: string;
  groupName: string;
  disputedByName: string;
  amount: string;
  notes: string | null;
  settlementUrl: string;
}): EmailTemplate => ({
  subject: `${input.disputedByName} disputed your payment of ${input.amount}`,
  text: `Hi ${input.recipientName}, ${input.disputedByName} disputed your payment of ${input.amount} in ${input.groupName}${input.notes ? `: ${input.notes}` : ""}. Review it here: ${input.settlementUrl}`,
  html: layoutEmail({
    preview: `${input.disputedByName} disputed your payment.`,
    eyebrow: "Payment disputed",
    title: "Payment disputed",
    intro: `Hi ${input.recipientName}, ${input.disputedByName} disputed your recorded payment of ${input.amount} in ${input.groupName}.`,
    details: [
      { label: "Room", value: input.groupName },
      { label: "Amount", value: input.amount },
      { label: "Disputed by", value: input.disputedByName },
      ...(input.notes ? [{ label: "Reason", value: input.notes }] : []),
    ],
    action: { label: "Review payment", href: input.settlementUrl },
    footer: "The balance stays unchanged until you resolve this and record it again if needed.",
    accent: "coral",
  }),
});

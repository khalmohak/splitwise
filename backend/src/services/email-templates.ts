export type EmailTemplate = {
  subject: string;
  text: string;
  html: string;
};

type Detail = {
  label: string;
  value: string;
};

type BaseTemplateInput = {
  preview: string;
  eyebrow: string;
  title: string;
  intro: string;
  details?: Detail[];
  footer?: string;
  accent?: "forest" | "coral" | "lime";
};

const colors = {
  appBg: "#f8f5ef",
  appBgWarm: "#fffdf8",
  appText: "#1d2a2f",
  appMuted: "#5d6b71",
  appBorder: "#d8d1c4",
  surfaceBase: "#ffffff",
  surfaceSoft: "#efe6d8",
  accentLime: "#6fdd71",
  accentForest: "#0f6d56",
  accentCoral: "#ff7b54",
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const accentColor = (accent: BaseTemplateInput["accent"]): string => {
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

const layoutEmail = (input: BaseTemplateInput): string => {
  const accent = accentColor(input.accent);

  return `
    <!doctype html>
    <html>
      <body style="margin: 0; padding: 0; background: ${colors.appBg}; font-family: 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; color: ${colors.appText};">
        <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">
          ${escapeHtml(input.preview)}
        </div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: ${colors.appBg}; padding: 32px 14px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px;">
                <tr>
                  <td style="padding: 0 0 16px 0;">
                    <div style="color: ${colors.appText}; font-size: 22px; line-height: 1; font-weight: 800;">
                      Splitwise
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="background: ${colors.surfaceBase}; border: 1px solid ${colors.appBorder}; border-radius: 24px; box-shadow: 0 18px 40px rgba(14, 34, 28, 0.08); overflow: hidden;">
                    <div style="height: 8px; background: ${accent};"></div>
                    <div style="padding: 28px;">
                      <div style="display: inline-block; padding: 7px 12px; border-radius: 999px; background: ${colors.surfaceSoft}; color: ${colors.accentForest}; font-size: 11px; line-height: 1; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;">
                        ${escapeHtml(input.eyebrow)}
                      </div>
                      <h1 style="margin: 18px 0 10px; color: ${colors.appText}; font-size: 28px; line-height: 1.08; font-weight: 800; letter-spacing: 0;">
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
                      <div style="margin-top: 24px; padding: 16px; background: ${colors.appBgWarm}; border: 1px solid ${colors.appBorder}; border-radius: 18px; color: ${colors.appMuted}; font-size: 13px; line-height: 1.55;">
                        ${escapeHtml(input.footer ?? "Open the app to review the latest details.")}
                      </div>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 2px 0; color: ${colors.appMuted}; font-size: 12px; line-height: 1.5;">
                    You are receiving this because you have a Splitwise account.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
};

export const welcomeEmail = (input: { name: string }): EmailTemplate => ({
  subject: "Welcome to Splitwise",
  text: `Hi ${input.name}, your Splitwise account is ready. You can now create groups, add expenses, and track balances.`,
  html: layoutEmail({
    preview: "Your Splitwise account is ready.",
    eyebrow: "Account ready",
    title: `Welcome, ${input.name}`,
    intro: "Your account is ready. You can now create groups, add expenses, and track balances with your people.",
    accent: "forest",
  }),
});

export const passwordChangedEmail = (input: { name: string }): EmailTemplate => ({
  subject: "Your Splitwise password was changed",
  text: `Hi ${input.name}, your Splitwise password was changed. If this was not you, reset your password immediately.`,
  html: layoutEmail({
    preview: "Your Splitwise password was changed.",
    eyebrow: "Security",
    title: "Password changed",
    intro: `Hi ${input.name}, your password was changed. If this was not you, reset your password immediately.`,
    accent: "coral",
  }),
});

export const groupCreatedEmail = (input: {
  name: string;
  groupName: string;
}): EmailTemplate => ({
  subject: `Group created: ${input.groupName}`,
  text: `Hi ${input.name}, your group "${input.groupName}" was created.`,
  html: layoutEmail({
    preview: `Your group "${input.groupName}" was created.`,
    eyebrow: "New group",
    title: input.groupName,
    intro: `Hi ${input.name}, your group was created and you are the admin.`,
    details: [{ label: "Group", value: input.groupName }],
    accent: "lime",
  }),
});

export const addedToGroupEmail = (input: {
  name: string;
  groupName: string;
  role: string;
}): EmailTemplate => ({
  subject: `You were added to ${input.groupName}`,
  text: `Hi ${input.name}, you were added to "${input.groupName}" as ${input.role}.`,
  html: layoutEmail({
    preview: `You were added to "${input.groupName}".`,
    eyebrow: "Group invite",
    title: `You're in ${input.groupName}`,
    intro: `Hi ${input.name}, you were added to this group. You can now view balances and add expenses.`,
    details: [
      { label: "Group", value: input.groupName },
      { label: "Role", value: input.role },
    ],
    accent: "forest",
  }),
});

export const expenseCreatedEmail = (input: {
  recipientName: string;
  groupName: string;
  description: string;
  amount: string;
  paidByName: string;
  date: string;
  yourShare: string;
}): EmailTemplate => ({
  subject: `New expense in ${input.groupName}: ${input.description}`,
  text: `Hi ${input.recipientName}, ${input.paidByName} added "${input.description}" in ${input.groupName}. Amount: ${input.amount}. Your share: ${input.yourShare}.`,
  html: layoutEmail({
    preview: `${input.paidByName} added ${input.description}. Your share is ${input.yourShare}.`,
    eyebrow: "New expense",
    title: input.description,
    intro: `Hi ${input.recipientName}, ${input.paidByName} added a new expense in ${input.groupName}.`,
    details: [
      { label: "Group", value: input.groupName },
      { label: "Total amount", value: input.amount },
      { label: "Your share", value: input.yourShare },
      { label: "Paid by", value: input.paidByName },
      { label: "Date", value: input.date },
    ],
    footer: "Open the app to see the full split and balances.",
    accent: "coral",
  }),
});

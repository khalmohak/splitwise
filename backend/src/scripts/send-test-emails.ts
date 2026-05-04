import "dotenv/config";

import { sendEmail } from "../services/email.service";
import {
  addedToGroupEmail,
  expenseCreatedEmail,
  groupCreatedEmail,
  passwordChangedEmail,
  welcomeEmail,
  type EmailTemplate,
} from "../services/email-templates";

const recipientEmail = process.argv[2];

const usage = (): void => {
  console.log("Usage: npm run email:test -- recipient@example.com");
};

const templates: { name: string; template: EmailTemplate }[] = [
  {
    name: "welcome",
    template: welcomeEmail({ name: "Mohak" }),
  },
  {
    name: "password-changed",
    template: passwordChangedEmail({ name: "Mohak" }),
  },
  {
    name: "group-created",
    template: groupCreatedEmail({
      name: "Mohak",
      groupName: "Flat 4B",
    }),
  },
  {
    name: "added-to-group",
    template: addedToGroupEmail({
      name: "Raj",
      groupName: "Flat 4B",
      role: "member",
    }),
  },
  {
    name: "expense-created",
    template: expenseCreatedEmail({
      recipientName: "Raj",
      groupName: "Flat 4B",
      description: "Weekly groceries",
      amount: "1200.00",
      paidByName: "Mohak",
      date: "2026-05-02",
      yourShare: "300.00",
    }),
  },
];

const run = async (): Promise<void> => {
  if (!recipientEmail) {
    usage();
    process.exit(1);
  }

  for (const { name, template } of templates) {
    await sendEmail({
      to: recipientEmail,
      ...template,
    });
    console.log(`Sent test email: ${name}`);
  }

  console.log(`Done. Sent ${templates.length} test emails to ${recipientEmail}.`);
};

run().catch((error: unknown) => {
  console.error("Failed to send test emails.", error);
  process.exit(1);
});

# Splitwise Backend

Minimal Node.js backend scaffolded with Express, TypeORM, and Postgres.

## Quick start

1. Install and start PostgreSQL locally.
2. Create a database named `splitwise` and make sure the username/password in `.env` match your local setup.
3. Install dependencies with `npm install`.
4. Run the API with `npm run dev`.

The app exposes `GET /health` and boots after the database connection initializes.

## Email

Email sending uses Resend. Configure these in `.env`:

```env
RESEND_API_KEY=re_xxxxxxxxx
RESEND_FROM_EMAIL="Splitwise <noreply@your-domain.com>"
```

If either value is missing, emails are skipped in development instead of failing API requests.

Email implementation lives here:

- `src/services/email.service.ts` — Resend client and safe send wrapper.
- `src/services/email-templates.ts` — reusable branded templates using the app color system.
- Service-layer hooks — add future emails where the business event happens, not in route files.

Currently sent:

- Account welcome email after registration.
- Password changed security notification.
- Group created confirmation.
- Member added to group notification.
- Expense created notification to participants.

Send one sample of every current email template to a test inbox:

```bash
npm run email:test -- you@example.com
```

Useful future hooks:

- Settlement recorded notification to payer and receiver.
- Recurring expense due reminder.
- Weekly/monthly balance summary.

## Seed data

Seed system-wide default categories:

```bash
npm run seed:constants
```

Seed a larger demo dataset for app testing:

```bash
npm run seed:test
```

The demo seed creates 4 users, 3 groups, memberships, custom categories, tags, 100+ expenses, multiple split types, recurring expenses, and settlements. It resets only the named demo groups before reseeding, so it can be rerun without duplicating demo expenses.

All demo accounts use the password:

```txt
Password123
```

Demo account emails:

```txt
mohak.demo@example.com
raj.demo@example.com
priya.demo@example.com
ananya.demo@example.com
```

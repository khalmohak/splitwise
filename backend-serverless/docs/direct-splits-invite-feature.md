# Direct Splits Invite Feature

## Goal

Allow a user to invite one individual person and start splitting expenses with them without creating a visible household/group. The invited person may be fully onboarded, pending, or not signed up yet.

This feature should support:

- one-to-one split ledgers
- invites by email, phone, or link
- expense logging before the invitee joins
- greyed-out inactive/pending participants in the UI
- balances for unclaimed participants
- future recurring expenses and trip mode using the same participant model

## Current Backend Constraint

The current backend is user-centric:

- `expenses.group_id` is required.
- `expenses.paid_by` must reference `users.id`.
- `expense_participants.user_id` must reference `users.id`.
- `settlements.paid_by` and `settlements.paid_to` must reference `users.id`.
- `group_invites` already exists, but it is tied to `group_id`.

This means the current schema cannot cleanly represent:

> Rahul has not signed up yet, but Mohak wants to split dinner with Rahul and track that Rahul owes him money.

Do not create fake rows in `users`. `users.firebase_uid` is tied to auth provisioning, so fake users would pollute identity state.

## Core Product Model

Use the existing `groups` table as the ledger container. A direct split should be stored as a hidden personal group:

```txt
groups.type = "personal"
groups.name = "Mohak <> Rahul"
```

Then add a participant abstraction that supports both real users and placeholders.

## Schema Changes

### `group_participants`

```ts
group_participants {
  id uuid pk
  group_id uuid not null references groups(id)
  user_id uuid null references users(id)

  display_name varchar not null
  email varchar null
  phone varchar null

  status enum:
    "active"        // real onboarded participant
    "invited"       // invite sent, not accepted
    "placeholder"   // manually added, no invite sent yet
    "declined"
    "removed"
    "blocked"

  invited_by_id uuid null references users(id)
  accepted_at timestamp null

  created_at timestamp
  updated_at timestamp
}
```

For a direct split:

```txt
group: Mohak <> Rahul, type personal

participants:
- Mohak: user_id present, status active
- Rahul: user_id null, email/phone/name present, status invited
```

The UI can grey out Rahul when `user_id = null` or `status in ("invited", "placeholder")`.

### `direct_splits`

```ts
direct_splits {
  id uuid pk
  group_id uuid not null unique references groups(id)
  created_by_id uuid not null references users(id)

  creator_participant_id uuid not null references group_participants(id)
  counterparty_participant_id uuid not null references group_participants(id)

  status enum:
    "pending"
    "active"
    "declined"
    "archived"
    "blocked"

  created_at timestamp
  updated_at timestamp
}
```

This keeps direct split behavior separate from household behavior while still reusing expenses, balances, settlements, categories, and notifications.

### Expense Changes

Long term, expenses should point to participants, not only users.

Current:

```ts
expenses.paid_by -> users.id
expense_participants.user_id -> users.id
```

Target:

```ts
expenses {
  ...
  paid_by_participant_id uuid not null references group_participants(id)

  // temporary backward compatibility
  paid_by uuid null references users(id)
}
```

```ts
expense_participants {
  id uuid pk
  expense_id uuid not null references expenses(id)
  participant_id uuid not null references group_participants(id)

  // temporary backward compatibility
  user_id uuid null references users(id)

  share_amount numeric not null
  split_input numeric null
}
```

For active users, write both `participant_id` and `user_id`.

For placeholders, write:

```txt
participant_id = Rahul placeholder participant id
user_id = null
```

This supports:

```txt
Mohak paid ₹1,000
Split with Mohak + Rahul
Rahul is not onboarded
Rahul owes Mohak ₹500, shown as unclaimed/greyed out
```

### Settlement Changes

Settlements need the same participant abstraction.

```ts
settlements {
  ...
  paid_by_participant_id uuid not null references group_participants(id)
  paid_to_participant_id uuid not null references group_participants(id)

  // temporary backward compatibility
  paid_by uuid null references users(id)
  paid_to uuid null references users(id)

  status:
    "recorded"   // useful for offline / placeholder settlement
    "pending"
    "confirmed"
    "disputed"
}
```

For inactive participants, use `recorded` instead of `confirmed`, because the other person has not verified it.

### Invite Changes

Reuse the existing `group_invites` table because direct splits still have a backing `group_id`.

Add:

```ts
group_invites {
  ...
  target_participant_id uuid null references group_participants(id)
  context enum default "group":
    "group"
    "direct_split"
    "trip"
}
```

For an individual invite:

```txt
group_id = hidden personal group
context = direct_split
target_participant_id = Rahul placeholder participant
email/phone/intended_name = Rahul info
status = pending
```

On accept:

1. Auth creates or loads the real `users` row.
2. Invite token is validated.
3. Placeholder participant gets `user_id = actor.id`.
4. Participant status becomes `active`.
5. Add row to `group_members` so existing auth checks still work.
6. Mark invite `accepted`.

Important: even if the invitee signs up with a matching email or phone, require explicit accept before attaching historical expenses to their account.

## Recurring Expenses

The current `expenses.is_recurring` fields are not enough for durable recurrence. Add recurrence templates later.

```ts
recurring_expense_templates {
  id uuid pk
  group_id uuid not null references groups(id)

  title varchar not null
  amount numeric not null
  currency varchar default "INR"

  cadence enum: "weekly" | "monthly" | "yearly"
  start_date date not null
  next_run_date date not null

  paid_by_participant_id uuid not null references group_participants(id)

  split_type enum
  status enum: "active" | "paused" | "ended"

  created_by_id uuid not null references users(id)
  created_at timestamp
  updated_at timestamp
}
```

```ts
recurring_expense_template_participants {
  template_id uuid references recurring_expense_templates(id)
  participant_id uuid references group_participants(id)
  share_amount numeric null
  split_input numeric null
}
```

Generated expenses should use participant IDs. If the invited person is still not onboarded, recurrence still runs and their share remains unclaimed.

## API Design

Use top-level direct split APIs instead of exposing the feature as normal group APIs.

```txt
POST /api/direct-splits
GET  /api/direct-splits
GET  /api/direct-splits/:directSplitId
PATCH /api/direct-splits/:directSplitId
POST /api/direct-splits/:directSplitId/archive
```

Create request:

```json
{
  "person": {
    "name": "Rahul",
    "email": "rahul@example.com",
    "phone": null
  },
  "invite": {
    "send": true,
    "expiresInDays": 14
  }
}
```

Create response:

```json
{
  "directSplit": {
    "id": "uuid",
    "groupId": "uuid",
    "status": "pending",
    "person": {
      "participantId": "uuid",
      "userId": null,
      "name": "Rahul",
      "status": "invited",
      "isOnboarded": false
    }
  },
  "invite": {
    "id": "uuid",
    "status": "pending",
    "expiresAt": "..."
  }
}
```

### Direct Split Expenses

```txt
POST   /api/direct-splits/:id/expenses/preview
POST   /api/direct-splits/:id/expenses
GET    /api/direct-splits/:id/expenses
GET    /api/direct-splits/:id/expenses/:expenseId
PUT    /api/direct-splits/:id/expenses/:expenseId
DELETE /api/direct-splits/:id/expenses/:expenseId
```

Expense create request:

```json
{
  "description": "Dinner",
  "amount": "1000.00",
  "paidByParticipantId": "mohak-participant-id",
  "splitType": "equal",
  "participants": [
    { "participantId": "mohak-participant-id" },
    { "participantId": "rahul-placeholder-participant-id" }
  ],
  "date": "2026-05-16"
}
```

### Direct Split Balances

```txt
GET /api/direct-splits/:id/balances
```

Response:

```json
{
  "net": {
    "amount": "500.00",
    "direction": "you_are_owed"
  },
  "counterparty": {
    "participantId": "uuid",
    "userId": null,
    "name": "Rahul",
    "status": "invited",
    "isOnboarded": false
  },
  "balanceState": "unclaimed"
}
```

### Direct Split Settlements

```txt
GET   /api/direct-splits/:id/settlements
POST  /api/direct-splits/:id/settlements
PATCH /api/direct-splits/:id/settlements/:settlementId/confirm
PATCH /api/direct-splits/:id/settlements/:settlementId/dispute
```

### Direct Split Recurring Expenses

```txt
GET  /api/direct-splits/:id/recurring-expenses
POST /api/direct-splits/:id/recurring-expenses
PATCH /api/direct-splits/:id/recurring-expenses/:templateId
POST /api/direct-splits/:id/recurring-expenses/:templateId/pause
POST /api/direct-splits/:id/recurring-expenses/:templateId/run-now
```

### Invite Preview And Accept

Extend the current invite endpoints:

```txt
POST /api/invites/:token/preview
POST /api/invites/:token/accept
```

Preview should return the invite context:

```json
{
  "context": "direct_split",
  "invite": {},
  "directSplit": {
    "id": "uuid",
    "invitedBy": {
      "id": "uuid",
      "name": "Mohak"
    },
    "existingExpenseCount": 4,
    "currentBalance": "500.00"
  }
}
```

## Balance Engine Changes

Add participant-based balance functions:

```ts
computeParticipantNetCents(groupId)
computeParticipantPairwiseCents(groupId)
```

Do not replace the existing `computeUserNetCents` immediately. Keep it for current household APIs. Direct splits and future trip mode should use participant balances.

## Product Rules

- A user can log expenses with invited or placeholder people.
- Placeholder balances count in calculations but are marked `unclaimed`.
- Invitee must accept before historical expenses attach to their real account.
- On accept, show a consent screen: "Mohak added you to 4 expenses. Current balance: you owe ₹500."
- Revoking an invite should not delete the ledger. It should mark the participant as `placeholder` or `removed`.
- Declining should not erase the creator's records. It should mark the participant as `declined`.
- Avoid revealing whether an email or phone already has an account.
- Prevent duplicate direct splits for the same creator and email/phone.
- Prevent duplicate direct splits for the same accepted user pair.

## Suggested Implementation Order

1. Add `group_participants`.
2. Add `direct_splits`.
3. Add participant columns to expenses and expense participants.
4. Add participant-based balance functions.
5. Add `POST /api/direct-splits`.
6. Add direct expense create/list APIs.
7. Extend invite preview/accept for `context = direct_split`.
8. Add recurring templates after the basic direct split flow works.

## Why This Helps Trip Mode Later

Trip mode can reuse the same foundation:

- a trip is also a ledger-backed group
- trip participants can be active users or placeholders
- expenses reference participants
- inactive participants can be greyed out
- invited people can claim historical expenses later
- recurring or scheduled expenses can still run while someone is not onboarded

This avoids building a separate placeholder-user model for trips, direct splits, and recurring expenses.

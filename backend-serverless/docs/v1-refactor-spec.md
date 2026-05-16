# talo V1 Refactor Spec

## Summary

This refactor turns the current backend from a generic group expense service into an India-first shared-household product.

V1 positions `talo` as the operating layer for shared living:

- a home has residents,
- residents join and leave over time,
- the home has recurring obligations like rent, maid, cook, electricity, Wi-Fi, maintenance, and water,
- one person may pay a bill to an external vendor,
- only after that payment does the household obligation become roommate debt,
- the app should support photos, covers, receipts, and profile images as first-class UI objects.

This spec is intentionally product-shaped and backend-shaped. It defines how the experience should work and what has to change in the data model and API to support it.

## Product Thesis

`talo` is not a splitwise clone with better styling.

`talo` is the shared-money layer for urban Indian households:

- flats,
- apartments,
- couples,
- shared rentals,
- college houses,
- and friend groups living together.

The core job is not just "split this expense".

The core job is:

> keep household money and household coordination understandable, calm, and low-friction.

## V1 Goals

- Make the household, not the generic group, the main product entity.
- Support a resident lifecycle: invited, active, leaving, left.
- Support India-first recurring household bills with realistic due-date behavior.
- Distinguish unpaid household obligations from settled roommate balances.
- Make UPI-native settlement easy once a bill is paid.
- Support household images and profile images as first-class UI objects.
- Support a real invite-flatmates flow with pending invites and join dates.
- Support leave-home workflows without deleting history.
- Keep defaults strong and configuration light.

## V1 Non-Goals

- Full landlord/property management.
- Automated utility bill fetching from providers.
- Bank account linking.
- Multi-household accounting across companies or properties.
- Complex legal tenancy workflows.
- Deep chore management.
- Full asset depreciation or resale workflows.

## Current Backend Baseline

The current codebase already has the right primitives to build on:

- `groups` already support `household` vs `personal`.
- `group_members` already model membership.
- `users` already store `avatarUrl` and `upiId`.
- uploads already support `avatar`, `group_cover`, and receipt-style images.
- recurring expenses already exist, but they currently behave like paid expenses rather than scheduled household obligations.
- invites currently rely on a reusable invite code and immediate join flow.

The main gap is product modeling. The app knows how to store expenses, but it does not yet know how a household actually behaves over time.

## Core Product Rules

These rules should drive both UX and backend design.

1. A due bill is not the same thing as a roommate debt.
2. Household obligations exist before anyone pays.
3. Pairwise balances should change only after a resident actually pays.
4. A default payer is a suggestion, not an enforcement.
5. Any eligible active resident can pay a household bill instance.
6. Joiners should default into the next billing cycle unless the admin explicitly chooses proration.
7. Leavers should remain in history and receive a guided exit settlement flow.
8. Bill instances must snapshot the included residents at creation time.
9. Images are not a side feature. Avatars, house covers, receipts, and asset photos should shape the UI.
10. WhatsApp and UPI are default assumptions in the experience.

## Product Model

### 1. Household

This is the primary product object.

For v1, we will continue using the existing `groups` table internally and treat `groups.type = 'household'` as the household entity. We do not need a disruptive table rename in v1.

Household fields needed in v1:

- `name`
- `description`
- `city`
- `locality`
- `apartmentName`
- `unitLabel`
- `expectedResidentCount`
- `billingDay`
- `coverFileId`
- `status` (`active`, `archived`)
- `createdById`

Purpose:

- gives the app a real home identity,
- enables more relevant onboarding,
- supports a better header/home screen,
- supports join flows that feel like joining a real flat.

### 2. Resident

Residents are not static group members. They are time-bound household participants.

For v1, continue using `group_members` for active membership, but extend it with resident fields where practical. Pending invites should live in a separate invite table.

Resident fields needed in v1:

- `role` (`admin`, `member`)
- `status` (`active`, `leaving`, `left`)
- `moveInDate`
- `moveOutDate`
- `roomLabel`
- `billingStartPolicy` (`next_cycle`, `custom_prorated`)
- `billingEndPolicy` (`end_of_cycle`, `custom_prorated`)

Product rule:

- `left` residents remain visible in history and final settlement flows.

### 3. Invite

The current reusable invite-code model is not enough for household onboarding.

We need tracked household invites:

- invite by share link,
- invite by phone,
- invite by email,
- pending vs accepted vs expired vs revoked,
- optional intended join date,
- optional room label,
- who invited them.

Required invite fields:

- `groupId`
- `inviteToken`
- `inviteType` (`link`, `phone`, `email`)
- `phone`
- `email`
- `intendedName`
- `roomLabel`
- `intendedMoveInDate`
- `status` (`pending`, `accepted`, `expired`, `revoked`)
- `invitedById`
- `acceptedByUserId`
- `acceptedAt`

### 4. Bill Template

This is the v1 core abstraction for recurring home management.

A bill template defines a recurring household obligation:

- maid,
- cook,
- rent,
- electricity,
- Wi-Fi,
- maintenance,
- water,
- gas,
- subscriptions.

Required fields:

- `groupId`
- `name`
- `billKind`
- `vendorName`
- `amountMode` (`fixed`, `variable`)
- `defaultAmount`
- `currency`
- `dueDay`
- `cadence` (`monthly` for v1, optional `weekly` later)
- `defaultPayerUserId`
- `splitStrategy`
- `isActive`
- `collectProofImage` (boolean)
- `notes`

Notes:

- `defaultPayerUserId` means "usually paid by".
- Any eligible resident may still pay a given bill instance.
- `splitStrategy` must support at least:
  - `equal_active_residents`
  - `fixed_shares`
  - `room_based`
  - `custom_snapshot`

### 5. Bill Instance

This is the actual monthly obligation.

Example:

- `Maid - June 2026`
- `Electricity - bill period 12 May to 11 Jun`
- `Wi-Fi - July 2026`

Required fields:

- `templateId`
- `groupId`
- `label`
- `periodStart`
- `periodEnd`
- `dueDate`
- `status` (`scheduled`, `due`, `overdue`, `paid`, `skipped`, `cancelled`)
- `amount`
- `defaultPayerUserId`
- `actualPayerUserId`
- `paidAt`
- `proofFileId`
- `generatedExpenseId`
- `residentSnapshot`
- `splitSnapshot`

Key rule:

- A bill instance does not affect pairwise balances while it is `scheduled`, `due`, or `overdue`.
- It affects pairwise balances only when it becomes `paid` and an expense is generated.

### 6. Expense

The current `expenses` table remains valid for actual money spent by a person.

V1 rule:

- direct ad hoc expenses stay as they are,
- a paid bill instance can generate a linked expense,
- unpaid recurring household obligations should not be represented as expenses.

### 7. Settlement

The current settlement model remains valid.

V1 addition:

- settlement UX should strongly use resident UPI IDs,
- settlements should connect naturally from due balances after bill payment,
- the app should support "pay via UPI" with saved handles where possible.

### 8. Asset / Thing

Assets should be first-class household objects, not only old expense rows.

Examples:

- sofa,
- dining table,
- microwave,
- air fryer,
- washing machine,
- shoe rack,
- router,
- induction stove.

Required fields:

- `groupId`
- `name`
- `category`
- `photoFileId`
- `purchaseDate`
- `purchaseAmount`
- `purchaseExpenseId`
- `status` (`active`, `transferred`, `disposed`)
- `currentHolderUserId`
- `notes`

Ownership should be tracked separately with:

- `assetId`
- `userId`
- `ownershipPercent`
- `ownershipAmount`

This keeps move-out and asset transfer flows possible.

### 9. Deposit Ledger

Security deposit is not a normal expense.

We need a simple v1 deposit ledger:

- initial deposit contributions,
- transfers between outgoing and incoming residents,
- refund back from landlord,
- deductions from deposit.

Required fields:

- `groupId`
- `entryType` (`contribution`, `transfer`, `refund`, `deduction`)
- `amount`
- `fromUserId`
- `toUserId`
- `effectiveDate`
- `notes`
- `proofFileId`

## Bill Behavior by Type

### Maid / Cook

Expected behavior:

- fixed monthly amount by default,
- due date matters,
- usually one resident pays the vendor,
- any active resident may mark the month as paid,
- once paid, others owe the actual payer.

Important rule:

- if the bill is unpaid past due date, it becomes `overdue` but does not create roommate balances yet.

### Electricity

Expected behavior:

- variable amount,
- usually includes bill period plus due date,
- often needs proof image,
- equal split by default,
- resident inclusion should be based on snapshot for that billing period.

### Rent

Expected behavior:

- fixed monthly amount,
- often not equal split,
- should support room-based or fixed-share splits,
- proof image optional.

### Wi-Fi / Subscriptions

Expected behavior:

- fixed amount,
- one default payer,
- repeated monthly,
- paid expense generated once someone marks it paid.

### Water / Gas / Groceries

Expected behavior:

- these are usually fast ad hoc spends,
- they should remain easy quick-add expenses,
- no heavy scheduling required unless the household explicitly creates a bill template.

## UX and Information Architecture

V1 should feel like a home management app that happens to handle shared money well.

### Household Home Screen

Top section:

- household cover image,
- household name,
- resident avatars,
- locality / apartment label,
- quick actions.

Primary board:

- `Due Soon`
- `Overdue`
- `Paid This Month`
- `Your Net`

Important:

- bill cards should appear before analytics charts,
- household obligations should be visually separate from person-to-person balances.

Each bill card should show:

- bill icon,
- label,
- amount,
- due date,
- status,
- default payer chip,
- included residents count,
- proof image thumbnail if present.

### People Screen

Sections:

- active residents,
- pending invites,
- residents leaving soon,
- past residents.

Actions:

- invite flatmate,
- resend invite,
- mark leave date,
- change room label,
- update split participation for next cycle.

### Invite Flatmates Screen

This should be a dedicated flow, not a small modal.

Required elements:

- house context at top,
- pending slots if expected count is known,
- WhatsApp-first share CTA,
- invite by link,
- invite by phone,
- invite by email,
- optional move-in date,
- optional room label,
- pending invite list.

### Bills Screen

Sections:

- recurring templates,
- this month instances,
- due today,
- overdue,
- recently paid.

Primary interactions:

- add bill template,
- mark bill paid,
- attach proof,
- edit amount,
- change payer,
- skip month.

### Assets Screen

Sections:

- common furniture,
- appliances,
- setup purchases,
- shared ownership breakdown.

Each asset card should show:

- image,
- name,
- owners,
- value,
- who currently holds it.

### Leave Home Flow

This must be a guided workflow.

Required steps:

1. Choose last day in the home.
2. Decide whether current-cycle bills still include the resident.
3. Review outstanding balances.
4. Review deposit position.
5. Review owned assets/furniture.
6. Confirm exit summary.

Output:

- resident marked `left`,
- future bill snapshots exclude them,
- history preserved,
- exit summary generated,
- optional transfer targets assigned.

## Images and Uploads

Uploads should drive the UI, not sit as attachments only.

V1 image uses:

- user avatar,
- household cover image,
- bill proof image,
- receipt image,
- asset image,
- deposit proof image.

Current upload support already covers `avatar`, `group_cover`, and receipts. V1 should extend the model as needed for:

- `bill_proof`
- `asset_photo`
- `deposit_proof`

Implementation rule:

- entities should store stable file references like `coverFileId`, `avatarFileId`, `photoFileId`, `proofFileId`,
- UI should resolve these to signed URLs from the file service,
- the upload pipeline should remain two-step for larger images.

## Onboarding

The current auth model already JIT-creates users. V1 onboarding should remain progressive.

### Create Household Flow

Step 1:

- sign in,
- confirm name,
- optionally add avatar.

Step 2:

- create home,
- enter home name,
- choose city and locality,
- add apartment or unit label,
- choose expected resident count.

Step 3:

- select shared bill types:
  - rent
  - electricity
  - maid
  - cook
  - Wi-Fi
  - maintenance
  - water
  - gas

Step 4:

- set default payer for any obvious bill where known,
- optionally save own UPI ID,
- invite flatmates.

### Join Household Flow

Step 1:

- open invite,
- preview household name and cover,
- show active resident count.

Step 2:

- confirm own name, avatar, UPI ID,
- optionally add move-in date and room label.

Step 3:

- join now,
- by default start billing from next cycle.

## API Refactor Plan

V1 should be pragmatic. Do not rename everything at once.

### Keep

- existing auth model,
- existing expense model,
- existing settlement model,
- existing uploads service,
- existing `groups` table as the storage object for households.

### Normalize First

Before adding new household flows:

- unify profile mutation into one canonical "update me" endpoint,
- make `/auth/session` return onboarding and household context,
- stop splitting current-user profile behavior between overlapping endpoints.

### New or Extended API Surfaces

#### Auth / Session

- `POST /auth/session`
  - return `user`
  - return `onboarding`
  - return `activeHouseholds`

#### Household

Continue nesting under `/groups` for v1 backend compatibility, but model these as household APIs in service and client code.

- `POST /groups`
- `GET /groups/:groupId`
- `PUT /groups/:groupId`
- `GET /groups/:groupId/dashboard`

Extended response shape should include:

- household metadata,
- cover file,
- resident counts,
- pending invites,
- due bill summary,
- overdue bill summary.

#### Residents

- `GET /groups/:groupId/residents`
- `PATCH /groups/:groupId/residents/:userId`
- `POST /groups/:groupId/residents/:userId/leave`
- `POST /groups/:groupId/residents/:userId/cancel-leave`

#### Invites

- `POST /groups/:groupId/invites`
- `GET /groups/:groupId/invites`
- `POST /invites/:token/preview`
- `POST /invites/:token/accept`
- `POST /groups/:groupId/invites/:inviteId/revoke`
- `POST /groups/:groupId/invites/:inviteId/resend`

#### Bill Templates

- `GET /groups/:groupId/bill-templates`
- `POST /groups/:groupId/bill-templates`
- `PUT /groups/:groupId/bill-templates/:templateId`
- `POST /groups/:groupId/bill-templates/:templateId/pause`
- `POST /groups/:groupId/bill-templates/:templateId/resume`

#### Bill Instances

- `GET /groups/:groupId/bills`
- `GET /groups/:groupId/bills?status=due`
- `POST /groups/:groupId/bills/:billId/mark-paid`
- `POST /groups/:groupId/bills/:billId/skip`
- `POST /groups/:groupId/bills/:billId/attach-proof`

`mark-paid` should:

- validate actor eligibility,
- persist `actualPayerUserId`,
- persist `paidAt`,
- optionally attach proof image,
- create a linked expense using the resident snapshot,
- return updated household balances.

#### Assets

- `GET /groups/:groupId/assets`
- `POST /groups/:groupId/assets`
- `PUT /groups/:groupId/assets/:assetId`
- `POST /groups/:groupId/assets/:assetId/transfer`

#### Deposit Ledger

- `GET /groups/:groupId/deposits`
- `POST /groups/:groupId/deposits/entries`

## Data Model Changes

### Extend Existing Tables

#### `groups`

Add:

- `city`
- `locality`
- `apartment_name`
- `unit_label`
- `expected_resident_count`
- `billing_day`
- `cover_file_id`
- `status`

#### `group_members`

Add:

- `status`
- `move_in_date`
- `move_out_date`
- `room_label`
- `billing_start_policy`
- `billing_end_policy`

#### `users`

Add if needed:

- `avatar_file_id`
- `preferred_settlement_method`

Note:

- keep `upi_id` on `users` for v1,
- a separate payment methods table can come later.

### New Tables

- `group_invites`
- `bill_templates`
- `bill_instances`
- `assets`
- `asset_ownerships`
- `deposit_ledger_entries`

## State Machines

### Invite State

- `pending`
- `accepted`
- `expired`
- `revoked`

### Resident State

- `active`
- `leaving`
- `left`

### Bill Instance State

- `scheduled`
- `due`
- `overdue`
- `paid`
- `skipped`
- `cancelled`

Bill state transitions:

- scheduled -> due
- due -> overdue
- due -> paid
- overdue -> paid
- due -> skipped
- scheduled -> cancelled

## Operational Rules

### Who Can Pay a Bill

Default rule:

- any active resident can pay a bill instance.

Reason:

- in real households, default payer is often not the actual payer every month.

### What Happens If a Non-Default Payer Pays

- the bill instance stores the actual payer,
- the linked expense uses the actual payer,
- the template keeps its existing default payer unless the user explicitly changes it.

### What Happens If a Bill Is Paid Early

- mark it `paid`,
- create the expense immediately,
- do not force the due date to pass first.

### What Happens If a Bill Is Paid Late

- status becomes `overdue` after due date,
- once paid, it becomes `paid`,
- balances are generated only on payment.

### Joiner Billing Rule

Default:

- new residents enter from the next cycle.

Optional:

- admin can override with custom prorated handling.

### Leaver Billing Rule

Default:

- resident remains included through the active cycle,
- future cycles exclude them,
- optional custom proration remains available but secondary.

## Migration Strategy

### Phase 0: Normalize Existing Profile and Session

- unify `me` update behavior,
- return onboarding state from session,
- add household context to session response.

### Phase 1: Household Metadata and Invites

- extend `groups`,
- add tracked invite table,
- support pending invites,
- support cover image.

### Phase 2: Resident Lifecycle

- add move-in and move-out metadata,
- add leave-home flow and final summary generation,
- preserve resident history.

### Phase 3: Bill Template and Bill Instance Engine

- add recurring household obligation model,
- generate monthly instances,
- separate due obligations from expenses,
- create expenses only on payment.

### Phase 4: Assets and Deposit Ledger

- support furniture / appliance objects,
- support ownership splits,
- support deposit tracking and exit transfer flows.

### Phase 5: Client Surface Refactor

- household-first home screen,
- invite-flatmates flow,
- due bills board,
- people screen,
- leave-home flow,
- asset cards and bill proof thumbnails.

## Acceptance Criteria

V1 is successful when:

- a user can create a household that feels like a real Indian flat, not a generic group,
- a user can invite flatmates and see pending invites,
- a resident can join with move-in context,
- a maid or electricity bill can exist as due before anyone pays,
- any resident can mark the bill as paid,
- pairwise balances update only after payment,
- a resident can leave the household without losing history,
- the app can show avatars, household covers, receipts, and asset photos in core surfaces,
- rent, electricity, maid, cook, Wi-Fi, and maintenance feel natural without complex setup.

## Open Decisions

These should be resolved during implementation, not before writing the first migration.

- whether `room_based` split logic belongs in v1 or v1.1 for rent,
- whether resident status fields live directly on `group_members` or in a dedicated resident profile table,
- whether bill generation runs via scheduled job or lazy generation on read,
- whether asset ownership should be percent-based only or support fixed rupee ownership entries too,
- whether deposit transfer should auto-create settlement suggestions.

## Recommended Implementation Stance

Be conservative in naming churn and aggressive in product-model clarity.

That means:

- keep existing tables and routes where it reduces migration risk,
- add new household-specific tables for the missing concepts,
- make the client language and UX explicitly household-first,
- keep the backend rules strict around bill states and resident snapshots,
- avoid turning v1 into a highly configurable ERP.

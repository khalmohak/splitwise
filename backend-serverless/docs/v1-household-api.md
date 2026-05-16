# talo V1 Household API

## Scope

This document covers the backend API changes introduced by the v1 household refactor:

- household metadata on groups,
- tracked invites,
- resident lifecycle,
- recurring household bills,
- assets,
- deposit ledger,
- new upload kinds,
- session/onboarding metadata.

All routes below are mounted under `/api` unless noted otherwise.

## Auth

Authenticated routes require:

```http
Authorization: Bearer <firebase-id-token>
Content-Type: application/json
```

Error shape remains:

```json
{
  "error": "Validation failed",
  "code": "VALIDATION_ERROR",
  "details": {
    "field": "message"
  }
}
```

## Summary Of Changes

### Updated Endpoints

- `POST /auth/session`
- `GET /auth/me`
- `PATCH /auth/me`
- `GET /users/me`
- `PUT /users/me`
- `POST /groups`
- `GET /groups`
- `GET /groups/:groupId`
- `PUT /groups/:groupId`
- `GET /groups/:groupId/dashboard`
- `GET /invites/:code`
- `POST /invites/:code/join`
- `POST /files/presign`
- `POST /files/commit`

### Added Endpoints

- `POST /invites/:token/preview`
- `POST /invites/:token/accept`
- `GET /groups/:groupId/residents`
- `PATCH /groups/:groupId/residents/:userId`
- `POST /groups/:groupId/residents/:userId/leave`
- `POST /groups/:groupId/residents/:userId/cancel-leave`
- `POST /groups/:groupId/invites`
- `GET /groups/:groupId/invites`
- `POST /groups/:groupId/invites/:inviteId/revoke`
- `POST /groups/:groupId/invites/:inviteId/resend`
- `GET /groups/:groupId/bill-templates`
- `POST /groups/:groupId/bill-templates`
- `PUT /groups/:groupId/bill-templates/:templateId`
- `POST /groups/:groupId/bill-templates/:templateId/pause`
- `POST /groups/:groupId/bill-templates/:templateId/resume`
- `GET /groups/:groupId/bills`
- `POST /groups/:groupId/bills/:billId/mark-paid`
- `POST /groups/:groupId/bills/:billId/skip`
- `POST /groups/:groupId/bills/:billId/attach-proof`
- `GET /groups/:groupId/assets`
- `POST /groups/:groupId/assets`
- `PUT /groups/:groupId/assets/:assetId`
- `POST /groups/:groupId/assets/:assetId/transfer`
- `GET /groups/:groupId/deposits`
- `POST /groups/:groupId/deposits/entries`

## New And Updated Entity Fields

### User

Added to user payloads:

- `avatarFileId: string | null`
- `preferredSettlementMethod: "upi" | "bank_transfer" | "cash" | "other" | null`

Already present and still relevant:

- `avatarUrl`
- `upiId`

### Group / Household

Added to group payloads:

- `city: string | null`
- `locality: string | null`
- `apartmentName: string | null`
- `unitLabel: string | null`
- `expectedResidentCount: number | null`
- `billingDay: number | null`
- `coverFileId: string | null`
- `status: "active" | "archived"`
- `pendingInviteCount: number`

### Resident

New resident fields:

- `status: "active" | "leaving" | "left"`
- `roomLabel: string | null`
- `moveInDate: string | null`
- `moveOutDate: string | null`
- `billingStartPolicy: "next_cycle" | "custom_prorated" | "end_of_cycle"`
- `billingEndPolicy: "next_cycle" | "custom_prorated" | "end_of_cycle"`

### File Upload Kinds

Added upload kinds:

- `bill_proof`
- `asset_photo`
- `deposit_proof`

Existing kinds still supported:

- `receipt`
- `avatar`
- `group_cover`
- `other`

## Updated Endpoints

### `POST /auth/session`

Returns the canonical user plus onboarding and active-household context.

Response:

```json
{
  "user": {
    "id": "uuid",
    "firebaseUid": "firebase-uid",
    "email": "user@example.com",
    "emailVerified": true,
    "phone": "+919999999999",
    "name": "Aditi",
    "avatarUrl": "https://...",
    "avatarFileId": "uuid",
    "upiId": "aditi@okaxis",
    "preferredSettlementMethod": "upi",
    "lastSignInProvider": "password",
    "createdAt": "2026-05-15T10:00:00.000Z",
    "updatedAt": "2026-05-15T10:00:00.000Z"
  },
  "onboarding": {
    "needsName": false,
    "needsGroup": true,
    "needsUpiId": true,
    "needsAvatar": false,
    "nextStep": "create_or_join_household"
  },
  "activeHouseholds": [
    {
      "id": "uuid",
      "name": "Palm Grove 402",
      "type": "household",
      "city": "Bengaluru",
      "locality": "HSR Layout",
      "unitLabel": "402",
      "apartmentName": "Palm Grove",
      "status": "active",
      "memberRole": "admin"
    }
  ]
}
```

Notes:

- `nextStep` can be `profile`, `create_or_join_household`, `add_upi`, `add_avatar`, or `done`.
- Only active households where the caller is not `left` are returned.

### `GET /auth/me`

Response shape now includes:

- `avatarFileId`
- `preferredSettlementMethod`

### `PATCH /auth/me`

Updated writable fields:

```json
{
  "name": "Aditi",
  "avatarUrl": "https://...",
  "avatarFileId": "uuid",
  "upiId": "aditi@okaxis",
  "preferredSettlementMethod": "upi"
}
```

Response:

```json
{
  "user": {
    "...": "same shape as POST /auth/session user"
  }
}
```

### `GET /users/me`

Response now includes:

- `avatarFileId`
- `preferredSettlementMethod`

### `PUT /users/me`

Updated writable fields:

```json
{
  "name": "Aditi",
  "avatarUrl": "https://...",
  "avatarFileId": "uuid",
  "upiId": "aditi@okaxis",
  "preferredSettlementMethod": "upi",
  "phone": "+919999999999"
}
```

Notes:

- `PATCH /auth/me` and `PUT /users/me` both exist today.
- They are overlapping profile mutation surfaces.

### `POST /groups`

Now supports household metadata.

Request:

```json
{
  "name": "Palm Grove 402",
  "description": "3BHK flat",
  "type": "household",
  "city": "Bengaluru",
  "locality": "HSR Layout",
  "apartmentName": "Palm Grove",
  "unitLabel": "402",
  "expectedResidentCount": 4,
  "billingDay": 5,
  "coverFileId": "uuid"
}
```

Response:

- same shape as `GET /groups/:groupId`
- creator is inserted as an active admin resident with `moveInDate = today`

### `GET /groups`

Each group item now includes:

```json
{
  "id": "uuid",
  "name": "Palm Grove 402",
  "type": "household",
  "description": "3BHK flat",
  "city": "Bengaluru",
  "locality": "HSR Layout",
  "apartmentName": "Palm Grove",
  "unitLabel": "402",
  "expectedResidentCount": 4,
  "billingDay": 5,
  "coverFileId": "uuid",
  "status": "active",
  "memberCount": 4,
  "yourRole": "admin",
  "yourBalance": "1200.00",
  "lastActivityAt": "2026-05-15T10:00:00.000Z"
}
```

Notes:

- `left` residents are excluded from group list membership checks and member counts.

### `GET /groups/:groupId`

Group detail now includes household metadata and `pendingInviteCount`.

Response:

```json
{
  "id": "uuid",
  "name": "Palm Grove 402",
  "type": "household",
  "description": "3BHK flat",
  "city": "Bengaluru",
  "locality": "HSR Layout",
  "apartmentName": "Palm Grove",
  "unitLabel": "402",
  "expectedResidentCount": 4,
  "billingDay": 5,
  "coverFileId": "uuid",
  "status": "active",
  "pendingInviteCount": 2,
  "createdBy": {
    "id": "uuid",
    "name": "Aditi"
  },
  "members": [
    {
      "userId": "uuid",
      "id": "uuid",
      "name": "Aditi",
      "email": "user@example.com",
      "avatarUrl": "https://...",
      "role": "admin",
      "status": "active",
      "moveInDate": "2026-05-01",
      "moveOutDate": null,
      "roomLabel": "Master Bedroom",
      "billingStartPolicy": "next_cycle",
      "billingEndPolicy": "end_of_cycle",
      "joinedAt": "2026-05-01T00:00:00.000Z"
    }
  ],
  "createdAt": "2026-05-01T00:00:00.000Z",
  "updatedAt": "2026-05-15T00:00:00.000Z",
  "inviteCode": "legacy-code-admin-only"
}
```

### `PUT /groups/:groupId`

Now supports updates for:

- `city`
- `locality`
- `apartmentName`
- `unitLabel`
- `expectedResidentCount`
- `billingDay`
- `coverFileId`
- `status`

### `GET /groups/:groupId/dashboard`

Dashboard response now includes bill counters:

```json
{
  "group": {
    "id": "uuid",
    "name": "Palm Grove 402",
    "type": "household",
    "memberCount": 4
  },
  "balances": {
    "simplified": [],
    "myBalance": {
      "net": "250.00"
    }
  },
  "thisMonth": {
    "total": "14250.00",
    "expenseCount": 12,
    "vsLastMonth": {
      "changeAmount": "500.00",
      "changePct": "3.64",
      "direction": "up"
    }
  },
  "recentExpenses": [],
  "bills": {
    "dueCount": 3,
    "overdueCount": 1
  },
  "recentActivity": []
}
```

Notes:

- this endpoint auto-generates current-month bill instances before computing counts

### `GET /invites/:code`

Legacy invite-code preview now returns richer household metadata:

- `city`
- `locality`
- `apartmentName`
- `unitLabel`
- `coverFileId`

### `POST /invites/:code/join`

Legacy invite-code join now:

- creates or reactivates a `group_members` row
- sets `status = active`
- sets `moveInDate = today` on insert

### `POST /files/presign`

Added accepted `kind` values:

```json
{
  "filename": "maid-june.jpg",
  "mimeType": "image/jpeg",
  "sizeBytes": 123456,
  "groupId": "uuid",
  "expenseId": null,
  "kind": "bill_proof"
}
```

### `POST /files/commit`

Added accepted `kind` values:

- `bill_proof`
- `asset_photo`
- `deposit_proof`

## New Endpoints

### `POST /invites/:token/preview`

Preview a tracked invite token.

Auth:

- required

Request body:

- none

Response:

```json
{
  "invite": {
    "id": "uuid",
    "inviteType": "link",
    "roomLabel": "Second Bedroom",
    "intendedMoveInDate": "2026-06-01",
    "intendedName": "Kunal",
    "expiresAt": "2026-06-10T00:00:00.000Z"
  },
  "group": {
    "id": "uuid",
    "name": "Palm Grove 402",
    "type": "household",
    "city": "Bengaluru",
    "locality": "HSR Layout",
    "apartmentName": "Palm Grove",
    "unitLabel": "402",
    "coverFileId": "uuid",
    "memberCount": 3
  },
  "alreadyMember": false
}
```

Notes:

- invalid, expired, or non-pending invites return `404`

### `POST /invites/:token/accept`

Accept a tracked invite token.

Auth:

- required

Request:

```json
{
  "moveInDate": "2026-06-01",
  "roomLabel": "Second Bedroom"
}
```

All fields are optional. If omitted:

- `moveInDate` falls back to invite `intendedMoveInDate`, else today
- `roomLabel` falls back to invite `roomLabel`

Response:

```json
{
  "groupId": "uuid"
}
```

Side effects:

- creates or reactivates a resident row
- marks invite `accepted`
- sets `acceptedByUserId` and `acceptedAt`

## Resident APIs

### `GET /groups/:groupId/residents`

Returns all residents for the household.

Response:

```json
{
  "residents": [
    {
      "userId": "uuid",
      "name": "Aditi",
      "email": "user@example.com",
      "avatarUrl": "https://...",
      "role": "admin",
      "status": "active",
      "roomLabel": "Master Bedroom",
      "moveInDate": "2026-05-01",
      "moveOutDate": null,
      "billingStartPolicy": "next_cycle",
      "billingEndPolicy": "end_of_cycle",
      "joinedAt": "2026-05-01T00:00:00.000Z"
    }
  ]
}
```

### `PATCH /groups/:groupId/residents/:userId`

Auth:

- admin only

Request:

```json
{
  "role": "member",
  "status": "leaving",
  "roomLabel": "Room 2",
  "moveInDate": "2026-05-01",
  "moveOutDate": "2026-06-30",
  "billingStartPolicy": "next_cycle",
  "billingEndPolicy": "end_of_cycle"
}
```

Response:

```json
{
  "resident": {
    "...": "same shape as resident item"
  }
}
```

### `POST /groups/:groupId/residents/:userId/leave`

Auth:

- admin, or self for own resident row

Request:

```json
{
  "lastDay": "2026-06-30",
  "billingEndPolicy": "end_of_cycle"
}
```

Behavior:

- if `lastDay` is in the future, status becomes `leaving`
- if `lastDay` is today or in the past, status becomes `left`

Response:

```json
{
  "resident": {
    "...": "same shape as resident item"
  }
}
```

### `POST /groups/:groupId/residents/:userId/cancel-leave`

Auth:

- admin, or self for own resident row

Response:

```json
{
  "resident": {
    "...": "same shape as resident item"
  }
}
```

Behavior:

- resets `status` to `active`
- clears `moveOutDate`
- resets `billingEndPolicy` to `end_of_cycle`

## Tracked Invite APIs

### `POST /groups/:groupId/invites`

Auth:

- admin only

Request:

```json
{
  "inviteType": "email",
  "email": "roommate@example.com",
  "phone": null,
  "intendedName": "Kunal",
  "roomLabel": "Second Bedroom",
  "intendedMoveInDate": "2026-06-01",
  "expiresInDays": 14
}
```

Rules:

- `inviteType = phone` requires `phone`
- `inviteType = email` requires `email`
- `inviteType = email` sends an invite email to the supplied address
- defaults to `inviteType = link`
- token validity defaults to 14 days

Response:

```json
{
  "invite": {
    "id": "uuid",
    "inviteToken": "base64url-token",
    "inviteType": "email",
    "phone": null,
    "email": "roommate@example.com",
    "intendedName": "Kunal",
    "roomLabel": "Second Bedroom",
    "intendedMoveInDate": "2026-06-01",
    "status": "pending",
    "invitedBy": {
      "id": "uuid",
      "name": "Aditi"
    },
    "acceptedBy": null,
    "acceptedAt": null,
    "expiresAt": "2026-06-10T00:00:00.000Z",
    "createdAt": "2026-05-27T00:00:00.000Z",
    "updatedAt": "2026-05-27T00:00:00.000Z"
  }
}
```

### `GET /groups/:groupId/invites`

Auth:

- admin only

Response:

```json
{
  "invites": [
    {
      "...": "same invite shape as create response"
    }
  ]
}
```

### `POST /groups/:groupId/invites/:inviteId/revoke`

Auth:

- admin only

Response:

```json
{
  "invite": {
    "...": "same invite shape",
    "status": "revoked"
  }
}
```

### `POST /groups/:groupId/invites/:inviteId/resend`

Auth:

- admin only

Behavior:

- keeps the same invite token
- resets status to `pending`
- extends expiry to 14 days from now
- sends another invite email when the invite type is `email`

Response:

```json
{
  "invite": {
    "...": "same invite shape",
    "status": "pending"
  }
}
```

## Bill Template APIs

### `GET /groups/:groupId/bill-templates`

Auth:

- any resident

Response:

```json
{
  "templates": [
    {
      "id": "uuid",
      "name": "Maid",
      "billKind": "maid",
      "vendorName": "Shanti",
      "amountMode": "fixed",
      "defaultAmount": "4000.00",
      "currency": "INR",
      "dueDay": 5,
      "cadence": "monthly",
      "defaultPayer": {
        "id": "uuid",
        "name": "Aditi",
        "avatarUrl": "https://..."
      },
      "splitStrategy": "equal_active_residents",
      "splitConfig": null,
      "collectProofImage": false,
      "isActive": true,
      "notes": "Cash to maid",
      "createdAt": "2026-05-27T00:00:00.000Z",
      "updatedAt": "2026-05-27T00:00:00.000Z"
    }
  ]
}
```

### `POST /groups/:groupId/bill-templates`

Auth:

- admin only

Request:

```json
{
  "name": "Electricity",
  "billKind": "electricity",
  "vendorName": "BESCOM",
  "amountMode": "variable",
  "defaultAmount": null,
  "currency": "INR",
  "dueDay": 12,
  "cadence": "monthly",
  "defaultPayerUserId": "uuid",
  "splitStrategy": "equal_active_residents",
  "splitConfig": null,
  "collectProofImage": true,
  "isActive": true,
  "notes": "Upload BESCOM screenshot"
}
```

Notes:

- `defaultAmount` must be a valid money string when provided
- `defaultPayerUserId` must belong to a non-left resident

Response:

```json
{
  "template": {
    "...": "same shape as list item"
  }
}
```

### `PUT /groups/:groupId/bill-templates/:templateId`

Auth:

- admin only

Request and response:

- same shapes as create

### `POST /groups/:groupId/bill-templates/:templateId/pause`

Auth:

- admin only

Response:

```json
{
  "template": {
    "...": "same template shape",
    "isActive": false
  }
}
```

### `POST /groups/:groupId/bill-templates/:templateId/resume`

Auth:

- admin only

Response:

```json
{
  "template": {
    "...": "same template shape",
    "isActive": true
  }
}
```

## Bill Instance APIs

### `GET /groups/:groupId/bills`

Auth:

- any resident

Query params:

- `status=scheduled|due|overdue|paid|skipped|cancelled`

Behavior:

- auto-generates current-month bill instances from active templates before returning

Response:

```json
{
  "bills": [
    {
      "id": "uuid",
      "templateId": "uuid",
      "label": "Maid - May 2026",
      "billKind": "maid",
      "amount": "4000.00",
      "status": "due",
      "dueDate": "2026-05-05",
      "periodStart": "2026-05-01",
      "periodEnd": "2026-05-31",
      "defaultPayer": {
        "id": "uuid",
        "name": "Aditi",
        "avatarUrl": "https://..."
      },
      "actualPayer": null,
      "residentCount": 4,
      "residents": [
        {
          "userId": "uuid",
          "name": "Aditi",
          "avatarUrl": "https://...",
          "roomLabel": "Master Bedroom",
          "moveInDate": "2026-05-01",
          "moveOutDate": null,
          "status": "active"
        }
      ],
      "proofFileId": null,
      "generatedExpenseId": null,
      "createdAt": "2026-05-01T00:00:00.000Z",
      "updatedAt": "2026-05-01T00:00:00.000Z"
    }
  ]
}
```

### `POST /groups/:groupId/bills/:billId/mark-paid`

Auth:

- any resident

Request:

```json
{
  "amount": "4000.00",
  "paidDate": "2026-05-05",
  "notes": "Paid by UPI",
  "proofFileId": "uuid"
}
```

Rules:

- if `amount` is omitted, the bill instance must already have an amount
- the authenticated actor becomes the actual payer
- `proofFileId` must be accessible by the actor or belong to the group
- bill must not already be `paid`, `skipped`, or `cancelled`

Response:

```json
{
  "bill": {
    "...": "same shape as GET /bills item",
    "status": "paid"
  },
  "expenseId": "uuid"
}
```

Side effects:

- creates a linked expense in `expenses`
- creates exact-split participants from the bill snapshot
- updates `generatedExpenseId` on the bill instance

### `POST /groups/:groupId/bills/:billId/skip`

Auth:

- admin only

Response:

```json
{
  "bill": {
    "id": "uuid",
    "status": "skipped",
    "...": "raw bill_instances row"
  }
}
```

### `POST /groups/:groupId/bills/:billId/attach-proof`

Auth:

- any resident

Request:

```json
{
  "proofFileId": "uuid"
}
```

Response:

```json
{
  "bill": {
    "id": "uuid",
    "proofFileId": "uuid",
    "...": "raw bill_instances row"
  }
}
```

## Asset APIs

### `GET /groups/:groupId/assets`

Auth:

- any resident

Response:

```json
{
  "assets": [
    {
      "id": "uuid",
      "name": "Microwave",
      "category": "appliance",
      "photoFileId": "uuid",
      "purchaseDate": "2026-05-01",
      "purchaseAmount": "8000.00",
      "purchaseExpenseId": "uuid",
      "status": "active",
      "currentHolderUserId": "uuid",
      "notes": "Bought during move-in",
      "ownerships": [
        {
          "userId": "uuid",
          "name": "Aditi",
          "avatarUrl": "https://...",
          "ownershipPercent": "50.0000",
          "ownershipAmount": null
        }
      ],
      "createdAt": "2026-05-01T00:00:00.000Z",
      "updatedAt": "2026-05-01T00:00:00.000Z"
    }
  ]
}
```

### `POST /groups/:groupId/assets`

Auth:

- any resident

Request:

```json
{
  "name": "Microwave",
  "category": "appliance",
  "photoFileId": "uuid",
  "purchaseDate": "2026-05-01",
  "purchaseAmount": "8000.00",
  "purchaseExpenseId": null,
  "currentHolderUserId": "uuid",
  "notes": "Shared item",
  "ownerships": [
    {
      "userId": "uuid",
      "ownershipPercent": "50.0000",
      "ownershipAmount": null
    }
  ]
}
```

Validation:

- `purchaseAmount` and `ownershipAmount` must be money strings
- `ownershipPercent` must be a numeric string with up to 4 decimals
- all referenced users must belong to the group

Response:

```json
{
  "asset": {
    "...": "same shape as list item"
  }
}
```

### `PUT /groups/:groupId/assets/:assetId`

Auth:

- any resident

Request and response:

- same shape as create

Behavior:

- if `ownerships` is provided, existing ownership rows are replaced

### `POST /groups/:groupId/assets/:assetId/transfer`

Auth:

- any resident

Request:

```json
{
  "currentHolderUserId": "uuid",
  "ownerships": [
    {
      "userId": "uuid",
      "ownershipPercent": "100.0000",
      "ownershipAmount": null
    }
  ]
}
```

Behavior:

- updates `currentHolderUserId`
- sets status to `transferred` if a holder is present
- replaces ownership rows when `ownerships` is supplied

Response:

```json
{
  "asset": {
    "...": "same shape as list item"
  }
}
```

## Deposit APIs

### `GET /groups/:groupId/deposits`

Auth:

- any resident

Response:

```json
{
  "entries": [
    {
      "id": "uuid",
      "entryType": "contribution",
      "amount": "10000.00",
      "fromUser": null,
      "toUser": {
        "id": "uuid",
        "name": "Aditi",
        "avatarUrl": "https://..."
      },
      "effectiveDate": "2026-05-01",
      "proofFileId": "uuid",
      "notes": "Initial deposit",
      "createdAt": "2026-05-01T00:00:00.000Z"
    }
  ],
  "netByUser": [
    {
      "userId": "uuid",
      "name": "Aditi",
      "avatarUrl": "https://...",
      "netAmount": "10000.00"
    }
  ]
}
```

### `POST /groups/:groupId/deposits/entries`

Auth:

- any resident

Request:

```json
{
  "entryType": "transfer",
  "amount": "5000.00",
  "fromUserId": "uuid",
  "toUserId": "uuid",
  "effectiveDate": "2026-06-01",
  "proofFileId": "uuid",
  "notes": "Outgoing roommate transfer"
}
```

Validation:

- `amount` must be a money string
- any provided `fromUserId` / `toUserId` must belong to the group

Response:

```json
{
  "entry": {
    "id": "uuid",
    "groupId": "uuid",
    "entryType": "transfer",
    "amount": "5000.00",
    "fromUserId": "uuid",
    "toUserId": "uuid",
    "effectiveDate": "2026-06-01",
    "proofFileId": "uuid",
    "notes": "Outgoing roommate transfer",
    "createdById": "uuid",
    "createdAt": "2026-05-27T00:00:00.000Z",
    "updatedAt": "2026-05-27T00:00:00.000Z"
  }
}
```

## Business Rules Implemented In The API

### Bills

- Bill instances are generated from active templates on `GET /groups/:groupId/bills` and `GET /groups/:groupId/dashboard`.
- Unpaid bills do not create pairwise balances.
- Balances change only when `POST /groups/:groupId/bills/:billId/mark-paid` creates the linked expense.
- The authenticated actor becomes the actual payer for `mark-paid`.
- Current status is derived from stored status plus due date:
  - `paid`, `skipped`, `cancelled` stay terminal
  - unpaid past due becomes `overdue`
  - unpaid not past due is `due`

### Residents

- `left` residents are excluded from active membership checks.
- Leaving a household does not delete the membership row.
- Legacy invite-code joins and tracked invite accepts both reactivate an existing resident row when present.

### Invites

- Tracked invites are token-based and separate from legacy reusable invite codes.
- Only `pending` and non-expired tracked invites are previewable/acceptable.
- Revoking marks the invite unusable without deleting it.

## Known Contract Notes

- `POST /groups/:groupId/bills/:billId/skip` and `POST /groups/:groupId/bills/:billId/attach-proof` currently return the raw `bill_instances` row, not the presented bill shape used by `GET /groups/:groupId/bills`.
- `POST /groups/:groupId/deposits/entries` returns the raw deposit entry row.
- `GET /groups/:groupId/invites` currently joins the inviter only; `acceptedBy` will usually be `null` in this response even if populated in storage.
- `PATCH /auth/me` and `PUT /users/me` still overlap and should be unified later.

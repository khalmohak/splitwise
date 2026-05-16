# v1 Onboarding API

All onboarding endpoints live under `/api/onboarding` and require the same Bearer auth used by the rest of the API.

The onboarding surface is intentionally orchestration-first:

- `GET /api/onboarding` gives the client a single bootstrap payload for first-run flows.
- `PATCH /api/onboarding/profile` saves the user-owned profile fields used during onboarding.
- `POST /api/onboarding/create-household` creates the first household, optional starter recurring bills, and optional tracked invites in one call.
- `POST /api/onboarding/accept-invite` hydrates profile fields and joins a tracked invite in one call.

## Shared Response Shape

Most onboarding responses return this bootstrap block:

```json
{
  "user": {
    "id": "uuid",
    "firebaseUid": "firebase-uid",
    "email": "aditi@example.com",
    "emailVerified": true,
    "phone": "+919999999999",
    "name": "Aditi",
    "avatarUrl": null,
    "avatarFileId": "uuid-or-null",
    "upiId": "aditi@okaxis",
    "preferredSettlementMethod": "upi",
    "lastSignInProvider": "phone",
    "createdAt": "2026-05-15T09:30:00.000Z",
    "updatedAt": "2026-05-15T09:30:00.000Z"
  },
  "onboarding": {
    "needsName": false,
    "needsGroup": true,
    "needsUpiId": false,
    "needsAvatar": true,
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
      "coverFileId": "uuid-or-null",
      "status": "active",
      "memberRole": "admin"
    }
  ],
  "pendingInvites": [
    {
      "id": "uuid",
      "inviteToken": "base64url-token",
      "inviteType": "email",
      "phone": null,
      "email": "aditi@example.com",
      "intendedName": "Aditi",
      "roomLabel": "Bedroom 2",
      "intendedMoveInDate": "2026-06-01",
      "expiresAt": "2026-05-29T09:30:00.000Z",
      "createdAt": "2026-05-15T09:30:00.000Z",
      "updatedAt": "2026-05-15T09:30:00.000Z",
      "alreadyMember": false,
      "group": {
        "id": "uuid",
        "name": "Palm Grove 402",
        "type": "household",
        "city": "Bengaluru",
        "locality": "HSR Layout",
        "apartmentName": "Palm Grove",
        "unitLabel": "402",
        "coverFileId": "uuid-or-null",
        "status": "active"
      }
    }
  ],
  "invitePreview": null,
  "presets": {
    "billTemplates": [
      {
        "key": "maid",
        "name": "Maid",
        "billKind": "maid",
        "amountMode": "fixed",
        "cadence": "monthly",
        "splitStrategy": "equal_active_residents",
        "suggestedDueDay": 5,
        "collectProofImage": false
      }
    ]
  }
}
```

## GET `/api/onboarding`

Bootstrap the onboarding UI for a signed-in user.

### Query Params

- `inviteToken` optional tracked invite token. When supplied, the response includes `invitePreview` with the same preview data needed for an invite-aware join flow.

### Invite Preview Shape

When `inviteToken` is present and valid:

```json
{
  "invitePreview": {
    "invite": {
      "id": "uuid",
      "inviteToken": "token",
      "inviteType": "phone",
      "roomLabel": "Bedroom 2",
      "intendedMoveInDate": "2026-06-01",
      "intendedName": "Kunal",
      "expiresAt": "2026-05-29T09:30:00.000Z"
    },
    "group": {
      "id": "uuid",
      "name": "Palm Grove 402",
      "type": "household",
      "city": "Bengaluru",
      "locality": "HSR Layout",
      "apartmentName": "Palm Grove",
      "unitLabel": "402",
      "coverFileId": "uuid-or-null",
      "memberCount": 3
    },
    "alreadyMember": false
  }
}
```

### Notes

- `pendingInvites` only includes targeted pending invites where the invite email or phone matches the signed-in user.
- generic link invites are not discoverable automatically; pass `inviteToken` when the user opens an invite link.
- `presets.billTemplates` is a UI helper for household setup and can be used to prefill the bill setup sheet.

## PATCH `/api/onboarding/profile`

Save onboarding-owned user fields and return the refreshed bootstrap payload.

### Body

All fields are optional.

```json
{
  "name": "Aditi",
  "avatarUrl": null,
  "avatarFileId": "uuid-or-null",
  "upiId": "aditi@okaxis",
  "preferredSettlementMethod": "upi"
}
```

### Rules

- `avatarFileId`, when provided, must reference a file owned by the caller and the file kind must be `avatar` or `other`.
- the endpoint does not update Firebase-owned identity fields like `email`, `phone`, or `emailVerified`.

## POST `/api/onboarding/create-household`

Create a household-first setup in one call.

### Body

```json
{
  "profile": {
    "name": "Aditi",
    "avatarFileId": "uuid-or-null",
    "upiId": "aditi@okaxis",
    "preferredSettlementMethod": "upi"
  },
  "household": {
    "name": "Palm Grove 402",
    "description": "3BHK in HSR",
    "city": "Bengaluru",
    "locality": "HSR Layout",
    "apartmentName": "Palm Grove",
    "unitLabel": "402",
    "expectedResidentCount": 4,
    "billingDay": 5,
    "coverFileId": "uuid-or-null"
  },
  "billTemplates": [
    {
      "name": "Maid",
      "billKind": "maid",
      "amountMode": "fixed",
      "defaultAmount": "4500.00",
      "assignToCreator": true,
      "splitStrategy": "equal_active_residents"
    },
    {
      "name": "Electricity",
      "billKind": "electricity",
      "amountMode": "variable",
      "collectProofImage": true
    }
  ],
  "invites": [
    {
      "inviteType": "phone",
      "phone": "+919999999999",
      "intendedName": "Kunal",
      "roomLabel": "Bedroom 2",
      "intendedMoveInDate": "2026-06-01",
      "expiresInDays": 14
    }
  ]
}
```

### Template Defaults

For each `billTemplates[]` entry:

- `billKind` defaults to `other`
- `amountMode` defaults to `fixed`
- `currency` defaults to `INR`
- `cadence` is fixed to monthly for onboarding-created starter templates
- `splitStrategy` defaults to `equal_active_residents`
- `collectProofImage` defaults to `false`
- `isActive` defaults to `true`
- `dueDay` defaults to:
  - `household.billingDay`, if present
  - otherwise the preset day for known bill kinds
  - otherwise `1`

### Invite Defaults

For each `invites[]` entry:

- `inviteType` defaults to `link`
- `expiresInDays` defaults to `14`
- `email` is lowercased before storage

### Response Additions

The response includes the shared bootstrap block plus:

```json
{
  "household": {
    "id": "uuid",
    "name": "Palm Grove 402",
    "type": "household",
    "city": "Bengaluru",
    "locality": "HSR Layout",
    "unitLabel": "402",
    "apartmentName": "Palm Grove",
    "coverFileId": "uuid-or-null",
    "status": "active",
    "memberRole": "admin"
  },
  "createdBillTemplates": [
    {
      "id": "uuid",
      "name": "Maid",
      "billKind": "maid",
      "amountMode": "fixed",
      "defaultAmount": "4500.00",
      "currency": "INR",
      "dueDay": 5,
      "cadence": "monthly",
      "defaultPayer": {
        "id": "uuid",
        "name": "Aditi",
        "avatarUrl": null
      },
      "splitStrategy": "equal_active_residents",
      "splitConfig": null,
      "collectProofImage": false,
      "isActive": true,
      "notes": null,
      "createdAt": "2026-05-15T09:30:00.000Z",
      "updatedAt": "2026-05-15T09:30:00.000Z"
    }
  ],
  "createdInvites": [
    {
      "id": "uuid",
      "inviteToken": "token",
      "inviteType": "phone",
      "phone": "+919999999999",
      "email": null,
      "intendedName": "Kunal",
      "roomLabel": "Bedroom 2",
      "intendedMoveInDate": "2026-06-01",
      "status": "pending",
      "invitedBy": {
        "id": "uuid",
        "name": "Aditi"
      },
      "acceptedBy": null,
      "acceptedAt": null,
      "expiresAt": "2026-05-29T09:30:00.000Z",
      "createdAt": "2026-05-15T09:30:00.000Z",
      "updatedAt": "2026-05-15T09:30:00.000Z"
    }
  ]
}
```

### Rules

- `household.coverFileId`, when provided, must belong to the caller and be of kind `group_cover` or `other`.
- `profile.avatarFileId`, when provided, must belong to the caller and be of kind `avatar` or `other`.
- `defaultPayerUserId` may only be the creator for this onboarding call, because no other residents exist yet.
- `assignToCreator: true` is a convenience flag for common single-payer defaults during setup.
- on success, the endpoint also generates current-cycle bill instances for any created recurring bill templates.

## POST `/api/onboarding/accept-invite`

Join a tracked invite and optionally save onboarding profile fields in the same call.

### Body

```json
{
  "token": "base64url-token",
  "profile": {
    "name": "Kunal",
    "avatarFileId": "uuid-or-null",
    "upiId": "kunal@ybl"
  },
  "moveInDate": "2026-06-01",
  "roomLabel": "Bedroom 2"
}
```

### Behavior

- if `moveInDate` is omitted, the API uses `invite.intendedMoveInDate`, then falls back to today.
- if `roomLabel` is omitted, the API uses `invite.roomLabel`.
- if the user was already in the group, the membership row is reactivated through `onConflictDoUpdate`.
- the tracked invite is marked `accepted` and stores `acceptedByUserId` and `acceptedAt`.

### Response Additions

The response includes the shared bootstrap block plus:

```json
{
  "groupId": "uuid",
  "household": {
    "id": "uuid",
    "name": "Palm Grove 402",
    "type": "household",
    "city": "Bengaluru",
    "locality": "HSR Layout",
    "unitLabel": "402",
    "apartmentName": "Palm Grove",
    "coverFileId": "uuid-or-null",
    "status": "active",
    "memberRole": "member"
  }
}
```

## Error Cases

Common onboarding errors use the standard backend error shape:

```json
{
  "error": "Invite link is invalid or has expired",
  "code": "NOT_FOUND"
}
```

Important cases:

- invalid or expired tracked invite token: `404 NOT_FOUND`
- wrong file ownership or missing file: `404 NOT_FOUND`
- wrong file kind for avatar or cover: `400 INVALID_FILE_KIND`
- phone invite without `phone`: `400 PHONE_REQUIRED`
- email invite without `email`: `400 EMAIL_REQUIRED`
- invalid money string on bill setup: `400 INVALID_DEFAULT_AMOUNT`
- conflicting `assignToCreator` and `defaultPayerUserId`: `400 INVALID_DEFAULT_PAYER`

# Splitwise API — Full Reference

**Base URL:** `http://localhost:3000`

---

## Table of Contents

1. [Conventions](#1-conventions)
2. [Authentication](#2-authentication)
3. [Users](#3-users)
4. [Groups](#4-groups)
5. [Members](#5-members)
6. [Categories](#6-categories)
7. [Tags](#7-tags)
8. [Expenses](#8-expenses)
9. [Balances](#9-balances)
10. [Settlements](#10-settlements)
11. [Budgets](#11-budgets)
12. [Analytics](#12-analytics)
13. [Activity Feed](#13-activity-feed)
14. [Dashboard](#14-dashboard)
15. [Appendix](#15-appendix)

---

## 1. Conventions

### Content Type
All requests and responses use `application/json`.

### Authentication
Protected endpoints are marked `🔒`. Pass the JWT in the header:
```
Authorization: Bearer <token>
```

### Amounts
All monetary values are **strings with exactly 2 decimal places** — never floats.
```
"1200.00"   ✓
1200        ✗
1200.5      ✗
```

### Dates vs Timestamps
- **Date** (calendar day): `"YYYY-MM-DD"` — used for expense dates, settlement dates.
- **Timestamp** (exact moment): ISO 8601 — `"2024-03-15T10:30:00.000Z"` — used for `createdAt`, `updatedAt`.

### Pagination
All list endpoints accept:
| Param | Default | Max | Description |
|---|---|---|---|
| `page` | `1` | — | Page number (1-indexed) |
| `limit` | `20` | `100` | Items per page |

All list responses wrap data in a consistent envelope:
```json
{
  "data": [...],
  "meta": {
    "total": 84,
    "page": 1,
    "limit": 20,
    "totalPages": 5
  }
}
```

### Sorting
List endpoints that support sorting accept:
| Param | Description |
|---|---|
| `sort` | Field name to sort by (documented per endpoint) |
| `order` | `asc` or `desc` (default: `desc`) |

### Error Format
Every error response follows this shape:
```json
{
  "error": "Human-readable message explaining what went wrong",
  "code": "MACHINE_READABLE_CODE",
  "details": {}
}
```
`details` is optional — present when field-level validation fails:
```json
{
  "error": "Validation failed",
  "code": "VALIDATION_ERROR",
  "details": {
    "amount": "Must be a positive number",
    "participants": "Split amounts must sum to the total expense amount"
  }
}
```

### HTTP Status Codes
| Status | Meaning |
|---|---|
| `200` | Success |
| `201` | Created |
| `204` | Success, no body (DELETE) |
| `400` | Bad request / validation error |
| `401` | Missing or invalid token |
| `403` | Valid token, insufficient permissions |
| `404` | Resource not found (or not accessible to you) |
| `409` | Conflict (e.g. email already registered) |
| `422` | Unprocessable — structurally valid but logically wrong (e.g. split doesn't sum to total) |
| `500` | Internal server error |

### Permission Levels
- **member** — can create expenses, view group data
- **admin** — can additionally edit group settings, manage members, delete any expense/settlement

---

## 2. Authentication

### `POST /auth/register`
Create a new account. No auth required.

**Body**
```json
{
  "name": "Mohak",
  "email": "mohak@example.com",
  "password": "min8chars"
}
```

**Response `201`**
```json
{
  "token": "<jwt>",
  "user": {
    "id": "uuid",
    "name": "Mohak",
    "email": "mohak@example.com",
    "avatarUrl": null,
    "createdAt": "2024-03-01T00:00:00.000Z"
  }
}
```

**Errors**
| Code | Reason |
|---|---|
| `CONFLICT` | Email already registered |
| `VALIDATION_ERROR` | Missing fields or password too short (< 8 chars) |

---

### `POST /auth/login`
No auth required.

**Body**
```json
{
  "email": "mohak@example.com",
  "password": "min8chars"
}
```

**Response `200`** — same shape as register.

**Errors**
| Code | Reason |
|---|---|
| `INVALID_CREDENTIALS` | Wrong email or password (always `401`) |

---

### `POST /auth/logout` 🔒
Invalidates the token server-side (adds to blocklist).

**Response `204`** — no body.

---

### `PUT /auth/password` 🔒
Change password.

**Body**
```json
{
  "currentPassword": "old-password",
  "newPassword": "new-min8chars"
}
```

**Response `204`**

**Errors**
| Code | Reason |
|---|---|
| `INVALID_CREDENTIALS` | `currentPassword` is wrong |
| `VALIDATION_ERROR` | New password too short |

---

## 3. Users

### `GET /users/me` 🔒
Fetch your own profile.

**Response `200`**
```json
{
  "id": "uuid",
  "name": "Mohak",
  "email": "mohak@example.com",
  "avatarUrl": null,
  "createdAt": "2024-03-01T00:00:00.000Z",
  "updatedAt": "2024-03-01T00:00:00.000Z"
}
```

---

### `PUT /users/me` 🔒
Update your profile. All fields optional.

**Body**
```json
{
  "name": "Mohak G",
  "avatarUrl": "https://cdn.example.com/avatars/abc.jpg"
}
```

**Response `200`** — updated user object.

---

### `GET /users/me/balances` 🔒
Your net balance with every person across **all groups** you share with them.
This is the top-level "what do I owe / who owes me" view.

**Query params**
| Param | Description |
|---|---|
| `type` | `household` \| `personal` — filter to one group type |

**Response `200`**
```json
{
  "totalOwed": "850.00",
  "totalYouOwe": "350.00",
  "net": "500.00",
  "byPerson": [
    {
      "user": { "id": "uuid", "name": "Raj", "avatarUrl": null },
      "netAmount": "-350.00",
      "breakdown": [
        { "groupId": "uuid", "groupName": "Flat 4B",     "amount": "-200.00" },
        { "groupId": "uuid", "groupName": "Raj & Mohak", "amount": "-150.00" }
      ]
    },
    {
      "user": { "id": "uuid", "name": "Priya", "avatarUrl": null },
      "netAmount": "850.00",
      "breakdown": [
        { "groupId": "uuid", "groupName": "Flat 4B", "amount": "850.00" }
      ]
    }
  ]
}
```
`netAmount`: **negative** = you owe them. **Positive** = they owe you.
`totalOwed`: sum of all positive `netAmount` values (others owe you).
`totalYouOwe`: absolute sum of all negative `netAmount` values.

---

### `GET /users/me/balances/export.csv` 🔒
Download the same data as `GET /users/me/balances` as a CSV file.

**Query params**
| Param | Description |
|---|---|
| `type` | `household` \| `personal` — filter to one group type |

**Response `200`**
- Content type: `text/csv; charset=utf-8`
- Download: `Content-Disposition: attachment`

**Example**
```bash
curl -L -H "Authorization: Bearer <token>" \
  "http://localhost:3000/users/me/balances/export.csv" \
  -o my-balances.csv
```

---

### `GET /users/me/settlements/suggestions` 🔒
Cross-group settle-up actions involving the authenticated user.
Use this to power a top-level "what should I pay / collect next" view.

**Query params**
| Param | Description |
|---|---|
| `type` | `household` \| `personal` — filter to one group type |

**Response `200`**
```json
{
  "asOf": "2024-03-15T12:00:00.000Z",
  "totalYouPay": "350.00",
  "totalYouReceive": "850.00",
  "net": "500.00",
  "groupCount": 2,
  "transactionCount": 3,
  "groups": [
    {
      "group": { "id": "uuid", "name": "Flat 4B", "type": "household" },
      "suggestions": [
        {
          "from": { "id": "uuid-A", "name": "Mohak", "avatarUrl": null },
          "to": { "id": "uuid-B", "name": "Raj", "avatarUrl": null },
          "amount": "350.00",
          "direction": "you_pay",
          "involvesYou": true,
          "summary": "Pay Raj 350.00"
        }
      ]
    }
  ]
}
```

`direction`: `you_pay` means you should pay someone; `you_receive` means someone should pay you.

---

### `GET /users/me/people` 🔒
List every person you share at least one group with, with your cross-group net balance against each person.
Use this to power a "People" or "Friends" screen.

**Response `200`**
```json
[
  {
    "user": { "id": "uuid", "name": "Raj", "avatarUrl": null },
    "totalYouOwe": "350.00",
    "totalTheyOwe": "0.00",
    "net": "-350.00",
    "sharedGroupCount": 2,
    "lastActivityAt": "2024-03-15T10:00:00.000Z"
  },
  {
    "user": { "id": "uuid", "name": "Priya", "avatarUrl": null },
    "totalYouOwe": "0.00",
    "totalTheyOwe": "850.00",
    "net": "850.00",
    "sharedGroupCount": 1,
    "lastActivityAt": "2024-03-14T18:00:00.000Z"
  }
]
```
`net`: **negative** = you owe them. **Positive** = they owe you.

---

### `GET /users/me/people/:userId` 🔒
Full person-detail expense screen for one person across all groups you share with them.
Includes per-group balances, recent expenses involving either/both users in shared groups, and recent settlements between the two users.

**Response `200`**
```json
{
  "user": {
    "id": "uuid",
    "name": "Raj",
    "email": "raj@example.com",
    "avatarUrl": null
  },
  "summary": {
    "totalYouOwe": "350.00",
    "totalTheyOwe": "850.00",
    "net": "500.00"
  },
  "groups": [
    {
      "groupId": "uuid",
      "groupName": "Flat 4B",
      "type": "household",
      "youOwe": "350.00",
      "theyOwe": "0.00",
      "net": "-350.00",
      "canSettle": true
    }
  ],
  "recentExpenses": [
    {
      "id": "uuid",
      "group": { "id": "uuid", "name": "Flat 4B", "type": "household" },
      "description": "Weekly groceries",
      "amount": "1200.00",
      "date": "2024-03-15",
      "paidBy": { "id": "uuid", "name": "Mohak" },
      "yourShare": "300.00",
      "theirShare": "300.00",
      "createdAt": "2024-03-15T10:00:00.000Z"
    }
  ],
  "recentSettlements": [
    {
      "id": "uuid",
      "group": { "id": "uuid", "name": "Flat 4B", "type": "household" },
      "paidBy": { "id": "uuid", "name": "Raj" },
      "paidTo": { "id": "uuid", "name": "Mohak" },
      "amount": "350.00",
      "date": "2024-03-20",
      "createdAt": "2024-03-20T14:00:00.000Z"
    }
  ]
}
```

**Errors**
| Code | Reason |
|---|---|
| `NOT_FOUND` | User does not exist or you do not share any groups |

---

### `POST /users/me/people/:userId/settle` 🔒
Settle all non-zero balances with this person across shared groups.
Creates one settlement per shared group where your net balance with that person is non-zero.

If `net` is negative in a group, you pay them. If `net` is positive, they pay you.

**Response `201`**
```json
{
  "settlements": [
    {
      "id": "uuid",
      "paidBy": { "id": "uuid", "name": "Mohak", "avatarUrl": null },
      "paidTo": { "id": "uuid", "name": "Raj", "avatarUrl": null },
      "amount": "350.00",
      "date": "2024-03-20",
      "notes": "Settle all with person",
      "createdAt": "2024-03-20T14:00:00.000Z"
    }
  ]
}
```

**Errors**
| Code | Reason |
|---|---|
| `NOT_FOUND` | User does not exist or you do not share any groups |
| `UNPROCESSABLE` | Net balance between you and this user is already zero across all shared groups |

---

### `GET /users/me/analytics` 🔒
Cross-group personal spending summary.

**Query params**
| Param | Default | Description |
|---|---|---|
| `from` | start of current month | `YYYY-MM-DD` |
| `to` | today | `YYYY-MM-DD` |

**Response `200`**
```json
{
  "period": { "from": "2024-03-01", "to": "2024-03-31" },
  "totalPaid": "5600.00",
  "totalOwed": "2800.00",
  "net": "2800.00",
  "byGroup": [
    {
      "groupId": "uuid",
      "groupName": "Flat 4B",
      "type": "household",
      "paid": "4800.00",
      "owed": "2200.00"
    }
  ],
  "byCategory": [
    { "categoryId": "uuid", "name": "Groceries", "icon": "🛒", "paid": "2000.00", "owed": "800.00" }
  ]
}
```

---

### `GET /users/me/analytics/trends` 🔒
Chart-ready personal trends across all groups you belong to.
Use this for personal month-wise spend, date-wise spend, net cashflow, category stacks, and group comparison charts.

**Query params**
| Param | Default | Description |
|---|---|---|
| `from` | start of current month | `YYYY-MM-DD` |
| `to` | today | `YYYY-MM-DD` |
| `by` | `month` | `day` \| `week` \| `month` |
| `type` | — | Optional group type filter: `household` \| `personal` |

**Response `200`**
```json
{
  "by": "month",
  "period": { "from": "2024-01-01", "to": "2024-03-31" },
  "buckets": [
    {
      "key": "2024-03",
      "label": "2024-03",
      "paid": "5600.00",
      "owed": "2800.00",
      "net": "2800.00",
      "expenseCount": 18,
      "byCategory": [
        { "categoryId": "uuid", "name": "Groceries", "icon": "🛒", "paid": "2000.00", "owed": "800.00" }
      ],
      "byGroup": [
        { "groupId": "uuid", "groupName": "Flat 4B", "type": "household", "paid": "4800.00", "owed": "2200.00" }
      ]
    }
  ]
}
```

Chart ideas:
- Line chart: `owed` over time.
- Bar chart: `paid`, `owed`, or `net` by month.
- Stacked bar: `byCategory[].owed` or `byGroup[].owed`.

---

### `GET /users/me/analytics/export.csv` 🔒
Download the same data as `GET /users/me/analytics` as a CSV file.

**Query params**
| Param | Default | Description |
|---|---|---|
| `from` | start of current month | `YYYY-MM-DD` |
| `to` | today | `YYYY-MM-DD` |

**Response `200`**
- Content type: `text/csv; charset=utf-8`
- Download: `Content-Disposition: attachment`

**Example**
```bash
curl -L -H "Authorization: Bearer <token>" \
  "http://localhost:3000/users/me/analytics/export.csv?from=2024-03-01&to=2024-03-31" \
  -o my-analytics.csv
```

---

## 4. Groups

### `POST /groups` 🔒
Create a group. The creator is automatically added as `admin`.

**Body**
```json
{
  "name": "Flat 4B",
  "description": "Our apartment on 4th floor",
  "type": "household"
}
```
`type`: `"household"` (default) | `"personal"`

Use `household` for the shared apartment. Use `personal` for sub-groups (e.g. two roommates who split personal expenses together).

**Response `201`**
```json
{
  "id": "uuid",
  "name": "Flat 4B",
  "type": "household",
  "description": "Our apartment on 4th floor",
  "createdBy": { "id": "uuid", "name": "Mohak" },
  "members": [
    { "userId": "uuid", "name": "Mohak", "email": "mohak@example.com", "role": "admin", "joinedAt": "2024-03-01T00:00:00.000Z" }
  ],
  "createdAt": "2024-03-01T00:00:00.000Z"
}
```

---

### `GET /groups` 🔒
All groups you belong to, with your net balance in each.

**Query params**
| Param | Description |
|---|---|
| `type` | `household` \| `personal` |

**Response `200`**
```json
[
  {
    "id": "uuid",
    "name": "Flat 4B",
    "type": "household",
    "description": "Our apartment",
    "memberCount": 4,
    "yourRole": "admin",
    "yourBalance": "-450.00",
    "lastActivityAt": "2024-03-14T18:00:00.000Z"
  },
  {
    "id": "uuid",
    "name": "Raj & Mohak",
    "type": "personal",
    "description": null,
    "memberCount": 2,
    "yourRole": "admin",
    "yourBalance": "-150.00",
    "lastActivityAt": "2024-03-10T12:00:00.000Z"
  }
]
```
`yourBalance`: negative = you owe the group net, positive = the group owes you net.

---

### `GET /groups/:groupId` 🔒
Full group detail with members.

**Response `200`**
```json
{
  "id": "uuid",
  "name": "Flat 4B",
  "type": "household",
  "description": "Our apartment",
  "createdBy": { "id": "uuid", "name": "Mohak" },
  "members": [
    {
      "userId": "uuid",
      "name": "Mohak",
      "email": "mohak@example.com",
      "avatarUrl": null,
      "role": "admin",
      "joinedAt": "2024-03-01T00:00:00.000Z"
    }
  ],
  "createdAt": "2024-03-01T00:00:00.000Z",
  "updatedAt": "2024-03-01T00:00:00.000Z"
}
```

---

### `PUT /groups/:groupId` 🔒 `admin`

**Body** (all optional)
```json
{
  "name": "Flat 4B (updated)",
  "description": "New description"
}
```

**Response `200`** — updated group object.

---

### `DELETE /groups/:groupId` 🔒 `admin`
Permanently delete the group and all associated data.

**Blocked if:** any member has an outstanding non-zero balance. Settle all debts first.

**Response `204`**

**Errors**
| Code | Reason |
|---|---|
| `UNSETTLED_BALANCES` | Outstanding balances exist — `422` |

---

## 5. Members

### `POST /groups/:groupId/members` 🔒 `admin`
Add a user to the group by email. The user must already have an account.

**Body**
```json
{
  "email": "raj@example.com",
  "role": "member"
}
```
`role`: `"member"` (default) | `"admin"`

**Response `200`** — full updated member list (same shape as `GET /groups/:groupId`'s `members` array).

**Errors**
| Code | Reason |
|---|---|
| `NOT_FOUND` | No account with that email |
| `CONFLICT` | User is already a member |

---

### `PATCH /groups/:groupId/members/:userId` 🔒 `admin`
Change a member's role.

**Body**
```json
{ "role": "admin" }
```

**Response `200`** — updated member entry.

**Errors**
| Code | Reason |
|---|---|
| `FORBIDDEN` | Demoting yourself when you're the only admin |

---

### `DELETE /groups/:groupId/members/:userId` 🔒 `admin`
Remove a member from the group.

Members can remove themselves (leave group). Only admins can remove others.

**Blocked if:** the member being removed has outstanding balances in the group.

**Response `204`**

**Errors**
| Code | Reason |
|---|---|
| `FORBIDDEN` | Trying to remove another member without admin role |
| `FORBIDDEN` | Removing yourself as the only admin (transfer role first) |
| `UNSETTLED_BALANCES` | Member has outstanding debts — `422` |

---

## 6. Categories

Categories are either **system-wide** (`groupId: null`) or **group-custom** (`groupId: <uuid>`).
System categories cannot be edited or deleted.

### `GET /categories` 🔒
List system-wide default categories.

**Response `200`**
```json
[
  { "id": "uuid", "name": "Rent",          "icon": "🏠", "color": "#EF4444", "groupId": null },
  { "id": "uuid", "name": "Groceries",     "icon": "🛒", "color": "#10B981", "groupId": null },
  { "id": "uuid", "name": "Utilities",     "icon": "⚡", "color": "#F59E0B", "groupId": null },
  { "id": "uuid", "name": "Internet",      "icon": "📶", "color": "#3B82F6", "groupId": null },
  { "id": "uuid", "name": "Food & Dining", "icon": "🍕", "color": "#F97316", "groupId": null },
  { "id": "uuid", "name": "Transport",     "icon": "🚗", "color": "#8B5CF6", "groupId": null },
  { "id": "uuid", "name": "Entertainment", "icon": "🎬", "color": "#EC4899", "groupId": null },
  { "id": "uuid", "name": "Travel",        "icon": "✈️", "color": "#06B6D4", "groupId": null },
  { "id": "uuid", "name": "Household",     "icon": "🧹", "color": "#84CC16", "groupId": null },
  { "id": "uuid", "name": "Subscriptions", "icon": "📱", "color": "#6366F1", "groupId": null },
  { "id": "uuid", "name": "Misc",          "icon": "📦", "color": "#9CA3AF", "groupId": null }
]
```

---

### `GET /groups/:groupId/categories` 🔒
System categories + this group's custom categories, merged.

**Response `200`** — same shape as above but includes entries where `groupId` is set.

---

### `POST /groups/:groupId/categories` 🔒 `admin`
Create a custom category for this group.

**Body**
```json
{
  "name": "Beer Fund",
  "icon": "🍺",
  "color": "#F59E0B"
}
```

**Response `201`**
```json
{ "id": "uuid", "name": "Beer Fund", "icon": "🍺", "color": "#F59E0B", "groupId": "uuid" }
```

---

### `PUT /groups/:groupId/categories/:categoryId` 🔒 `admin`
Edit a group-custom category. Cannot edit system categories.

**Body** (all optional)
```json
{ "name": "Drinks", "icon": "🥂", "color": "#6366F1" }
```

---

### `DELETE /groups/:groupId/categories/:categoryId` 🔒 `admin`
Delete a group-custom category. Expenses in that category will have `categoryId` set to `null`.

---

## 7. Tags

Tags are free-form labels per group (e.g. "Goa trip", "Diwali party"). Expenses can have multiple tags.

### `GET /groups/:groupId/tags` 🔒

**Response `200`**
```json
[
  { "id": "uuid", "name": "Goa trip",     "color": "#06B6D4", "expenseCount": 12 },
  { "id": "uuid", "name": "Diwali party", "color": "#F59E0B", "expenseCount": 5  }
]
```
`expenseCount`: how many expenses currently use this tag — useful to show before deletion.

---

### `POST /groups/:groupId/tags` 🔒

**Body**
```json
{ "name": "Goa trip", "color": "#06B6D4" }
```

**Response `201`**
```json
{ "id": "uuid", "name": "Goa trip", "color": "#06B6D4", "expenseCount": 0 }
```

---

### `PUT /groups/:groupId/tags/:tagId` 🔒

**Body** (all optional)
```json
{ "name": "Goa 2024", "color": "#10B981" }
```

---

### `DELETE /groups/:groupId/tags/:tagId` 🔒
Removes the tag and detaches it from all expenses. Expenses themselves are not deleted.

**Response `204`**

---

## 8. Expenses

### `POST /groups/:groupId/expenses` 🔒
Create an expense. Caller must be a group member.

**Body**
```json
{
  "description": "Weekly groceries",
  "amount": "1200.00",
  "paidById": "uuid-of-payer",
  "date": "2024-03-15",
  "categoryId": "uuid",
  "splitType": "equal",
  "participants": [
    { "userId": "uuid-A" },
    { "userId": "uuid-B" },
    { "userId": "uuid-C" },
    { "userId": "uuid-D" }
  ],
  "tagIds": ["uuid-tag1"],
  "notes": "Big shop before the trip",
  "isRecurring": false
}
```

**`participants` by split type:**

| `splitType` | What to include per participant | Validation |
|---|---|---|
| `equal` | `{ "userId": "uuid" }` | All listed users get equal share |
| `exact` | `{ "userId": "uuid", "shareAmount": "300.00" }` | `shareAmount` values must sum to `amount` |
| `percentage` | `{ "userId": "uuid", "splitInput": "25" }` | `splitInput` values must sum to `100` |
| `shares` | `{ "userId": "uuid", "splitInput": "2" }` | Any positive integers; share = `(input / total_inputs) × amount` |

**Recurring expense fields** (only when `isRecurring: true`):
```json
{
  "isRecurring": true,
  "recurInterval": "monthly",
  "recurAnchor": "2024-04-01"
}
```
`recurInterval`: `"weekly"` | `"monthly"` | `"yearly"`
`recurAnchor`: next due date — the date this expense should auto-appear next

**Response `201`** — full expense object (see GET detail below).

**Errors**
| Code | Reason |
|---|---|
| `VALIDATION_ERROR` | Missing required fields |
| `UNPROCESSABLE` | Split doesn't sum to total; participant not a group member |
| `NOT_FOUND` | `paidById` or any `userId` in participants not found |

---

### `POST /groups/:groupId/expenses/preview` 🔒
Dry-run: calculate how an expense would be split without saving it.
Same body as POST. Returns computed shares but persists nothing.

**Response `200`**
```json
{
  "amount": "1200.00",
  "splitType": "equal",
  "splits": [
    { "userId": "uuid-A", "name": "Mohak", "shareAmount": "300.00" },
    { "userId": "uuid-B", "name": "Raj",   "shareAmount": "300.00" },
    { "userId": "uuid-C", "name": "Priya", "shareAmount": "300.00" },
    { "userId": "uuid-D", "name": "Karan", "shareAmount": "300.00" }
  ]
}
```

---

### `GET /groups/:groupId/expenses` 🔒
List expenses with filters and sorting.

**Query params**
| Param | Description |
|---|---|
| `categoryId` | Filter by category UUID |
| `tagId` | Filter by tag UUID |
| `paidById` | Expenses paid by this user |
| `involvesId` | User appears as a participant (payer or split recipient) |
| `splitType` | `equal` \| `exact` \| `percentage` \| `shares` |
| `from` | Start date inclusive (`YYYY-MM-DD`) |
| `to` | End date inclusive (`YYYY-MM-DD`) |
| `q` | Full-text search on `description` |
| `sort` | `date` (default) \| `amount` \| `createdAt` |
| `order` | `desc` (default) \| `asc` |
| `page`, `limit` | Pagination |

**Response `200`**
```json
{
  "data": [
    {
      "id": "uuid",
      "description": "Weekly groceries",
      "amount": "1200.00",
      "date": "2024-03-15",
      "splitType": "equal",
      "paidBy": { "id": "uuid", "name": "Mohak", "avatarUrl": null },
      "category": { "id": "uuid", "name": "Groceries", "icon": "🛒", "color": "#10B981" },
      "tags": [{ "id": "uuid", "name": "Goa trip", "color": "#06B6D4" }],
      "myShare": "300.00",
      "participants": [
        { "userId": "uuid", "name": "Mohak", "avatarUrl": null, "shareAmount": "300.00" },
        { "userId": "uuid", "name": "Raj",   "avatarUrl": null, "shareAmount": "300.00" }
      ],
      "isRecurring": false,
      "createdAt": "2024-03-15T10:00:00.000Z"
    }
  ],
  "meta": { "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
}
```
`myShare`: how much the authenticated user owes for this expense (0 if not a participant).

---

### `GET /groups/:groupId/expenses/export.csv` 🔒
Download the same data as `GET /groups/:groupId/expenses` as a CSV file.

**Query params**
Same as `GET /groups/:groupId/expenses` (filters + sort/order). Pagination params are ignored for export.

**Response `200`**
- Content type: `text/csv; charset=utf-8`
- Download: `Content-Disposition: attachment`

**Example**
```bash
curl -L -H "Authorization: Bearer <token>" \
  "http://localhost:3000/groups/<groupId>/expenses/export.csv?from=2024-03-01&to=2024-03-31&sort=date&order=desc" \
  -o expenses.csv
```

---

### `GET /groups/:groupId/expenses/:expenseId` 🔒
Full detail of a single expense.

**Response `200`**
```json
{
  "id": "uuid",
  "description": "Weekly groceries",
  "amount": "1200.00",
  "date": "2024-03-15",
  "splitType": "equal",
  "notes": "Big shop",
  "paidBy": { "id": "uuid", "name": "Mohak", "avatarUrl": null },
  "category": { "id": "uuid", "name": "Groceries", "icon": "🛒", "color": "#10B981" },
  "tags": [{ "id": "uuid", "name": "Goa trip", "color": "#06B6D4" }],
  "participants": [
    {
      "userId": "uuid",
      "name": "Mohak",
      "avatarUrl": null,
      "shareAmount": "300.00",
      "splitInput": null
    }
  ],
  "isRecurring": false,
  "recurInterval": null,
  "recurAnchor": null,
  "createdBy": { "id": "uuid", "name": "Mohak" },
  "createdAt": "2024-03-15T10:00:00.000Z",
  "updatedAt": "2024-03-15T10:00:00.000Z"
}
```

---

### `PUT /groups/:groupId/expenses/:expenseId` 🔒
Edit an expense. Only the creator or a group admin can edit.
Same body shape as POST. All participant shares are recomputed from scratch.

**Response `200`** — updated expense object.

**Errors**
| Code | Reason |
|---|---|
| `FORBIDDEN` | Not the creator and not an admin |
| `UNPROCESSABLE` | Split validation fails |

---

### `DELETE /groups/:groupId/expenses/:expenseId` 🔒
Only the creator or a group admin can delete.

**Response `204`**

---

### `GET /groups/:groupId/expenses/recurring` 🔒
List all recurring expense templates in the group.

**Response `200`** — paginated expense list filtered to `isRecurring: true`, with next due date.

---

## 9. Balances

Balances are always **computed live** from expenses and settlements — never stored. This guarantees they're always accurate.

**How balance is calculated:**
For each expense, the payer is owed by each other participant their `shareAmount`.
For each settlement, the `paidById` user reduces their debt to `paidToId` by `amount`.
Final balance between A and B = (sum of what B owes A from expenses) − (sum of settlements from B to A) − reversed direction settlements.

---

### `GET /groups/:groupId/balances` 🔒
Raw net balance between every pair of members.

**Response `200`**
```json
{
  "asOf": "2024-03-15T12:00:00.000Z",
  "balances": [
    {
      "from": { "id": "uuid-A", "name": "Mohak", "avatarUrl": null },
      "to":   { "id": "uuid-B", "name": "Raj",   "avatarUrl": null },
      "amount": "350.00"
    },
    {
      "from": { "id": "uuid-C", "name": "Priya", "avatarUrl": null },
      "to":   { "id": "uuid-A", "name": "Mohak", "avatarUrl": null },
      "amount": "200.00"
    }
  ]
}
```
Each entry: `from` owes `to` that `amount`. Only non-zero pairs included.

---

### `GET /groups/:groupId/balances/simplified` 🔒
Debt-minimized settlement plan — fewest transactions to clear all balances.

For example, if Mohak owes Raj ₹300 and Raj owes Priya ₹300, this returns just: Mohak → Priya ₹300 (Raj is cut out of the loop).

**Response `200`** — same shape as `/balances`.

For a user-facing version with summaries and "you pay / you receive" direction, use `GET /groups/:groupId/settlements/suggestions`.

---

### `GET /groups/:groupId/balances/me` 🔒
Your balances within this specific group only.

**Response `200`**
```json
{
  "groupId": "uuid",
  "youAreOwed": "850.00",
  "youOwe": "350.00",
  "net": "500.00",
  "detail": [
    {
      "user": { "id": "uuid", "name": "Raj", "avatarUrl": null },
      "youOwe": "350.00",
      "theyOwe": "0.00",
      "net": "-350.00"
    },
    {
      "user": { "id": "uuid", "name": "Priya", "avatarUrl": null },
      "youOwe": "0.00",
      "theyOwe": "850.00",
      "net": "850.00"
    }
  ]
}
```

---

## 10. Settlements

A settlement records that one person actually paid another to reduce a balance.
It does **not** require the amount to match the outstanding balance exactly — partial settlements are allowed.

---

### `POST /groups/:groupId/settlements` 🔒
Record a payment.

**Query params**
| Param | Description |
|---|---|
| `includeSuggestions` | Set to `true` to return fresh group settlement suggestions along with the settlement |

**Body**
```json
{
  "paidById": "uuid-A",
  "paidToId": "uuid-B",
  "amount": "350.00",
  "date": "2024-03-20",
  "notes": "GPay transfer"
}
```

Both `paidById` and `paidToId` must be group members.

**Response `201`**
Default response:
```json
{
  "id": "uuid",
  "paidBy": { "id": "uuid", "name": "Mohak", "avatarUrl": null },
  "paidTo":  { "id": "uuid", "name": "Raj",   "avatarUrl": null },
  "amount": "350.00",
  "date": "2024-03-20",
  "notes": "GPay transfer",
  "createdAt": "2024-03-20T14:00:00.000Z"
}
```

With `?includeSuggestions=true`:
```json
{
  "settlement": {
    "id": "uuid",
    "paidBy": { "id": "uuid", "name": "Mohak", "avatarUrl": null },
    "paidTo": { "id": "uuid", "name": "Raj", "avatarUrl": null },
    "amount": "350.00",
    "date": "2024-03-20",
    "notes": "GPay transfer",
    "createdAt": "2024-03-20T14:00:00.000Z"
  },
  "settlementSuggestions": {
    "groupId": "uuid",
    "asOf": "2024-03-20T14:00:00.000Z",
    "transactionCount": 1,
    "totalAmount": "300.00",
    "suggestions": [],
    "yourSuggestions": []
  }
}
```

---

### `POST /groups/:groupId/settlements/settle-with/:userId` 🔒
One-click settle: automatically creates a settlement for the **exact simplified net amount** you owe or are owed by a specific user in this group.

No body required — the amount is computed from current balances.
Pass `?includeSuggestions=true` to receive fresh group suggestions along with the created settlement.

**Response `201`** — same shape as regular settlement creation.

**Errors**
| Code | Reason |
|---|---|
| `UNPROCESSABLE` | Net balance between you and this user is already zero |

---

### `GET /groups/:groupId/settlements/suggestions` 🔒
Debt-minimized settle-up plan for the group, with summaries tailored to the authenticated user.

**Response `200`**
```json
{
  "groupId": "uuid",
  "asOf": "2024-03-15T12:00:00.000Z",
  "transactionCount": 2,
  "totalAmount": "650.00",
  "suggestions": [
    {
      "from": { "id": "uuid-A", "name": "Mohak", "avatarUrl": null },
      "to": { "id": "uuid-B", "name": "Raj", "avatarUrl": null },
      "amount": "350.00",
      "direction": "you_pay",
      "involvesYou": true,
      "summary": "Pay Raj 350.00"
    },
    {
      "from": { "id": "uuid-C", "name": "Priya", "avatarUrl": null },
      "to": { "id": "uuid-B", "name": "Raj", "avatarUrl": null },
      "amount": "300.00",
      "direction": "other",
      "involvesYou": false,
      "summary": "Priya pays Raj 300.00"
    }
  ],
  "yourSuggestions": [
    {
      "from": { "id": "uuid-A", "name": "Mohak", "avatarUrl": null },
      "to": { "id": "uuid-B", "name": "Raj", "avatarUrl": null },
      "amount": "350.00",
      "direction": "you_pay",
      "involvesYou": true,
      "summary": "Pay Raj 350.00"
    }
  ]
}
```

`suggestions`: full group plan. `yourSuggestions`: only actions where you are payer or receiver.

---

### `POST /groups/:groupId/settlements/suggestions/record` 🔒
Record a payment directly from the current settle-up suggestions.
Use this instead of manually posting a settlement when the user taps a suggested action. It validates that the payer/receiver pair is still suggested, prevents over-recording, and returns fresh suggestions immediately.

**Body**
```json
{
  "paidById": "uuid-A",
  "paidToId": "uuid-B",
  "amount": "350.00",
  "date": "2024-03-20",
  "notes": "GPay transfer"
}
```

`amount`, `date`, and `notes` are optional. If `amount` is omitted, the full current suggested amount is recorded. Partial amounts are allowed as long as they do not exceed the current suggestion.

**Response `201`**
```json
{
  "settlement": {
    "id": "uuid",
    "paidBy": { "id": "uuid-A", "name": "Mohak", "avatarUrl": null },
    "paidTo": { "id": "uuid-B", "name": "Raj", "avatarUrl": null },
    "amount": "350.00",
    "date": "2024-03-20",
    "notes": "GPay transfer",
    "createdAt": "2024-03-20T14:00:00.000Z"
  },
  "previousSuggestion": {
    "from": { "id": "uuid-A", "name": "Mohak", "avatarUrl": null },
    "to": { "id": "uuid-B", "name": "Raj", "avatarUrl": null },
    "amount": "350.00",
    "direction": "you_pay",
    "involvesYou": true,
    "summary": "Pay Raj 350.00"
  },
  "settlementSuggestions": {
    "groupId": "uuid",
    "asOf": "2024-03-20T14:00:00.000Z",
    "transactionCount": 0,
    "totalAmount": "0.00",
    "suggestions": [],
    "yourSuggestions": []
  }
}
```

**Errors**
| Code | Reason |
|---|---|
| `SUGGESTION_NOT_FOUND` | The payer/receiver pair is no longer a current suggestion |
| `UNPROCESSABLE` | Amount exceeds the current suggestion |

Both suggestion endpoints return `Cache-Control: no-store`; clients should still update local state from this response or refetch suggestions after any manual `POST /settlements`.

---

### `GET /groups/:groupId/settlements` 🔒
List settlements in the group.

**Query params**
| Param | Description |
|---|---|
| `userId` | Settlements where this user is either payer or recipient |
| `from`, `to` | Date range |
| `sort` | `date` (default) \| `amount` |
| `order` | `desc` (default) \| `asc` |
| `page`, `limit` | Pagination |

**Response `200`**
```json
{
  "data": [
    {
      "id": "uuid",
      "paidBy": { "id": "uuid", "name": "Mohak" },
      "paidTo":  { "id": "uuid", "name": "Raj"   },
      "amount": "350.00",
      "date": "2024-03-20",
      "notes": "GPay",
      "createdAt": "2024-03-20T14:00:00.000Z"
    }
  ],
  "meta": { "total": 8, "page": 1, "limit": 20, "totalPages": 1 }
}
```

---

### `GET /groups/:groupId/settlements/export.csv` 🔒
Download the same data as `GET /groups/:groupId/settlements` as a CSV file.

**Query params**
Same as `GET /groups/:groupId/settlements` (filters + sort/order). Pagination params are ignored for export.

**Response `200`**
- Content type: `text/csv; charset=utf-8`
- Download: `Content-Disposition: attachment`

**Example**
```bash
curl -L -H "Authorization: Bearer <token>" \
  "http://localhost:3000/groups/<groupId>/settlements/export.csv?from=2024-03-01&to=2024-03-31" \
  -o settlements.csv
```

---

### `DELETE /groups/:groupId/settlements/:settlementId` 🔒
Only the creator or a group admin can delete.
Deleting a settlement re-opens the corresponding balance.

**Response `204`**

---

## 11. Budgets

Budgets are monthly limits for a group. A budget can either cover the full group month (`categoryId: null`) or one category.
Only group admins can create, update, or delete budgets. Any member can view budget progress.

### `GET /groups/:groupId/budgets` 🔒
List budgets and live spend progress.

**Query params**
| Param | Description |
|---|---|
| `month` | Optional `YYYY-MM` filter |

**Response `200`**
```json
{
  "data": [
    {
      "id": "uuid",
      "groupId": "uuid",
      "month": "2024-03",
      "category": { "id": "uuid", "name": "Groceries", "icon": "🛒", "color": "#10B981" },
      "amount": "8000.00",
      "spent": "6200.00",
      "remaining": "1800.00",
      "usedPct": "77.50",
      "status": "ok",
      "createdBy": { "id": "uuid", "name": "Mohak" },
      "createdAt": "2024-03-01T10:00:00.000Z",
      "updatedAt": "2024-03-01T10:00:00.000Z"
    }
  ]
}
```

`status`: `ok` below 80%, `warning` at 80% or higher, `over` when spend exceeds the budget.

---

### `PUT /groups/:groupId/budgets` 🔒
Create or update a budget for a month/category scope.

**Body**
```json
{
  "month": "2024-03",
  "categoryId": "uuid",
  "amount": "8000.00"
}
```

Use `categoryId: null` or omit `categoryId` for an overall group budget.

**Response `200`** — budget object with live progress, same shape as list item.

**Errors**
| Code | Reason |
|---|---|
| `FORBIDDEN` | Not a group admin |
| `VALIDATION_ERROR` | Invalid month or amount |
| `NOT_FOUND` | Category is not usable in this group |

---

### `DELETE /groups/:groupId/budgets/:budgetId` 🔒
Delete a budget. Existing expenses are not changed.

**Response `204`**

---

## 12. Analytics

### `GET /groups/:groupId/analytics/export.csv` 🔒
Download a group analytics report as a CSV file.
The CSV contains multiple sections (Summary, By Category, By Member, By Tag, Top Expenses).

**Query params**
| Param | Default | Description |
|---|---|---|
| `from` | start of current month | `YYYY-MM-DD` |
| `to` | today | `YYYY-MM-DD` |

**Response `200`**
- Content type: `text/csv; charset=utf-8`
- Download: `Content-Disposition: attachment`

**Example**
```bash
curl -L -H "Authorization: Bearer <token>" \
  "http://localhost:3000/groups/<groupId>/analytics/export.csv?from=2024-03-01&to=2024-03-31" \
  -o group-analytics.csv
```

### `GET /groups/:groupId/analytics/summary` 🔒
Overview for a time period — designed to power a group's stats screen.

**Query params**
| Param | Default | Description |
|---|---|---|
| `from` | start of current month | `YYYY-MM-DD` |
| `to` | today | `YYYY-MM-DD` |

**Response `200`**
```json
{
  "period": { "from": "2024-03-01", "to": "2024-03-31" },
  "totalSpend": "18400.00",
  "expenseCount": 34,
  "avgExpenseAmount": "541.18",
  "vsLastPeriod": {
    "period": { "from": "2024-01-30", "to": "2024-02-29" },
    "totalSpend": "16200.00",
    "changeAmount": "2200.00",
    "changePct": "13.58",
    "direction": "up"
  },
  "byCategory": [
    {
      "categoryId": "uuid",
      "name": "Rent",
      "icon": "🏠",
      "color": "#EF4444",
      "total": "8000.00",
      "count": 1,
      "pct": "43.48"
    },
    {
      "categoryId": "uuid",
      "name": "Groceries",
      "icon": "🛒",
      "color": "#10B981",
      "total": "4800.00",
      "count": 12,
      "pct": "26.09"
    }
  ],
  "byMember": [
    {
      "userId": "uuid",
      "name": "Mohak",
      "avatarUrl": null,
      "paid": "10000.00",
      "owes": "4600.00",
      "net": "5400.00",
      "expenseCount": 15
    }
  ],
  "topExpenses": [
    {
      "id": "uuid",
      "description": "March Rent",
      "amount": "8000.00",
      "date": "2024-03-01",
      "category": { "name": "Rent", "icon": "🏠" }
    }
  ]
}
```
`vsLastPeriod`: compares an equally-sized period immediately before `from`.
`byCategory.pct`: percentage of total spend.
`byMember.net`: positive = they overpaid (are owed), negative = they underpaid (owe).
`topExpenses`: top 5 largest expenses in the period.

---

### `GET /groups/:groupId/analytics/comparison` 🔒
Compare a selected period against the immediately previous equivalent period.
For example, March 1-31 compares against January 30-February 29 because the period length is 31 days.

**Query params**
| Param | Default | Description |
|---|---|---|
| `from` | start of current month | `YYYY-MM-DD` |
| `to` | today | `YYYY-MM-DD` |

**Response `200`**
```json
{
  "current": {
    "period": { "from": "2024-03-01", "to": "2024-03-31" },
    "totalSpend": "18400.00",
    "expenseCount": 34,
    "avgExpenseAmount": "541.18"
  },
  "previous": {
    "period": { "from": "2024-01-30", "to": "2024-02-29" },
    "totalSpend": "16200.00",
    "expenseCount": 30,
    "avgExpenseAmount": "540.00"
  },
  "changeAmount": "2200.00",
  "changePct": "13.58",
  "direction": "up"
}
```

Use this for KPI cards like "Spending is up 13.58% vs previous period".

---

### `GET /groups/:groupId/analytics/trends` 🔒
Spending over time bucketed by day, week, or month. Powers line charts, bar charts, and stacked category charts.

**Query params**
| Param | Default | Description |
|---|---|---|
| `from` | start of current month | `YYYY-MM-DD` |
| `to` | today | `YYYY-MM-DD` |
| `by` | `month` | `day` \| `week` \| `month` |
| `categoryId` | — | Scope to one category |
| `memberId` | — | Scope to expenses paid by or involving one member |

**Response `200`**
```json
{
  "by": "month",
  "period": { "from": "2023-10-01", "to": "2024-03-31" },
  "buckets": [
    {
      "label": "2023-10",
      "key": "2023-10",
      "total": "15200.00",
      "expenseCount": 28,
      "byCategory": [
        { "categoryId": "uuid", "name": "Rent",      "total": "8000.00" },
        { "categoryId": "uuid", "name": "Groceries", "total": "3800.00" }
      ]
    },
    {
      "label": "Nov 2023",
      "key": "2023-11",
      "total": "14800.00",
      "expenseCount": 25,
      "byCategory": [...]
    }
  ]
}
```
Only buckets with spend are returned. The frontend can fill empty buckets if a continuous chart axis is needed.

---

### `GET /groups/:groupId/analytics/categories/trends` 🔒
Category spend over time. Use this for stacked bars, category line charts, and "fastest growing category" UI.

**Query params**
| Param | Default | Description |
|---|---|---|
| `from` | start of current month | `YYYY-MM-DD` |
| `to` | today | `YYYY-MM-DD` |
| `by` | `month` | `day` \| `week` \| `month` |

**Response `200`**
```json
{
  "by": "month",
  "period": { "from": "2024-01-01", "to": "2024-03-31" },
  "categories": [
    {
      "category": { "id": "uuid", "name": "Groceries", "icon": "🛒", "color": "#10B981" },
      "total": "12400.00",
      "trend": "up",
      "changePct": "21.43",
      "buckets": [
        { "key": "2024-01", "label": "2024-01", "total": "3800.00", "expenseCount": 10 },
        { "key": "2024-02", "label": "2024-02", "total": "4100.00", "expenseCount": 11 },
        { "key": "2024-03", "label": "2024-03", "total": "4500.00", "expenseCount": 12 }
      ]
    }
  ]
}
```

---

### `GET /groups/:groupId/analytics/categories` 🔒
Category-level breakdown with trends and top spenders. Powers a category drill-down screen.

**Query params**
| Param | Default | Description |
|---|---|---|
| `from` | start of current month | |
| `to` | today | |

**Response `200`**
```json
{
  "period": { "from": "2024-03-01", "to": "2024-03-31" },
  "categories": [
    {
      "categoryId": "uuid",
      "name": "Groceries",
      "icon": "🛒",
      "color": "#10B981",
      "total": "4800.00",
      "expenseCount": 12,
      "avgPerExpense": "400.00",
      "topSpenders": [
        { "userId": "uuid", "name": "Mohak", "avatarUrl": null, "paid": "2400.00", "owes": "1200.00" }
      ],
      "monthlyAvg": "4200.00",
      "trend": "up",
      "changePct": "14.29"
    }
  ]
}
```
`monthlyAvg`: period total averaged over the number of months represented by the selected date range.
`trend`: `"up"` | `"down"` | `"stable"` — compared to the previous equivalent period.

---

### `GET /groups/:groupId/analytics/members` 🔒
Per-member breakdown for the period. Powers a fairness/contribution screen.

**Query params**
| Param | Default | Description |
|---|---|---|
| `from` | start of current month | |
| `to` | today | |

**Response `200`**
```json
{
  "period": { "from": "2024-03-01", "to": "2024-03-31" },
  "groupTotal": "18400.00",
  "equalShare": "4600.00",
  "members": [
    {
      "userId": "uuid",
      "name": "Mohak",
      "avatarUrl": null,
      "paid": "10000.00",
      "owes": "4600.00",
      "net": "5400.00",
      "expenseCount": 15,
      "fairnessScore": "2.17",
      "topCategories": [
        { "categoryId": "uuid", "name": "Groceries", "icon": "🛒", "total": "4800.00", "expenseCount": 12 }
      ]
    }
  ]
}
```
`equalShare`: what each member would pay if burden were split perfectly equally.
`fairnessScore`: `paid / equalShare`. Above `1.0` means this person is carrying more than their share.

---

### `GET /groups/:groupId/analytics/members/trends` 🔒
Member paid/owed/net over time.
Use this for contribution trend lines and paid-vs-owed grouped bars.

**Query params**
| Param | Default | Description |
|---|---|---|
| `from` | start of current month | `YYYY-MM-DD` |
| `to` | today | `YYYY-MM-DD` |
| `by` | `month` | `day` \| `week` \| `month` |

**Response `200`**
```json
{
  "by": "month",
  "period": { "from": "2024-01-01", "to": "2024-03-31" },
  "members": [
    {
      "user": { "id": "uuid", "name": "Mohak", "avatarUrl": null },
      "paid": "10000.00",
      "owes": "4600.00",
      "net": "5400.00",
      "buckets": [
        {
          "key": "2024-03",
          "label": "2024-03",
          "paid": "4200.00",
          "owes": "1800.00",
          "net": "2400.00",
          "expenseCount": 8
        }
      ]
    }
  ]
}
```

---

### `GET /groups/:groupId/analytics/tags` 🔒
Spending breakdown per tag. Useful for trip/event cost tracking.

**Query params**: `from`, `to`

**Response `200`**
```json
{
  "period": { "from": "2024-03-01", "to": "2024-03-31" },
  "tags": [
    {
      "tagId": "uuid",
      "name": "Goa trip",
      "color": "#06B6D4",
      "total": "12400.00",
      "expenseCount": 18,
      "byMember": [
        { "userId": "uuid", "name": "Mohak", "paid": "5000.00", "owes": "3100.00" }
      ],
      "byCategory": [
        { "name": "Food & Dining", "total": "4800.00" },
        { "name": "Transport",     "total": "3600.00" }
      ]
    }
  ]
}
```

---

### `GET /groups/:groupId/analytics/patterns` 🔒
Behavioral spending patterns for a period.
Use this for weekday heatmaps, highest-spend days, and recurring-vs-one-off cards.

**Query params**: `from`, `to`

**Response `200`**
```json
{
  "period": { "from": "2024-03-01", "to": "2024-03-31" },
  "byWeekday": [
    {
      "weekday": "Friday",
      "weekdayIndex": 5,
      "total": "6200.00",
      "expenseCount": 9,
      "avgPerExpense": "688.89",
      "pct": "33.70"
    }
  ],
  "byDayOfMonth": [
    { "day": 1, "total": "8000.00", "expenseCount": 1, "avgPerExpense": "8000.00" }
  ],
  "highestSpendDays": [
    { "date": "2024-03-01", "total": "8000.00", "expenseCount": 1 }
  ],
  "recurringVsOneOff": [
    { "type": "recurring", "total": "8000.00", "expenseCount": 1 },
    { "type": "one_off", "total": "10400.00", "expenseCount": 33 }
  ]
}
```

---

### `GET /groups/:groupId/analytics/anomalies` 🔒
Rule-based anomaly detection for unusual expenses and category spikes.
This does not use AI; it compares expenses and category totals against the selected and previous equivalent periods.

**Query params**: `from`, `to`

**Response `200`**
```json
{
  "period": { "from": "2024-03-01", "to": "2024-03-31" },
  "unusualExpenses": [
    {
      "id": "uuid",
      "description": "Large grocery run",
      "amount": "3200.00",
      "date": "2024-03-18",
      "category": { "id": "uuid", "name": "Groceries" },
      "baselineAvg": "1200.00",
      "multiplier": "2.67",
      "reason": "Expense is at least 2x the category average for this period"
    }
  ],
  "categorySpikes": [
    {
      "category": { "id": "uuid", "name": "Transport" },
      "currentTotal": "5000.00",
      "previousTotal": "2000.00",
      "changeAmount": "3000.00",
      "changePct": "150.00",
      "direction": "up"
    }
  ]
}
```

`unusualExpenses` currently requires at least 3 expenses in that category within the selected period.
`categorySpikes` returns categories whose current spend is at least 50% higher than the previous equivalent period.

---

## 13. Activity Feed

The activity feed shows what happened in a group or across all your groups — who added what, who settled with whom.

**Activity types:**

| `type` | Triggered by |
|---|---|
| `expense_created` | New expense added |
| `expense_updated` | Expense edited |
| `expense_deleted` | Expense deleted |
| `settlement_created` | Payment recorded |
| `settlement_deleted` | Settlement deleted |
| `member_added` | New member joined |
| `member_removed` | Member left or was removed |
| `member_role_changed` | Member promoted/demoted |
| `group_updated` | Group name or description changed |

---

### `GET /groups/:groupId/activity` 🔒

**Query params**
| Param | Default | Description |
|---|---|---|
| `from`, `to` | — | Filter by date range |
| `type` | — | Filter to a specific activity type |
| `userId` | — | Activities involving this user as actor |
| `page`, `limit` | 1, 20 | Pagination |

**Response `200`**
```json
{
  "data": [
    {
      "id": "uuid",
      "type": "expense_created",
      "actor": { "id": "uuid", "name": "Raj", "avatarUrl": null },
      "summary": "Raj added Weekly groceries (₹1,200)",
      "payload": {
        "expenseId": "uuid",
        "description": "Weekly groceries",
        "amount": "1200.00",
        "category": { "name": "Groceries", "icon": "🛒" }
      },
      "createdAt": "2024-03-15T10:00:00.000Z"
    },
    {
      "id": "uuid",
      "type": "settlement_created",
      "actor": { "id": "uuid", "name": "Mohak", "avatarUrl": null },
      "summary": "Mohak paid Raj ₹350",
      "payload": {
        "settlementId": "uuid",
        "paidTo": { "id": "uuid", "name": "Raj" },
        "amount": "350.00"
      },
      "createdAt": "2024-03-14T18:00:00.000Z"
    }
  ],
  "meta": { "total": 84, "page": 1, "limit": 20, "totalPages": 5 }
}
```

---

### `GET /users/me/activity` 🔒
Activity across **all** your groups, merged and sorted by recency.

**Query params**: same as group activity, plus `groupId` to filter to one group.

**Response `200`** — same shape, each item additionally includes:
```json
{
  "group": { "id": "uuid", "name": "Flat 4B", "type": "household" }
}
```

---

### `GET /groups/:groupId/audit` 🔒
Durable audit history for expense and settlement changes in a group.
Unlike the derived activity feed, deleted resources still leave audit entries with their last known snapshot.

**Query params**
| Param | Description |
|---|---|
| `action` | `created` \| `updated` \| `deleted` |
| `resourceType` | `expense` \| `settlement` |
| `resourceId` | Filter to one expense or settlement UUID |
| `actorId` | Filter to actions performed by one user |
| `from`, `to` | Created timestamp filter; accepts `YYYY-MM-DD` or ISO 8601 |
| `page`, `limit` | Pagination |

**Response `200`**
```json
{
  "data": [
    {
      "id": "uuid",
      "type": "expense_updated",
      "action": "updated",
      "resource": { "type": "expense", "id": "uuid" },
      "actor": { "id": "uuid", "name": "Raj", "avatarUrl": null },
      "summary": "Raj changed Dinner amount from 500.00 to 650.00",
      "before": {
        "description": "Dinner",
        "amount": "500.00",
        "date": "2024-03-15"
      },
      "after": {
        "description": "Dinner",
        "amount": "650.00",
        "date": "2024-03-15"
      },
      "changedFields": [
        { "field": "amount", "before": "500.00", "after": "650.00" }
      ],
      "createdAt": "2024-03-15T10:30:00.000Z"
    }
  ],
  "meta": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 }
}
```

Audit logs are written for expense create/edit/delete and settlement create/delete.
The activity feed also includes audit-backed update/delete events.

---

## 14. Dashboard

One-shot endpoints that power full-screen views. Reduces round trips on app load.

### `GET /users/me/dashboard` 🔒
Personal home screen data.

**Response `200`**
```json
{
  "user": { "id": "uuid", "name": "Mohak", "avatarUrl": null },
  "balanceSummary": {
    "totalOwed": "850.00",
    "totalYouOwe": "350.00",
    "net": "500.00"
  },
  "groups": [
    {
      "id": "uuid",
      "name": "Flat 4B",
      "type": "household",
      "yourBalance": "-450.00",
      "memberCount": 4
    }
  ],
  "recentActivity": [
    {
      "type": "expense_created",
      "actor": { "name": "Raj" },
      "summary": "Raj added Electricity bill (₹800)",
      "group": { "name": "Flat 4B" },
      "createdAt": "2024-03-15T10:00:00.000Z"
    }
  ],
  "upcomingRecurring": [
    {
      "expenseId": "uuid",
      "description": "Monthly Rent",
      "amount": "8000.00",
      "recurAnchor": "2024-04-01",
      "groupName": "Flat 4B"
    }
  ]
}
```
`recentActivity`: last 10 items across all groups.
`upcomingRecurring`: next 3 recurring expenses due within 7 days.

---

### `GET /groups/:groupId/dashboard` 🔒
Group home screen data.

**Response `200`**
```json
{
  "group": {
    "id": "uuid",
    "name": "Flat 4B",
    "type": "household",
    "memberCount": 4
  },
  "balances": {
    "simplified": [
      {
        "from": { "id": "uuid", "name": "Mohak" },
        "to":   { "id": "uuid", "name": "Raj"   },
        "amount": "350.00"
      }
    ],
    "myBalance": { "youAreOwed": "850.00", "youOwe": "350.00", "net": "500.00" }
  },
  "thisMonth": {
    "total": "18400.00",
    "expenseCount": 34,
    "vsLastMonth": { "changeAmount": "2200.00", "changePct": "13.58", "direction": "up" }
  },
  "recentExpenses": [
    {
      "id": "uuid",
      "description": "Weekly groceries",
      "amount": "1200.00",
      "date": "2024-03-15",
      "paidBy": { "name": "Mohak" },
      "myShare": "300.00"
    }
  ],
  "recentActivity": []
}
```
`recentExpenses`: last 5.
`recentActivity`: last 10.

---

## 15. Appendix

### Split Type Examples

Given: **Total = ₹1,200, 4 participants**

**Equal**
```json
"participants": [
  { "userId": "A" },
  { "userId": "B" },
  { "userId": "C" },
  { "userId": "D" }
]
```
→ Each owes **₹300**

---

**Exact**
```json
"participants": [
  { "userId": "A", "shareAmount": "600.00" },
  { "userId": "B", "shareAmount": "300.00" },
  { "userId": "C", "shareAmount": "200.00" },
  { "userId": "D", "shareAmount": "100.00" }
]
```
→ Must sum to ₹1,200. Each owes their specified amount.

---

**Percentage**
```json
"participants": [
  { "userId": "A", "splitInput": "50" },
  { "userId": "B", "splitInput": "25" },
  { "userId": "C", "splitInput": "15" },
  { "userId": "D", "splitInput": "10" }
]
```
→ Must sum to 100. A owes ₹600, B owes ₹300, C owes ₹180, D owes ₹120.

---

**Shares**
```json
"participants": [
  { "userId": "A", "splitInput": "2" },
  { "userId": "B", "splitInput": "2" },
  { "userId": "C", "splitInput": "1" },
  { "userId": "D", "splitInput": "1" }
]
```
→ Total shares = 6. A gets 2/6 = ₹400, B = ₹400, C = ₹200, D = ₹200.

---

### Debt Simplification Algorithm

The `/balances/simplified` endpoint uses a **greedy net settlement** approach:

1. Compute each person's net position: `net[person] = (sum owed to them) − (sum they owe others)`
2. Split into creditors (positive net) and debtors (negative net)
3. Greedily match the largest debtor with the largest creditor until all nets are zero

This minimizes the number of transactions. Example:
```
Before: A→B ₹300, B→C ₹200, A→C ₹100
After:  A→B ₹400, A→C ₹200           (2 transactions instead of 3)
```

---

### Permission Matrix

| Action | Member | Admin |
|---|---|---|
| View group, expenses, balances, analytics | ✓ | ✓ |
| Add expense (any payer) | ✓ | ✓ |
| Edit/delete own expense | ✓ | ✓ |
| Edit/delete any expense | ✗ | ✓ |
| Record settlement | ✓ | ✓ |
| Delete own settlement | ✓ | ✓ |
| Delete any settlement | ✗ | ✓ |
| Create tag | ✓ | ✓ |
| Edit/delete tag | ✗ | ✓ |
| Create custom category | ✗ | ✓ |
| Edit/delete custom category | ✗ | ✓ |
| Invite member | ✗ | ✓ |
| Remove member | self only | ✓ |
| Change member role | ✗ | ✓ |
| Edit group name/description | ✗ | ✓ |
| Delete group | ✗ | ✓ |

---

### System Default Categories

Seeded at startup with `groupId = null`. These are available to all groups.

| Name | Icon | Color |
|---|---|---|
| Rent | 🏠 | `#EF4444` |
| Groceries | 🛒 | `#10B981` |
| Utilities | ⚡ | `#F59E0B` |
| Internet | 📶 | `#3B82F6` |
| Food & Dining | 🍕 | `#F97316` |
| Transport | 🚗 | `#8B5CF6` |
| Entertainment | 🎬 | `#EC4899` |
| Travel | ✈️ | `#06B6D4` |
| Household | 🧹 | `#84CC16` |
| Subscriptions | 📱 | `#6366F1` |
| Misc | 📦 | `#9CA3AF` |

# talo HRA Rent Receipt API

Reference for generating HRA rent receipt PDFs and storing reusable HRA details.

All routes below are mounted under `/api`.

## Endpoint

`POST /users/me/hra-rent-receipt.pdf`

Generates a PDF, stores it in S3, and redirects to a short-lived signed S3
download URL. This endpoint is useful for a one-off download, but the PDF bytes
are still served by S3 rather than the API Lambda.

Saved receipt history uses:

- `GET /users/me/hra`
- `PUT /users/me/hra`
- `GET /users/me/hra/landlords`
- `POST /users/me/hra/landlords`
- `PATCH /users/me/hra/landlords/:landlordId`
- `DELETE /users/me/hra/landlords/:landlordId`
- `GET /users/me/hra/receipts`
- `POST /users/me/hra/receipts`
- `GET /users/me/hra/receipts/:receiptId`
- `GET /users/me/hra/receipts/:receiptId.pdf`
- `DELETE /users/me/hra/receipts/:receiptId`

## Auth

This route is authenticated.

```http
Authorization: Bearer <firebase-id-token>
Content-Type: application/json
```

## Request Body

```json
{
  "tenantName": "Mohak Jain",
  "tenantPan": "ABCDE1234F",
  "landlordName": "Ramesh Kumar",
  "landlordPan": "ABCDE6789K",
  "landlordAddress": "24 MG Road, Bengaluru 560001",
  "propertyAddress": "Flat 302, Lotus Residency, 14 Residency Road, Bengaluru 560025",
  "rentAmount": "25000.00",
  "paymentDate": "2026-05-05",
  "receiptDate": "2026-05-05",
  "rentMonth": "2026-05",
  "paymentMethod": "upi",
  "transactionReference": "UPI-983451",
  "receiptNumber": "HRA-MAY-2026-001",
  "place": "Bengaluru"
}
```

## Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `landlordId` | string \| null | No | Uses a saved landlord; omitted forms can use the default saved landlord |
| `tenantName` | string | No | Defaults to the authenticated user's `name` |
| `tenantPan` | string \| null | No | Uppercased before rendering; can default from HRA profile |
| `landlordName` | string | Conditionally | Required unless `landlordId` or a default landlord supplies it |
| `landlordPan` | string \| null | No | Uppercased before rendering |
| `landlordAddress` | string \| null | No | Max 180 chars |
| `propertyAddress` | string | Conditionally | Required unless saved in HRA profile |
| `rentAmount` | string | Conditionally | Money string, e.g. `"25000.00"`; required unless saved in HRA profile |
| `paymentDate` | string | Yes | `YYYY-MM-DD` |
| `receiptDate` | string \| null | No | `YYYY-MM-DD`; defaults to `paymentDate` |
| `rentMonth` | string \| null | Conditionally | `YYYY-MM`; one way to define the receipt period |
| `periodFrom` | string \| null | Conditionally | `YYYY-MM-DD`; must be sent with `periodTo` |
| `periodTo` | string \| null | Conditionally | `YYYY-MM-DD`; must be sent with `periodFrom` |
| `periodLabel` | string \| null | Conditionally | Custom text like `"April 2026"` or `"April-June 2026"` |
| `paymentMethod` | enum | No | `cash`, `upi`, `bank_transfer`, `cheque`, `online_transfer`, `other` |
| `transactionReference` | string \| null | No | UPI ref / cheque no / bank txn id |
| `receiptNumber` | string | No | Auto-generated if omitted |
| `place` | string \| null | No | Rendered near signature block |

## Period Rules

You must provide one of:

- `periodLabel`
- `rentMonth`
- both `periodFrom` and `periodTo`

Additional validation:

- `periodFrom` and `periodTo` must be sent together.
- `periodTo` must be on or after `periodFrom`.
- `paymentDate` and `receiptDate` must be valid `YYYY-MM-DD` dates.

## Defaults

If omitted:

- `tenantName` falls back to saved HRA profile, then current user's name.
- `tenantPan`, `propertyAddress`, `rentAmount`, `paymentMethod`, and `place` can fall back to the saved HRA profile.
- landlord fields can fall back to `landlordId`, or the default saved landlord.
- `receiptDate` falls back to `paymentDate`.
- `receiptNumber` is generated as `HRA-<period-token>-<issue-date-token>`.
- `paymentMethod` renders as `Other`.

## Saved HRA Profile

`GET /users/me/hra`

Returns reusable HRA defaults and the default landlord.

```json
{
  "profile": {
    "tenantName": "Mohak Jain",
    "tenantPan": "ABCDE1234F",
    "propertyAddress": "Flat 302, Lotus Residency, Bengaluru 560025",
    "defaultRentAmount": "25000.00",
    "defaultPaymentMethod": "upi",
    "place": "Bengaluru",
    "createdAt": "2026-05-16T10:00:00.000Z",
    "updatedAt": "2026-05-16T10:00:00.000Z"
  },
  "defaultLandlord": null
}
```

`PUT /users/me/hra`

Upserts reusable defaults. Omitted fields are left unchanged; send `null` to
clear a field.

```json
{
  "tenantName": "Mohak Jain",
  "tenantPan": "ABCDE1234F",
  "propertyAddress": "Flat 302, Lotus Residency, Bengaluru 560025",
  "defaultRentAmount": "25000.00",
  "defaultPaymentMethod": "upi",
  "place": "Bengaluru"
}
```

## Saved Landlords

`POST /users/me/hra/landlords`

```json
{
  "nickname": "Current flat owner",
  "name": "Ramesh Kumar",
  "pan": "ABCDE6789K",
  "address": "24 MG Road, Bengaluru 560001",
  "isDefault": true
}
```

`GET /users/me/hra/landlords` returns:

```json
{
  "landlords": [
    {
      "id": "uuid",
      "nickname": "Current flat owner",
      "name": "Ramesh Kumar",
      "pan": "ABCDE6789K",
      "address": "24 MG Road, Bengaluru 560001",
      "isDefault": true,
      "createdAt": "2026-05-16T10:00:00.000Z",
      "updatedAt": "2026-05-16T10:00:00.000Z"
    }
  ]
}
```

## Saved Receipts

`POST /users/me/hra/receipts`

Accepts the same body as `POST /users/me/hra-rent-receipt.pdf`, generates the
PDF, stores it, and returns receipt metadata. The stored receipt includes an
immutable snapshot of the tenant, landlord, property, payment, and period data
used at generation time.

```json
{
  "landlordId": "uuid",
  "paymentDate": "2026-05-05",
  "rentMonth": "2026-05",
  "transactionReference": "UPI-983451"
}
```

Response:

```json
{
  "receipt": {
    "id": "uuid",
    "landlordId": "uuid",
    "pdfFileId": "uuid",
    "receiptNumber": "HRA-202605-20260505",
    "receiptDate": "2026-05-05",
    "paymentDate": "2026-05-05",
    "rentMonth": "2026-05",
    "periodFrom": null,
    "periodTo": null,
    "periodLabel": "May 2026",
    "rentAmount": "25000.00",
    "paymentMethod": "upi",
    "filename": "hra-rent-receipt-may-2026-mohak-jain.pdf",
    "pdfUrl": "/api/users/me/hra/receipts/uuid.pdf",
    "details": {
      "tenantName": "Mohak Jain",
      "tenantPan": "ABCDE1234F",
      "landlordName": "Ramesh Kumar",
      "landlordPan": "ABCDE6789K",
      "landlordAddress": "24 MG Road, Bengaluru 560001",
      "propertyAddress": "Flat 302, Lotus Residency, Bengaluru 560025",
      "paymentMethodLabel": "UPI",
      "transactionReference": "UPI-983451",
      "place": "Bengaluru"
    },
    "createdAt": "2026-05-16T10:00:00.000Z",
    "updatedAt": "2026-05-16T10:00:00.000Z"
  }
}
```

`GET /users/me/hra/receipts` supports `page` and `limit` query params and
returns `{ "receipts": [...], "meta": { ... } }`.

`GET /users/me/hra/receipts/:receiptId.pdf` redirects to the saved S3 PDF. If
the stored file record or object is unavailable, the backend regenerates the PDF
from the immutable receipt snapshot, stores the repaired PDF in S3, updates the
receipt's `pdfFileId`, and then redirects to S3.

## Success Response

**Status:** `302 Found` for saved receipts, `303 See Other` for one-off `POST`
downloads

**Headers:**

```http
Location: https://<bucket>.s3.<region>.amazonaws.com/...
Cache-Control: no-store
```

The signed S3 response carries:

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="hra-rent-receipt-may-2026-mohak-jain.pdf"
```

**Body:** binary PDF bytes, served by S3

The PDF includes:

- receipt number
- receipt date
- payment date
- rental period
- tenant and landlord details
- property address
- amount in figures and words
- payment mode and reference
- signature line

## Error Response

Validation errors are returned as JSON.

Example:

```json
{
  "error": "Validation failed",
  "code": "VALIDATION_ERROR",
  "details": {
    "paymentDate": "Must be YYYY-MM-DD",
    "periodLabel": "Provide periodLabel, rentMonth, or a periodFrom/periodTo range"
  }
}
```

## Example cURL

```bash
curl -X POST http://localhost:4000/api/users/me/hra-rent-receipt.pdf \
  -L \
  -H "Authorization: Bearer <firebase-id-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "landlordName": "Ramesh Kumar",
    "landlordPan": "ABCDE6789K",
    "propertyAddress": "Flat 302, Lotus Residency, 14 Residency Road, Bengaluru 560025",
    "rentAmount": "25000.00",
    "paymentDate": "2026-05-05",
    "rentMonth": "2026-05",
    "paymentMethod": "upi",
    "transactionReference": "UPI-983451",
    "place": "Bengaluru"
  }' \
  --output hra-rent-receipt.pdf
```

## Frontend Note

This endpoint does not return JSON on success. The client should allow redirects
and treat the final S3 response as a `blob`/binary download, using the
`Content-Disposition` filename when available.

import { pgEnum } from "drizzle-orm/pg-core";

export const groupTypeEnum = pgEnum("group_type", ["household", "personal"]);
export const memberRoleEnum = pgEnum("member_role", ["admin", "member"]);
export const householdStatusEnum = pgEnum("household_status", ["active", "archived"]);
export const residentStatusEnum = pgEnum("resident_status", ["active", "leaving", "left"]);
export const billingPolicyEnum = pgEnum("billing_policy", [
  "next_cycle",
  "custom_prorated",
  "end_of_cycle",
]);
export const inviteTypeEnum = pgEnum("invite_type", ["link", "phone", "email"]);
export const inviteStatusEnum = pgEnum("invite_status", [
  "pending",
  "accepted",
  "expired",
  "revoked",
]);
export const splitTypeEnum = pgEnum("split_type", ["equal", "exact", "percentage", "shares"]);
export const recurIntervalEnum = pgEnum("recur_interval", ["weekly", "monthly", "yearly"]);
export const billKindEnum = pgEnum("bill_kind", [
  "rent",
  "electricity",
  "maid",
  "cook",
  "wifi",
  "maintenance",
  "water",
  "gas",
  "subscription",
  "other",
]);
export const billAmountModeEnum = pgEnum("bill_amount_mode", ["fixed", "variable"]);
export const billSplitStrategyEnum = pgEnum("bill_split_strategy", [
  "equal_active_residents",
  "fixed_shares",
  "room_based",
  "custom_snapshot",
]);
export const billInstanceStatusEnum = pgEnum("bill_instance_status", [
  "scheduled",
  "due",
  "overdue",
  "paid",
  "skipped",
  "cancelled",
]);
export const settlementStatusEnum = pgEnum("settlement_status", [
  "pending",
  "confirmed",
  "disputed",
]);
export const settlementMethodEnum = pgEnum("settlement_method", [
  "upi",
  "bank_transfer",
  "cash",
  "other",
]);
export const hraPaymentMethodEnum = pgEnum("hra_payment_method", [
  "cash",
  "upi",
  "bank_transfer",
  "cheque",
  "online_transfer",
  "other",
]);
export const assetStatusEnum = pgEnum("asset_status", ["active", "transferred", "disposed"]);
export const depositEntryTypeEnum = pgEnum("deposit_entry_type", [
  "contribution",
  "transfer",
  "refund",
  "deduction",
]);
export const auditActionEnum = pgEnum("audit_action", ["created", "updated", "deleted"]);
export const auditResourceTypeEnum = pgEnum("audit_resource_type", ["expense", "settlement"]);
export const uploadKindEnum = pgEnum("upload_kind", [
  "receipt",
  "avatar",
  "group_cover",
  "bill_proof",
  "asset_photo",
  "deposit_proof",
  "hra_receipt_pdf",
  "other",
]);

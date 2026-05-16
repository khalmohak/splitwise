CREATE TYPE "public"."household_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."resident_status" AS ENUM('active', 'leaving', 'left');--> statement-breakpoint
CREATE TYPE "public"."billing_policy" AS ENUM('next_cycle', 'custom_prorated', 'end_of_cycle');--> statement-breakpoint
CREATE TYPE "public"."invite_type" AS ENUM('link', 'phone', 'email');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('pending', 'accepted', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."bill_kind" AS ENUM('rent', 'electricity', 'maid', 'cook', 'wifi', 'maintenance', 'water', 'gas', 'subscription', 'other');--> statement-breakpoint
CREATE TYPE "public"."bill_amount_mode" AS ENUM('fixed', 'variable');--> statement-breakpoint
CREATE TYPE "public"."bill_split_strategy" AS ENUM('equal_active_residents', 'fixed_shares', 'room_based', 'custom_snapshot');--> statement-breakpoint
CREATE TYPE "public"."bill_instance_status" AS ENUM('scheduled', 'due', 'overdue', 'paid', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."settlement_method" AS ENUM('upi', 'bank_transfer', 'cash', 'other');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('active', 'transferred', 'disposed');--> statement-breakpoint
CREATE TYPE "public"."deposit_entry_type" AS ENUM('contribution', 'transfer', 'refund', 'deduction');--> statement-breakpoint
ALTER TYPE "public"."upload_kind" ADD VALUE IF NOT EXISTS 'bill_proof';--> statement-breakpoint
ALTER TYPE "public"."upload_kind" ADD VALUE IF NOT EXISTS 'asset_photo';--> statement-breakpoint
ALTER TYPE "public"."upload_kind" ADD VALUE IF NOT EXISTS 'deposit_proof';--> statement-breakpoint

ALTER TABLE "users"
  ADD COLUMN "avatar_file_id" uuid,
  ADD COLUMN "preferred_settlement_method" "public"."settlement_method";--> statement-breakpoint
ALTER TABLE "users"
  ADD CONSTRAINT "users_avatar_file_id_uploaded_files_id_fk"
  FOREIGN KEY ("avatar_file_id") REFERENCES "public"."uploaded_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "groups"
  ADD COLUMN "city" varchar(120),
  ADD COLUMN "locality" varchar(120),
  ADD COLUMN "apartment_name" varchar(160),
  ADD COLUMN "unit_label" varchar(120),
  ADD COLUMN "expected_resident_count" integer,
  ADD COLUMN "billing_day" integer,
  ADD COLUMN "cover_file_id" uuid,
  ADD COLUMN "status" "public"."household_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "groups"
  ADD CONSTRAINT "groups_cover_file_id_uploaded_files_id_fk"
  FOREIGN KEY ("cover_file_id") REFERENCES "public"."uploaded_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "group_members"
  ADD COLUMN "status" "public"."resident_status" DEFAULT 'active' NOT NULL,
  ADD COLUMN "move_in_date" date,
  ADD COLUMN "move_out_date" date,
  ADD COLUMN "room_label" varchar(120),
  ADD COLUMN "billing_start_policy" "public"."billing_policy" DEFAULT 'next_cycle' NOT NULL,
  ADD COLUMN "billing_end_policy" "public"."billing_policy" DEFAULT 'end_of_cycle' NOT NULL;--> statement-breakpoint

CREATE TABLE "group_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "invite_token" varchar(80) NOT NULL,
  "invite_type" "public"."invite_type" DEFAULT 'link' NOT NULL,
  "phone" varchar(40),
  "email" varchar(255),
  "intended_name" varchar(120),
  "room_label" varchar(120),
  "intended_move_in_date" date,
  "status" "public"."invite_status" DEFAULT 'pending' NOT NULL,
  "invited_by_id" uuid NOT NULL,
  "accepted_by_user_id" uuid,
  "accepted_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "group_invites_invite_token_unique" UNIQUE("invite_token")
);
--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_invites_group_id_status_idx" ON "group_invites" USING btree ("group_id","status");--> statement-breakpoint

CREATE TABLE "bill_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "name" varchar(160) NOT NULL,
  "bill_kind" "public"."bill_kind" DEFAULT 'other' NOT NULL,
  "vendor_name" varchar(160),
  "amount_mode" "public"."bill_amount_mode" DEFAULT 'fixed' NOT NULL,
  "default_amount" numeric(12, 2),
  "currency" varchar(3) DEFAULT 'INR' NOT NULL,
  "due_day" integer NOT NULL,
  "cadence" "public"."recur_interval" DEFAULT 'monthly' NOT NULL,
  "default_payer_user_id" uuid,
  "split_strategy" "public"."bill_split_strategy" DEFAULT 'equal_active_residents' NOT NULL,
  "split_config" jsonb,
  "collect_proof_image" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "notes" varchar(1000),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_templates" ADD CONSTRAINT "bill_templates_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_templates" ADD CONSTRAINT "bill_templates_default_payer_user_id_users_id_fk" FOREIGN KEY ("default_payer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bill_templates_group_id_is_active_idx" ON "bill_templates" USING btree ("group_id","is_active");--> statement-breakpoint

CREATE TABLE "bill_instances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "label" varchar(200) NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "due_date" date NOT NULL,
  "status" "public"."bill_instance_status" DEFAULT 'due' NOT NULL,
  "amount" numeric(12, 2),
  "default_payer_user_id" uuid,
  "actual_payer_user_id" uuid,
  "paid_at" timestamp with time zone,
  "proof_file_id" uuid,
  "generated_expense_id" uuid,
  "resident_snapshot" jsonb NOT NULL,
  "split_snapshot" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_instances" ADD CONSTRAINT "bill_instances_template_id_bill_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."bill_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_instances" ADD CONSTRAINT "bill_instances_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_instances" ADD CONSTRAINT "bill_instances_default_payer_user_id_users_id_fk" FOREIGN KEY ("default_payer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_instances" ADD CONSTRAINT "bill_instances_actual_payer_user_id_users_id_fk" FOREIGN KEY ("actual_payer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_instances" ADD CONSTRAINT "bill_instances_proof_file_id_uploaded_files_id_fk" FOREIGN KEY ("proof_file_id") REFERENCES "public"."uploaded_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_instances" ADD CONSTRAINT "bill_instances_generated_expense_id_expenses_id_fk" FOREIGN KEY ("generated_expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bill_instances_group_id_status_due_date_idx" ON "bill_instances" USING btree ("group_id","status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "bill_instances_template_period_uq" ON "bill_instances" USING btree ("template_id","period_start","period_end");--> statement-breakpoint

CREATE TABLE "assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "name" varchar(160) NOT NULL,
  "category" varchar(120),
  "photo_file_id" uuid,
  "purchase_date" date,
  "purchase_amount" numeric(12, 2),
  "purchase_expense_id" uuid,
  "status" "public"."asset_status" DEFAULT 'active' NOT NULL,
  "current_holder_user_id" uuid,
  "notes" varchar(1000),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_photo_file_id_uploaded_files_id_fk" FOREIGN KEY ("photo_file_id") REFERENCES "public"."uploaded_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_purchase_expense_id_expenses_id_fk" FOREIGN KEY ("purchase_expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_current_holder_user_id_users_id_fk" FOREIGN KEY ("current_holder_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_group_id_status_idx" ON "assets" USING btree ("group_id","status");--> statement-breakpoint

CREATE TABLE "asset_ownerships" (
  "asset_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "ownership_percent" numeric(7, 4),
  "ownership_amount" numeric(12, 2),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "asset_ownerships_asset_id_user_id_pk" PRIMARY KEY("asset_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "asset_ownerships" ADD CONSTRAINT "asset_ownerships_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_ownerships" ADD CONSTRAINT "asset_ownerships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "deposit_ledger_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "entry_type" "public"."deposit_entry_type" NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "from_user_id" uuid,
  "to_user_id" uuid,
  "effective_date" date NOT NULL,
  "proof_file_id" uuid,
  "notes" varchar(1000),
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deposit_ledger_entries" ADD CONSTRAINT "deposit_ledger_entries_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_ledger_entries" ADD CONSTRAINT "deposit_ledger_entries_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_ledger_entries" ADD CONSTRAINT "deposit_ledger_entries_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_ledger_entries" ADD CONSTRAINT "deposit_ledger_entries_proof_file_id_uploaded_files_id_fk" FOREIGN KEY ("proof_file_id") REFERENCES "public"."uploaded_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_ledger_entries" ADD CONSTRAINT "deposit_ledger_entries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deposit_ledger_entries_group_id_effective_date_idx" ON "deposit_ledger_entries" USING btree ("group_id","effective_date");

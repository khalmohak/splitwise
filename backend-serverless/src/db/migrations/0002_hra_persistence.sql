CREATE TYPE "public"."hra_payment_method" AS ENUM('cash', 'upi', 'bank_transfer', 'cheque', 'online_transfer', 'other');--> statement-breakpoint
ALTER TYPE "public"."upload_kind" ADD VALUE IF NOT EXISTS 'hra_receipt_pdf';--> statement-breakpoint

CREATE TABLE "hra_profiles" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "tenant_name" varchar(120),
  "tenant_pan" varchar(20),
  "property_address" varchar(240),
  "default_rent_amount" numeric(12, 2),
  "default_payment_method" "public"."hra_payment_method",
  "place" varchar(80),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hra_profiles" ADD CONSTRAINT "hra_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "hra_landlords" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "nickname" varchar(80),
  "name" varchar(120) NOT NULL,
  "pan" varchar(20),
  "address" varchar(180),
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hra_landlords" ADD CONSTRAINT "hra_landlords_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hra_landlords_user_id_is_default_idx" ON "hra_landlords" USING btree ("user_id","is_default");--> statement-breakpoint

CREATE TABLE "hra_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "landlord_id" uuid,
  "pdf_file_id" uuid,
  "receipt_number" varchar(40) NOT NULL,
  "receipt_date" date NOT NULL,
  "payment_date" date NOT NULL,
  "rent_month" varchar(7),
  "period_from" date,
  "period_to" date,
  "period_label" varchar(80) NOT NULL,
  "rent_amount" numeric(12, 2) NOT NULL,
  "payment_method" "public"."hra_payment_method" DEFAULT 'other' NOT NULL,
  "filename" varchar(255) NOT NULL,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hra_receipts" ADD CONSTRAINT "hra_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hra_receipts" ADD CONSTRAINT "hra_receipts_landlord_id_hra_landlords_id_fk" FOREIGN KEY ("landlord_id") REFERENCES "public"."hra_landlords"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hra_receipts" ADD CONSTRAINT "hra_receipts_pdf_file_id_uploaded_files_id_fk" FOREIGN KEY ("pdf_file_id") REFERENCES "public"."uploaded_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hra_receipts_user_id_created_at_idx" ON "hra_receipts" USING btree ("user_id","created_at");

CREATE TABLE "newsletter_subscribers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(255) NOT NULL,
  "status" varchar(32) DEFAULT 'subscribed' NOT NULL,
  "source" varchar(80) DEFAULT 'website' NOT NULL,
  "page" varchar(255),
  "referrer" varchar(500),
  "user_agent" varchar(500),
  "subscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "unsubscribed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "newsletter_subscribers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "newsletter_subscribers_status_created_at_idx" ON "newsletter_subscribers" USING btree ("status","created_at");

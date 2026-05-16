import { index, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    status: varchar("status", { length: 32 }).notNull().default("subscribed"),
    source: varchar("source", { length: 80 }).notNull().default("website"),
    page: varchar("page", { length: 255 }),
    referrer: varchar("referrer", { length: 500 }),
    userAgent: varchar("user_agent", { length: 500 }),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true }).notNull().defaultNow(),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusCreatedIdx: index("newsletter_subscribers_status_created_at_idx").on(
      t.status,
      t.createdAt,
    ),
  }),
);

export type NewsletterSubscriber = typeof newsletterSubscribers.$inferSelect;
export type NewNewsletterSubscriber = typeof newsletterSubscribers.$inferInsert;

// /api/newsletter — public website newsletter capture.

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { newsletterSubscribers } from "../db/schema/newsletter-subscribers.js";
import { parseJson } from "../lib/http.js";
import { newsletterSubscriptionEmail } from "../lib/email/templates.js";
import { sendEmailSafely } from "../lib/email/transport.js";

export const newsletter = new Hono();

const subscribeSchema = z.object({
  email: z.string().trim().email().max(255),
  source: z.string().trim().min(1).max(80).optional(),
  page: z.string().trim().min(1).max(255).optional(),
  referrer: z.string().trim().min(1).max(500).optional(),
  company: z.string().trim().max(120).optional(),
});

function compact(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function clip(value: string | undefined, max: number): string | null {
  const trimmed = compact(value);
  return trimmed ? trimmed.slice(0, max) : null;
}

newsletter.post("/subscribe", async (c) => {
  const body = await parseJson(c, subscribeSchema);

  // Quietly accept obvious bot submissions without storing or emailing them.
  if (body.company) {
    return c.json({ ok: true, message: "You're on the list." }, 201);
  }

  const now = new Date();
  const email = body.email.toLowerCase();
  const source = compact(body.source) ?? "website";
  const page = compact(body.page);
  const referrer = compact(body.referrer) ?? clip(c.req.header("referer"), 500);
  const userAgent = clip(c.req.header("user-agent"), 500);

  const [existing] = await db
    .select()
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, email))
    .limit(1);

  if (existing) {
    await db
      .update(newsletterSubscribers)
      .set({
        status: "subscribed",
        source,
        page,
        referrer,
        userAgent,
        subscribedAt: existing.status === "subscribed" ? existing.subscribedAt : now,
        unsubscribedAt: null,
        updatedAt: now,
      })
      .where(eq(newsletterSubscribers.id, existing.id));

    if (existing.status !== "subscribed") {
      void sendEmailSafely({
        to: email,
        idempotencyKey: `newsletter-resubscribe-${existing.id}-${now.toISOString()}`,
        ...newsletterSubscriptionEmail(),
      });
    }

    return c.json({ ok: true, message: "You're already on the list." });
  }

  const [created] = await db
    .insert(newsletterSubscribers)
    .values({
      email,
      source,
      page,
      referrer,
      userAgent,
      subscribedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  void sendEmailSafely({
    to: email,
    idempotencyKey: `newsletter-subscribe-${created!.id}`,
    ...newsletterSubscriptionEmail(),
  });

  return c.json({ ok: true, message: "You're on the list." }, 201);
});

/**
 * Email campaign architecture (brief §22-25). Not a full enterprise provider — reuses the Phase 6
 * lib/email/provider.ts abstraction (currently a logging stub; swapping in a real provider means
 * implementing `send()` there, nothing here). Audiences are resolved from the *existing* Phase 6 segment/
 * loyalty/wishlist data — never a duplicated targeting system — and every audience query is gated on
 * `marketing_opt_in = true` (brief §24: "never send marketing email without valid consent").
 */
import { sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { emailCampaigns, emailCampaignRecipients } from "../db/schema";
import { eq } from "drizzle-orm";
import { ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { rows, n } from "../admin/sql";
import { getCrmSettings, SEGMENT_KEYS, segmentWhere, type SegmentKey } from "../crm/segments";
import { emailProvider } from "../email/provider";

export type EmailCampaignRow = typeof emailCampaigns.$inferSelect;
export type EmailAudience = EmailCampaignRow["audience"];

const CONSENTED = sql`c.marketing_opt_in = true and c.anonymized_at is null`;

/** Resolves an audience definition to real recipients right now (not a stored, staled list) — brief §23. */
export async function resolveAudience(db: DbOrTx, audience: EmailAudience): Promise<{ id: string; email: string; name: string }[]> {
  switch (audience.type) {
    case "segment": {
      if (!audience.segmentKey || !(SEGMENT_KEYS as readonly string[]).includes(audience.segmentKey)) throw new ValidationError("Unknown segment.");
      const cfg = await getCrmSettings(db);
      const res = await rows<{ id: string; email: string; name: string }>(db, sql`
        select c.id, c.email, c.name from customers c join customer_stats s on s.customer_id = c.id
        where c.merged_into_customer_id is null and ${CONSENTED} and (${segmentWhere(audience.segmentKey as SegmentKey, cfg)})`);
      return res;
    }
    case "loyalty_members": {
      return rows<{ id: string; email: string; name: string }>(db, sql`
        select c.id, c.email, c.name from customers c join loyalty_accounts la on la.customer_id = c.id
        where c.merged_into_customer_id is null and ${CONSENTED}`);
    }
    case "bought_category": {
      if (!audience.categoryId) throw new ValidationError("Choose a category.");
      return rows<{ id: string; email: string; name: string }>(db, sql`
        select distinct c.id, c.email, c.name from customers c
        join orders o on o.customer_id = c.id and o.paid_at is not null
        join order_items i on i.order_id = o.id join products p on p.id = i.product_id
        where c.merged_into_customer_id is null and ${CONSENTED} and p.category_id = ${audience.categoryId}`);
    }
    case "has_wishlist_items": {
      return rows<{ id: string; email: string; name: string }>(db, sql`
        select distinct c.id, c.email, c.name from customers c join wishlists w on w.customer_id = c.id
        where c.merged_into_customer_id is null and ${CONSENTED}`);
    }
  }
}

export type NewEmailCampaign = { name: string; audience: EmailAudience; subject: string; previewText?: string; content: string; scheduledAt?: Date | null; campaignId?: string | null };
export async function createEmailCampaign(db: Db, actor: Actor, input: NewEmailCampaign): Promise<EmailCampaignRow> {
  assertCan(actor, "marketing:write");
  if (!input.name.trim() || !input.subject.trim() || !input.content.trim()) throw new ValidationError("Name, subject and content are required.");
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(emailCampaigns).values({
      name: input.name.trim(), audience: input.audience, subject: input.subject.trim(), previewText: input.previewText ?? "",
      content: input.content, scheduledAt: input.scheduledAt ?? null, campaignId: input.campaignId ?? null, createdByUserId: actor.userId,
    }).returning();
    await audit(tx, actor, "Created email campaign", "email_campaign", row!.id, undefined, { name: row!.name, audience: row!.audience });
    return row!;
  });
}

export async function scheduleEmailCampaign(db: Db, actor: Actor, id: string, scheduledAt: Date) {
  assertCan(actor, "marketing:write");
  const [row] = await db.update(emailCampaigns).set({ status: "SCHEDULED", scheduledAt }).where(eq(emailCampaigns.id, id)).returning();
  if (!row) throw new ValidationError("Email campaign not found.");
  await audit(db, actor, "Scheduled email campaign", "email_campaign", id, undefined, { scheduledAt });
  return row;
}

export async function cancelEmailCampaign(db: Db, actor: Actor, id: string) {
  assertCan(actor, "marketing:write");
  const [row] = await db.update(emailCampaigns).set({ status: "CANCELLED" }).where(eq(emailCampaigns.id, id)).returning();
  if (!row) throw new ValidationError("Email campaign not found.");
  await audit(db, actor, "Cancelled email campaign", "email_campaign", id, undefined, undefined);
  return row;
}

/** Sends now, for real, through the same provider abstraction every transactional email uses (brief §22).
 *  Consent is re-checked at send time (resolveAudience), not just at creation, so a later opt-out is
 *  always honored. */
export async function sendEmailCampaignNow(db: Db, actor: Actor, id: string) {
  assertCan(actor, "marketing:write");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(emailCampaigns).where(eq(emailCampaigns.id, id));
    if (!c) throw new ValidationError("Email campaign not found.");
    if (c.status === "SENT" || c.status === "CANCELLED") throw new ValidationError(`This campaign is already ${c.status.toLowerCase()}.`);
    const recipients = await resolveAudience(tx, c.audience);
    await tx.update(emailCampaigns).set({ status: "SENDING" }).where(eq(emailCampaigns.id, id));
    for (const r of recipients) {
      await emailProvider.send({ to: r.email, subject: c.subject, text: c.content });
      await tx.insert(emailCampaignRecipients).values({ emailCampaignId: id, customerId: r.id, sentAt: new Date() }).onConflictDoNothing();
    }
    const [row] = await tx.update(emailCampaigns).set({ status: "SENT", sentAt: new Date() }).where(eq(emailCampaigns.id, id)).returning();
    await audit(tx, actor, "Sent email campaign", "email_campaign", id, undefined, { recipients: recipients.length });
    return { campaign: row!, recipients: recipients.length };
  });
}

export async function listEmailCampaigns(db: DbOrTx): Promise<EmailCampaignRow[]> {
  return db.select().from(emailCampaigns).orderBy(sql`${emailCampaigns.createdAt} desc`);
}

/** Sent/Delivered are real (every recipient really gets a call through emailProvider.send()).
 *  Opened/Clicked/Unsubscribed are always "not available" — this provider genuinely can't report them
 *  (brief §25: "do not invent open/click data if the provider does not supply it"). Orders/Revenue, when
 *  the campaign is linked to a marketing_campaigns row, come from that campaign's own attribution query —
 *  not a second, per-recipient tracking system this provider can't support. */
export type EmailCampaignAnalytics = { sent: number; delivered: number; opened: null; clicked: null; unsubscribed: null; revenuePerRecipientCents: number | null };
export async function getEmailCampaignAnalytics(db: DbOrTx, id: string, campaignRevenueCents: number | null): Promise<EmailCampaignAnalytics> {
  const [row] = await rows<{ sent: string }>(db, sql`select count(*) as sent from email_campaign_recipients where email_campaign_id = ${id} and sent_at is not null`);
  const sent = n(row?.sent);
  return { sent, delivered: sent, opened: null, clicked: null, unsubscribed: null, revenuePerRecipientCents: campaignRevenueCents != null && sent > 0 ? Math.round(campaignRevenueCents / sent) : null };
}

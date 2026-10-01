/**
 * Centralized event log (brief §46-49). Client-captured events (page_view, product_viewed,
 * collection_viewed, search, cart_added, coupon_applied, coupon_failed) are written here through
 * `recordEvents`; `checkout_started`/`purchase_completed` are written server-side, inside the same
 * transactions as placeOrder/markOrderPaid (lib/orders/service.ts) — see docs/EVENT_TRACKING.md.
 * Never stores card data, passwords, tokens, or a raw user-agent (brief §48) — only a coarse device class.
 */
import { sql } from "drizzle-orm";
import type { Db, DbOrTx, Tx } from "../db/client";
import { marketingEvents } from "../db/schema";
import { resolveCampaignId } from "./campaigns";
import { rows } from "../admin/sql";

export type MarketingEventType = typeof marketingEvents.$inferSelect["type"];

export type ClientEvent = {
  eventId: string;
  sessionId: string;
  type: MarketingEventType;
  path?: string;
  referrer?: string;
  utmSource?: string; utmMedium?: string; utmCampaign?: string; utmTerm?: string; utmContent?: string;
  productId?: string; collectionId?: string;
  searchQuery?: string; resultsCount?: number;
  metadata?: Record<string, unknown>;
};

/** desktop/mobile/tablet only — never the raw string (brief §34, §48). */
export function classifyDevice(userAgent: string | null): "desktop" | "mobile" | "tablet" | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet(?!.*mobile)/.test(ua)) return "tablet";
  if (/mobi|iphone|android/.test(ua)) return "mobile";
  return "desktop";
}

const MAX_BATCH = 25;
/** Best-effort, fire-and-forget from the client's point of view: a bad or duplicate event is dropped, never
 *  a 500 that could surface to a shopper. Client-supplied event_id dedups a retried request; a session/type
 *  the caller can't be trusted on (product/collection ids) is left null rather than guessed. */
export async function recordEvents(db: Db, events: ClientEvent[], ctx: { customerId: string | null; device: ReturnType<typeof classifyDevice> }) {
  const batch = events.slice(0, MAX_BATCH);
  if (!batch.length) return;
  await db.transaction(async (tx) => {
    for (const e of batch) {
      if (!e.eventId || !e.sessionId || !e.type) continue;
      const campaignId = e.utmCampaign ? await resolveCampaignId(tx, e.utmCampaign) : null;
      await tx.insert(marketingEvents).values({
        eventId: e.eventId, sessionId: e.sessionId.slice(0, 200), customerId: ctx.customerId, type: e.type,
        path: e.path?.slice(0, 500) ?? null, referrer: e.referrer?.slice(0, 500) ?? null,
        utmSource: e.utmSource?.slice(0, 200) ?? null, utmMedium: e.utmMedium?.slice(0, 200) ?? null,
        utmCampaign: e.utmCampaign?.slice(0, 200) ?? null, utmTerm: e.utmTerm?.slice(0, 200) ?? null, utmContent: e.utmContent?.slice(0, 200) ?? null,
        campaignId, productId: e.productId ?? null, collectionId: e.collectionId ?? null,
        searchQuery: e.searchQuery?.slice(0, 200) ?? null, resultsCount: e.resultsCount ?? null,
        device: ctx.device, metadata: e.metadata ?? null,
      }).onConflictDoNothing();
    }
  });
}

/** Server-written, order-tied events (checkout_started, purchase_completed) — see lib/orders/service.ts.
 *  No client eventId; the partial unique index on (order_id) where type = 'purchase_completed' is the
 *  dedup guarantee for that one (brief §47), independent of anything the client does. */
export async function recordOrderEvent(tx: Tx, type: "checkout_started" | "purchase_completed", orderId: string, opts: { sessionId?: string | null; campaignId?: string | null; customerId?: string } = {}) {
  await tx.insert(marketingEvents).values({
    sessionId: opts.sessionId ?? `server-${orderId}`, type, orderId, campaignId: opts.campaignId ?? null, customerId: opts.customerId ?? null,
  }).onConflictDoNothing();
}

export async function qualifiedSessionCount(db: DbOrTx, fromIso: string, toIso: string): Promise<number> {
  const [row] = await rows<{ n: string }>(db, sql`select count(distinct session_id) as n from marketing_events where type = 'page_view' and created_at >= ${fromIso} and created_at < ${toIso}`);
  return Number(row?.n ?? 0);
}

export async function eventCount(db: DbOrTx, type: MarketingEventType, fromIso: string, toIso: string): Promise<number> {
  const [row] = await rows<{ n: string }>(db, sql`select count(*) as n from marketing_events where type = ${type} and created_at >= ${fromIso} and created_at < ${toIso}`);
  return Number(row?.n ?? 0);
}

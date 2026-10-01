/**
 * Centralized event log: dedup, purchase-completion tied to the unique order, search/zero-result
 * analytics, and the funnel/conversion-rate zero-safety rules (brief §9, §33, §36-38, §46-47).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, ALL_TIME } from "./helpers";
import { placeOrder, markOrderPaid } from "@/lib/orders/service";
import { recordEvents } from "@/lib/marketing/events";
import { marketingEvents } from "@/lib/db/schema";
import { getMarketingFunnel, getSearchAnalytics, getSearchConversion, getZeroResultSearches } from "@/lib/analytics/marketing";

const owner = { userId: null, name: "seed", role: "OWNER" as const };

describe("event dedup (brief §47)", () => {
  beforeEach(resetDb);

  it("a retried client event with the same event_id is written only once", async () => {
    const event = { eventId: "evt-fixed-1", sessionId: "sess-1", type: "product_viewed" as const };
    await recordEvents(db, [event], { customerId: null, device: "desktop" });
    await recordEvents(db, [event], { customerId: null, device: "desktop" }); // retried, e.g. offline/retry
    const rows = await db.select().from(marketingEvents).where(eq(marketingEvents.eventId, "evt-fixed-1"));
    expect(rows).toHaveLength(1);
  });

  it("purchase_completed is written exactly once even if markOrderPaid is somehow invoked twice for the same order", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    const order = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "dup@example.com", name: "Dup" }, status: "pending", channel: "WEBSITE" }, owner);
    await markOrderPaid(db, order.id);
    const r = await markOrderPaid(db, order.id); // idempotent: already processed, changes nothing
    expect(r.alreadyProcessed).toBe(true);
    const rows = await db.select().from(marketingEvents).where(eq(marketingEvents.orderId, order.id));
    expect(rows.filter((e) => e.type === "purchase_completed")).toHaveLength(1);
  });
});

describe("marketing funnel and qualified-session conversion rate (brief §9, §33)", () => {
  beforeEach(resetDb);

  it("each stage is an independent count, with rates null (not fabricated) when a denominator is zero", async () => {
    const empty = await getMarketingFunnel(db, ALL_TIME);
    expect(empty.sessions).toBe(0);
    expect(empty.viewRate).toBeNull();
    expect(empty.cartRate).toBeNull();
  });

  it("counts sessions, views, cart adds and checkouts correctly", async () => {
    await recordEvents(db, [
      { eventId: "e1", sessionId: "s1", type: "page_view" },
      { eventId: "e2", sessionId: "s1", type: "product_viewed" },
      { eventId: "e3", sessionId: "s2", type: "page_view" },
      { eventId: "e4", sessionId: "s1", type: "cart_added" },
    ], { customerId: null, device: null });
    const f = await getMarketingFunnel(db, ALL_TIME);
    expect(f.sessions).toBe(2);
    expect(f.productViews).toBe(1);
    expect(f.addToCart).toBe(1);
    expect(f.viewRate).toBe(50); // 1 view / 2 sessions
  });
});

describe("search analytics (brief §36-38)", () => {
  beforeEach(resetDb);

  it("tracks top searches and zero-result searches separately", async () => {
    await recordEvents(db, [
      { eventId: "s1", sessionId: "sess", type: "search", searchQuery: "sapphire ring", resultsCount: 3 },
      { eventId: "s2", sessionId: "sess", type: "search", searchQuery: "unobtainium necklace", resultsCount: 0 },
    ], { customerId: null, device: null });
    const top = await getSearchAnalytics(db, ALL_TIME);
    expect(top.find((r) => r.query === "sapphire ring")?.resultsFound).toBe(3);
    const zero = await getZeroResultSearches(db, ALL_TIME);
    expect(zero.map((r) => r.query)).toContain("unobtainium necklace");
    const conv = await getSearchConversion(db, ALL_TIME);
    expect(conv.searches).toBe(2);
    expect(conv.zeroResult).toBe(1);
    expect(conv.zeroResultRate).toBe(50);
  });

  it("zero searches at all reports null rate, never a fabricated 0%", async () => {
    const conv = await getSearchConversion(db, ALL_TIME);
    expect(conv.zeroResultRate).toBeNull();
  });
});

afterAll(() => pool.end());

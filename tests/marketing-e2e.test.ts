/**
 * Brief §51: end-to-end marketing scenario. Emma Chen arrives from Instagram with the SUMMER2026
 * campaign, views a product, adds it to her bag, applies a coupon, and checks out — every stage of the
 * funnel and every downstream figure (attribution, campaign revenue, dashboard) is verified against the
 * same real transaction, and revenue is counted exactly once.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, ALL_TIME } from "./helpers";
import { placeOrder, markOrderPaid } from "@/lib/orders/service";
import { createCampaign } from "@/lib/marketing/campaigns";
import { createPromotion } from "@/lib/marketing/promotions";
import { recordEvents } from "@/lib/marketing/events";
import { getCampaignPerformance, getMarketingOverview } from "@/lib/analytics/marketing";
import { marketingAttributions, marketingEvents } from "@/lib/db/schema";
import { getMetrics } from "@/lib/analytics/service";

const owner = { userId: null, name: "seed", role: "OWNER" as const };
const EMMA = { email: "emma.chen@example.com", name: "Emma Chen" };
const SESSION = "sess-emma-1";

describe("brief §51: end-to-end marketing scenario (Emma Chen, SUMMER2026, Instagram)", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("counts revenue exactly once and updates campaign, attribution and dashboard figures together", async () => {
    // Setup: the business created a campaign and a coupon ahead of time.
    await createCampaign(db, owner, { name: "Summer Sale", slug: "SUMMER2026", source: "instagram", medium: "social" });
    await createPromotion(db, owner, { code: "SUMMER15", type: "percent", value: 15 });
    const { variant, product } = await makeVariant({ stock: 10, priceCents: 20_000 }); // $200 item

    // 1-2: Emma arrives with UTM parameters; first-touch attribution will be stored on her first order.
    const acquisition = { source: "INSTAGRAM" as const, details: { utmSource: "instagram", utmMedium: "social", utmCampaign: "SUMMER2026" } };

    // 3: Customer views the product (funnel event).
    await recordEvents(db, [{ eventId: "ev-view", sessionId: SESSION, type: "product_viewed", productId: product.id, utmCampaign: "SUMMER2026" }], { customerId: null, device: "desktop" });
    // 4: Customer adds product to cart (funnel event).
    await recordEvents(db, [{ eventId: "ev-cart", sessionId: SESSION, type: "cart_added", productId: product.id, utmCampaign: "SUMMER2026" }], { customerId: null, device: "desktop" });

    // 5-8: Customer starts checkout, applies a coupon (validated server-side), and purchases.
    const order = await placeOrder(db, {
      lines: [{ variantId: variant.id, quantity: 1 }], discountCode: "SUMMER15", customer: EMMA, status: "pending", channel: "WEBSITE", acquisition,
    }, owner);
    expect(order.discountTotalCents).toBe(3_000); // 15% of $200
    await markOrderPaid(db, order.id);

    // 9: Purchase event is created, tied uniquely to this order.
    const purchaseEvents = await db.select().from(marketingEvents).where(eq(marketingEvents.orderId, order.id));
    expect(purchaseEvents.filter((e) => e.type === "purchase_completed")).toHaveLength(1);

    // 10-11: Campaign revenue and customer attribution update.
    const [attr] = await db.select().from(marketingAttributions).where(eq(marketingAttributions.orderId, order.id));
    expect(attr!.firstTouchSource).toBe("INSTAGRAM");
    const [perf] = await getCampaignPerformance(db, ALL_TIME).then((rows) => rows.filter((c) => c.slug === "SUMMER2026"));
    expect(perf!.orders).toBe(1);
    expect(perf!.revenueCents).toBe(17_000); // $200 - 15% discount = $170
    expect(perf!.discountCents).toBe(3_000);

    // 12: Marketing dashboard updates — same revenue, counted once.
    const overview = await getMarketingOverview(db, ALL_TIME);
    expect(overview.marketingOrders).toBe(1);
    expect(overview.marketingRevenueCents).toBe(17_000);

    // Revenue is counted exactly once: the main sales dashboard agrees with the marketing dashboard.
    const salesMetrics = await getMetrics(db, ALL_TIME);
    expect(salesMetrics.netRevenueCents).toBe(17_000);

    // 13: Emma is a converted campaign customer. A second order with no fresh UTM data on the request still
    // carries her known first/last touch forward (from her customer profile) — it does not erase attribution,
    // and her original first-touch is never overwritten.
    const second = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: EMMA, status: "pending", channel: "WEBSITE" }, owner);
    await markOrderPaid(db, second.id);
    const [attr2] = await db.select().from(marketingAttributions).where(eq(marketingAttributions.orderId, second.id));
    expect(attr2!.firstTouchSource).toBe("INSTAGRAM");
    expect(attr2!.lastTouchSource).toBe("INSTAGRAM");
    const [firstAgain] = await db.select().from(marketingAttributions).where(eq(marketingAttributions.orderId, order.id));
    expect(firstAgain!.firstTouchSource).toBe("INSTAGRAM"); // unchanged
  });
});

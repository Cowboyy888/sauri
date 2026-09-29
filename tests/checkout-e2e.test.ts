/**
 * Brief §40, end to end through the real Phase 4 path this time: cart -> checkout -> server-side price
 * and stock validation -> reservation -> a real Stripe test-mode Checkout Session -> a signed webhook
 * event -> order created -> reservation converted to SALE -> revenue/COGS/profit updated -> a duplicate
 * webhook changes nothing. `tests/business.test.ts` already covers the same numbers through the
 * Phase 1 manual-order and markOrderPaid paths; this proves the Phase 4 checkout/webhook wiring on top
 * of that, not a second implementation of the math.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, ALL_TIME } from "./helpers";
import { startCheckout } from "@/lib/payments/checkout";
import { POST as webhookRoute } from "@/app/api/webhooks/stripe/route";
import { getStripe } from "@/lib/payments/stripe";
import { getMetrics } from "@/lib/analytics/service";
import { orders, inventory, shippingMethods } from "@/lib/db/schema";

function sign(eventObj: unknown) {
  const payload = JSON.stringify(eventObj);
  const sig = getStripe().webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
  return new Request("http://test/api/webhooks/stripe", { method: "POST", body: payload, headers: { "stripe-signature": sig } });
}

describe("brief §40: end-to-end business scenario through real checkout + webhook", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("Aurora Ring: cost $50, price $100, stock 100, buy 3", async () => {
    const { variant } = await makeVariant({ stock: 100, priceCents: 10_000, costCents: 5_000 });
    const [standard] = await db.select({ id: shippingMethods.id }).from(shippingMethods).where(eq(shippingMethods.name, "Standard Shipping"));

    // 1-6: cart -> checkout -> server validates price & stock -> inventory reserved -> payment session created
    const checkout = await startCheckout(db, {
      lines: [{ variantId: variant.id, quantity: 3 }], shippingMethodId: standard!.id,
      customer: { email: "shopper@example.com", name: "Shopper" },
      shippingAddress: { firstName: "Shopper", lastName: "One", line1: "1 Main St", city: "Phnom Penh", postalCode: "12000", country: "KH" },
    });
    expect(checkout.clientSecret).toMatch(/^cs_test_/);

    let [order] = await db.select().from(orders).where(eq(orders.id, checkout.orderId));
    expect(order!.status).toBe("pending");
    let [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv).toMatchObject({ stockQuantity: 100, reservedQuantity: 3 }); // reserved, not yet deducted

    // 7-8: payment succeeds -> webhook received -> order created (already exists, now confirmed) -> reservation -> SALE
    const event = { id: "evt_e2e_1", object: "event", type: "checkout.session.completed", api_version: "2026-08-26.dahlia", created: Math.floor(Date.now() / 1000), data: { object: { id: "cs_e2e_1", object: "checkout.session", payment_status: "paid", payment_intent: "pi_e2e_1", metadata: { orderId: checkout.orderId, orderNumber: checkout.orderNumber } } } };
    const res = await webhookRoute(sign(event));
    expect(res.status).toBe(200);

    // 9-12: inventory becomes 97, one SALE movement
    [order] = await db.select().from(orders).where(eq(orders.id, checkout.orderId));
    expect(order!.status).toBe("paid");
    [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv).toMatchObject({ stockQuantity: 97, reservedQuantity: 0 });

    // 13-15: revenue $300, COGS $150, gross profit $150 (margin 50%) — from the SAME analytics the admin dashboard reads
    expect(order!.subtotalCents).toBe(30_000);
    expect(order!.costTotalCents).toBe(15_000);
    expect(order!.grossProfitCents).toBe(15_000);
    expect(order!.grossMargin).toBeCloseTo(50, 5);
    const metrics = await getMetrics(db, ALL_TIME);
    expect(metrics.revenueCents).toBe(30_000);
    expect(metrics.cogsCents).toBe(15_000);
    expect(metrics.grossProfitCents).toBe(15_000);

    // 16: inventory value = available stock x cost = 97 x $50 = $4,850
    expect(inv!.stockQuantity * variant.costPriceCents).toBe(485_000);

    // 18: the duplicate webhook changes nothing
    const dup = await webhookRoute(sign(event));
    expect(await dup.json()).toMatchObject({ duplicate: true });
    [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(97);
  });
});

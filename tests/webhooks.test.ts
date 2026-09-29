/**
 * The Stripe webhook is the only thing allowed to confirm a payment (brief §11). These construct a real,
 * correctly-signed request with Stripe's own test-signing helper and POST it straight at the route
 * handler — no live Stripe round trip needed to prove the handler itself is correct and idempotent.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, buyer } from "./helpers";
import { POST as webhookRoute } from "@/app/api/webhooks/stripe/route";
import { getStripe } from "@/lib/payments/stripe";
import { placeOrder } from "@/lib/orders/service";
import { STOREFRONT_ACTOR } from "@/lib/auth/permissions";
import { inventory, orders, paymentEvents } from "@/lib/db/schema";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
let seq = 0;

function sessionEvent(type: string, session: { id: string; payment_status?: string; payment_intent?: string; metadata: { orderId: string; orderNumber: string } }) {
  seq++;
  return {
    id: `evt_test_${seq}_${Date.now()}`, object: "event", type, api_version: "2026-08-26.dahlia", created: Math.floor(Date.now() / 1000),
    data: { object: { id: session.id, object: "checkout.session", payment_status: session.payment_status ?? "paid", payment_intent: session.payment_intent ?? null, metadata: session.metadata } },
  };
}

function signedRequest(eventObj: unknown, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(eventObj);
  const sig = getStripe().webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://test/api/webhooks/stripe", { method: "POST", body: payload, headers: { "stripe-signature": sig } });
}

async function pendingOrder(variantId: string, quantity = 3) {
  return placeOrder(db, { lines: [{ variantId, quantity }], customer: buyer, status: "pending", channel: "WEBSITE" }, STOREFRONT_ACTOR);
}

describe("stripe webhook", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("rejects a request with an invalid signature", async () => {
    const res = await webhookRoute(signedRequest({ id: "evt_x", type: "checkout.session.completed" }, "whsec_wrong_secret"));
    expect(res.status).toBe(400);
  });

  it("checkout.session.completed converts the reservation into a SALE exactly once, even if delivered twice", async () => {
    const { variant } = await makeVariant({ stock: 100, costCents: 5_000, priceCents: 10_000 });
    const order = await pendingOrder(variant.id, 3);
    const event = sessionEvent("checkout.session.completed", { id: "cs_test_1", payment_intent: "pi_test_1", metadata: { orderId: order.id, orderNumber: order.orderNumber } });

    const first = await webhookRoute(signedRequest(event));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });

    const [afterFirst] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(afterFirst!.status).toBe("paid");
    expect(afterFirst!.paymentStatus).toBe("paid");
    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(97);
    expect(inv!.reservedQuantity).toBe(0);

    // The exact same event, redelivered (Stripe's documented at-least-once behavior).
    const second = await webhookRoute(signedRequest(event));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });

    const [afterSecond] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(afterSecond!.stockQuantity).toBe(97); // not deducted twice
    const events = await db.select().from(paymentEvents).where(eq(paymentEvents.providerEventId, event.id));
    expect(events).toHaveLength(1); // recorded once, not twice
  });

  it("checkout.session.completed with payment_status 'unpaid' does not fulfill yet (delayed payment methods)", async () => {
    const { variant } = await makeVariant({ stock: 10 });
    const order = await pendingOrder(variant.id, 1);
    const event = sessionEvent("checkout.session.completed", { id: "cs_test_2", payment_status: "unpaid", metadata: { orderId: order.id, orderNumber: order.orderNumber } });
    await webhookRoute(signedRequest(event));
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.status).toBe("pending"); // still awaiting async_payment_succeeded
  });

  it("checkout.session.expired releases the reservation without creating a sale", async () => {
    const { variant } = await makeVariant({ stock: 10 });
    const order = await pendingOrder(variant.id, 4);
    let [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.reservedQuantity).toBe(4);

    const event = sessionEvent("checkout.session.expired", { id: "cs_test_3", metadata: { orderId: order.id, orderNumber: order.orderNumber } });
    const res = await webhookRoute(signedRequest(event));
    expect(res.status).toBe(200);

    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.status).toBe("cancelled");
    [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(10);
    expect(inv!.reservedQuantity).toBe(0);
  });

  it("checkout.session.async_payment_failed releases the reservation, and the customer can be re-checked out", async () => {
    const { variant } = await makeVariant({ stock: 5 });
    const order = await pendingOrder(variant.id, 2);
    const event = sessionEvent("checkout.session.async_payment_failed", { id: "cs_test_4", metadata: { orderId: order.id, orderNumber: order.orderNumber } });
    await webhookRoute(signedRequest(event));
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.status).toBe("cancelled");
    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.reservedQuantity).toBe(0);
  });
});

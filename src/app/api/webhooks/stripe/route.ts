import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getDb } from "@/lib/db/client";
import { customers, orders, paymentEvents } from "@/lib/db/schema";
import { getStripe } from "@/lib/payments/stripe";
import { markOrderPaid, updateOrderStatus } from "@/lib/orders/service";
import { SYSTEM_ACTOR } from "@/lib/auth/permissions";
import { emailProvider, orderConfirmationEmail } from "@/lib/email/provider";

/**
 * Source of truth for "did this order get paid" (brief §11). The frontend never confirms payment —
 * only this handler, driven by Stripe, does. See docs/WEBHOOKS.md.
 */
export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) return NextResponse.json({ error: "Webhook not configured." }, { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const db = getDb();

  // Idempotency (brief §12): a redelivered event is a fast, side-effect-free no-op. This is defense in
  // depth — markOrderPaid/updateOrderStatus are already idempotent on the order's own status — but it's
  // also the explicit ledger the brief asks for, and where a future non-idempotent side effect (a
  // one-time email) would check before firing.
  const [already] = await db.select({ id: paymentEvents.id }).from(paymentEvents).where(eq(paymentEvents.providerEventId, event.id));
  if (already) return NextResponse.json({ ok: true, duplicate: true });

  let orderId: string | undefined;
  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        orderId = session.metadata?.orderId;
        if (orderId && session.payment_status !== "unpaid") {
          const result = await markOrderPaid(db, orderId, { providerRef: typeof session.payment_intent === "string" ? session.payment_intent : undefined });
          if (!result.alreadyProcessed) {
            const [row] = await db.select({ orderNumber: orders.orderNumber, totalCents: orders.totalCents, email: customers.email })
              .from(orders).innerJoin(customers, eq(customers.id, orders.customerId)).where(eq(orders.id, orderId));
            if (row) await emailProvider.send(orderConfirmationEmail(row));
          }
        }
        break;
      }
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        orderId = session.metadata?.orderId;
        if (orderId) await updateOrderStatus(db, SYSTEM_ACTOR, orderId, "cancelled", { reason: event.type === "checkout.session.expired" ? "Checkout session expired" : "Payment failed" }).catch(() => {});
        break;
      }
      default:
        break; // event type not handled; still recorded below so a redelivery is cheap
    }
    await db.insert(paymentEvents).values({ provider: "stripe", providerEventId: event.id, type: event.type, orderId: orderId ?? null, payload: event }).onConflictDoNothing();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Stripe webhook handler failed", event.type, event.id, e);
    return NextResponse.json({ error: "Handler failed." }, { status: 500 }); // Stripe will retry
  }
}

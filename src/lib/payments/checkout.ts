import "server-only";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import type { Db } from "../db/client";
import { orderItems, shippingMethods } from "../db/schema";
import { STORE } from "../config";
import { BusinessError } from "../errors";
import { STOREFRONT_ACTOR, SYSTEM_ACTOR } from "../auth/permissions";
import { placeOrder, updateOrderStatus, type PlaceOrderInput } from "../orders/service";
import { releaseExpiredReservations } from "../orders/reservations";
import { getStripe } from "./stripe";

export type StartCheckoutInput = Omit<PlaceOrderInput, "status" | "channel" | "paymentProvider" | "paymentRef" | "placedAt">;

const randomSuffix = (n: number) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("");

/**
 * The one place a checkout is started (brief §5, §7). Re-runs the exact same server-side pricing and
 * stock validation as everywhere else (`placeOrder`), which is also the reservation step — there is no
 * separate reservation table or code path. If Stripe can't be reached after the reservation is made, the
 * reservation is released immediately rather than left to expire.
 */
export async function startCheckout(db: Db, input: StartCheckoutInput) {
  await releaseExpiredReservations(db).catch(() => {}); // best-effort; never blocks a new checkout

  const order = await placeOrder(db, { ...input, channel: "WEBSITE", status: "pending", paymentProvider: "stripe" }, STOREFRONT_ACTOR);
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const method = order.shippingMethodId ? (await db.select().from(shippingMethods).where(eq(shippingMethods.id, order.shippingMethodId)))[0] : null;

  try {
    const stripe = getStripe();
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = items.map((i) => ({
      quantity: 1, // the quantity is baked into the line's total; a Stripe "quantity" here would double it
      price_data: {
        currency: order.currency.toLowerCase(),
        unit_amount: i.lineTotalCents,
        product_data: { name: `${i.productNameSnapshot} — ${i.variantSnapshot.label}`, metadata: { sku: i.skuSnapshot, quantity: String(i.quantity) } },
      },
    }));
    if (order.shippingTotalCents > 0) {
      lineItems.push({ quantity: 1, price_data: { currency: order.currency.toLowerCase(), unit_amount: order.shippingTotalCents, product_data: { name: method ? `Shipping — ${method.name}` : "Shipping" } } });
    }
    if (order.taxTotalCents > 0) {
      lineItems.push({ quantity: 1, price_data: { currency: order.currency.toLowerCase(), unit_amount: order.taxTotalCents, product_data: { name: "Estimated tax" } } });
    }

    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded_page",
      redirect_on_completion: "never",
      mode: "payment",
      line_items: lineItems,
      customer_email: input.customer.email.trim().toLowerCase(),
      client_reference_id: order.orderNumber,
      expires_at: Math.floor(Date.now() / 1000) + STORE.reservationMinutes * 60,
      integration_identifier: `lumea-${randomSuffix(8)}`,
      metadata: { orderId: order.id, orderNumber: order.orderNumber },
    });
    if (!session.client_secret) throw new Error("Stripe did not return a client secret.");
    return { orderId: order.id, orderNumber: order.orderNumber, totalCents: order.totalCents, clientSecret: session.client_secret };
  } catch (e) {
    await updateOrderStatus(db, SYSTEM_ACTOR, order.id, "cancelled", { reason: "Could not start payment" }).catch(() => {});
    if (e instanceof BusinessError) throw e;
    throw new BusinessError("We couldn't start payment. Please try again.", "PAYMENT_SESSION_FAILED", 502);
  }
}

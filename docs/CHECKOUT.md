# Checkout

## Flow

```
CART (client, localStorage)
  ↓ POST /api/checkout/session  { lines, shippingMethodId, discountCode?, customer, shippingAddress, billingAddress? }
CHECKOUT START (lib/payments/checkout.ts: startCheckout)
  ↓ releaseExpiredReservations()   — sweeps any of this shopper's own abandoned reservations first (cheap, best-effort)
  ↓ placeOrder(status: "pending")  — THIS IS the reservation (see docs/INVENTORY_RESERVATION.md); re-prices
  |                                  every line from the database, validates stock and the discount, locks
  |                                  inventory rows, inserts the order + order_items, reserves stock
  ↓ Stripe Checkout Session created (ui_mode: "embedded_page", one line item per order line + shipping + tax,
  |                                  metadata.orderId, expires_at = STORE.reservationMinutes from now)
  ↓ returns { orderId, orderNumber, totalCents, clientSecret }
CHECKOUT PAYMENT (client: EmbeddedCheckoutProvider + EmbeddedCheckout, /checkout)
  ↓ Stripe's iframe collects the card; our server never sees it
  ↓ onComplete() clears the local cart and routes to /checkout/success?order=<orderId>
PAYMENT PROCESSING (Stripe)
  ↓ webhook: checkout.session.completed / async_payment_succeeded  →  markOrderPaid()  (see docs/WEBHOOKS.md)
ORDER CREATED — already existed as "pending" from the moment checkout started; the webhook confirms it
INVENTORY DEDUCTED — reservation → SALE movement, inside markOrderPaid, same transaction
ADMIN DASHBOARD UPDATED — /api/admin/events (pg_notify), same as any other order
```

The order is created **before** payment, not after — as a `pending` reservation. This is what makes
"payment succeeds but the browser never hears about it" safe: the order already exists, and the webhook
(not the browser) is what confirms it. See §11 of the brief and docs/WEBHOOKS.md.

## Server-side validation (brief §5, §29)

The browser sends only: `variantId` + `quantity` (+ optional personalization) per line, a `shippingMethodId`,
an optional `discountCode`, and the checkout form fields (email/phone/addresses). `startCheckout` /
`placeOrder` recompute, from the database, inside one transaction:

- unit price and cost (current `product_variants.selling_price_cents` / `cost_price_cents`)
- available stock (`stock_quantity − reserved_quantity`, row-locked)
- the discount (existence, active window, usage limits, minimum, scope)
- the shipping method's price and whether it's waived by the free-shipping threshold
- tax (`lib/orders/tax.ts`)
- the order total

If the client sent a manipulated price, discount, or total, it is simply never read — none of those
fields exist in the request schema (`app/api/checkout/session/route.ts`'s zod schema is `.strict()`).

## Reliability (brief §2)

| Scenario | What happens |
|---|---|
| Customer refreshes the checkout page | The React state (form fields, `clientSecret`) resets; no new order until they submit again. The *old* pending order, if one was created, is released by its `reservation_expires_at` (see docs/INVENTORY_RESERVATION.md) or by `checkout.session.expired`. |
| Payment fails (card declined) | Stripe's embedded Checkout shows the error and lets the shopper retry *within the same session* — no new order, nothing released. |
| Webhook arrives twice | `payment_events` unique on `(provider, provider_event_id)`; the second delivery is a fast no-op. See docs/WEBHOOKS.md. |
| Browser closes right after paying | Irrelevant to fulfillment — the webhook (server-to-server) confirms the order independently of whether the browser ever loads `/checkout/success`. |
| Inventory changes during checkout | Stock is row-locked (`SELECT … FOR UPDATE`) and re-checked inside the same transaction that creates the reservation; a race for the last unit produces exactly one winner (this is unchanged Phase 1 behavior, see docs/BUSINESS_LOGIC.md). |
| Network failure creating the Stripe session | `startCheckout` cancels the just-created pending order (releasing its reservation) before surfacing the error, rather than leaving a reservation with no way to ever pay it. |

## What is intentionally not built here

A hosted redirect flow, saved payment methods, and subscriptions are out of scope — this is a single
embedded, one-time-payment Checkout Session per order, matching the brief.

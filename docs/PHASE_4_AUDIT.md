# Phase 4 audit — checkout, payment & order processing

Audited before any Phase 4 changes, on top of the Phase 3 storefront (`docs/PROJECT_AUDIT.md` covers Phase 1; this extends it).

## 1. What already exists

Phase 1 built the order/inventory/payment **data model and transaction** with Phase 4 almost entirely in mind:

| Need (Phase 4 brief) | Already exists | Where |
|---|---|---|
| Inventory reservation during checkout | `reserve()` / `release()`, driven by `placeOrder(..., { status: "pending" })` | `lib/inventory/service.ts`, `lib/orders/service.ts` |
| Convert reservation → SALE on payment | `markOrderPaid()`, **idempotent** (`if (o.status !== "pending") return { alreadyProcessed: true }`) | `lib/orders/service.ts` |
| Payment failure path | `recordPaymentFailure()` | `lib/orders/service.ts` |
| Order number | `orders.order_number`, `ORD-` + `order_number_seq`, unique, sequential, human-readable | `lib/db/schema.ts` |
| Historical snapshots | `order_items` stores `product_name_snapshot`, `sku_snapshot`, `variant_snapshot`, unit price/cost at sale time | `lib/db/schema.ts` |
| Order status history | `order_events` (status, note, user, timestamp) | `lib/db/schema.ts`, shown in `/admin/orders/[id]` |
| Audit log | `audit_logs`, already written by every mutating service call | `lib/audit.ts` |
| Server-side price/stock recalculation | `quoteCart()` re-prices from the DB; `priceLines()` rejects inactive products/variants and checks `available` | `lib/orders/service.ts` |
| Discount validation | `validateDiscount()` / `consumeDiscount()`, server-side only, atomic usage | `lib/discounts/service.ts` |
| Tax | Flat 8% (`STORE.taxRateBp`) applied in `computeTotals()` | `lib/orders/pricing.ts`, `lib/config.ts` |
| Shipping | Flat standard/express, free over threshold, gated by `sales_channels.charges_shipping` | `lib/orders/pricing.ts` |
| Admin order list/detail, status control (processing/shipped/delivered/cancel/**full** refund) | `lib/admin/orders.ts`, `components/admin/order-actions.tsx`, `/admin/orders`, `/admin/orders/[id]` | Phase 2 |
| Customer statistics | Derived live from the `customer_stats` **view** — never stored, so nothing to "update" | `drizzle/0001_views_and_rls.sql` |
| Sales analytics | `lib/analytics/service.ts` reads `orders`/`order_items` directly — a webhook-created order is indistinguishable from any other paid order | Phase 1/2 |
| Sales channel | `salesChannels` table with `WEBSITE` row already seeded; `placeOrder` defaults to `channel ?? "WEBSITE"` | `lib/db/reference-data.ts` |
| Admin notifications (new order, large order, low/out of stock) | `notify()`, called from `applyMovement`/`announcePaid`, fires from inside `markOrderPaid` regardless of caller | `lib/audit.ts`, `lib/orders/service.ts` |
| Realtime dashboard refresh | `emit()` → `pg_notify('sauri_events', …)`, consumed by `/api/admin/events` | `lib/audit.ts` |
| Cart pricing endpoint | `/api/cart/quote`, already used by the Phase 3 storefront cart | `app/api/cart/quote/route.ts` |
| Wishlist / customer session / account pages | `lib/customer/session.ts`, `/account`, `/account/orders`, `/account/orders/[id]` | Phase 3 |
| Payment provider | **None selected before this phase.** `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` were reserved (unused) in `.env.example` since Phase 1. | — |

**Conclusion: the reservation → payment → SALE lifecycle the brief asks for in §7 is not new work — it is exactly what `placeOrder`/`markOrderPaid` already do.** Phase 4's job is to put a real payment provider and a checkout UI in front of that existing transaction, not to rebuild it.

## 2. What can be reused as-is

`quoteCart`, `placeOrder`, `markOrderPaid`, `recordPaymentFailure`, `updateOrderStatus`, `TRANSITIONS`, `statusFields`, all of `lib/inventory/service.ts`, `lib/discounts/service.ts`, `lib/analytics/service.ts`, `lib/admin/orders.ts`, the existing admin order UI, `order_number_seq`, RLS, the `customer_stats`/`variant_stock` views, the Phase 3 cart/customer session.

## 3. What is incomplete (confirmed gaps, not assumptions)

- **Refunds are full-only.** `updateOrderStatus`'s refund branch always refunds `subtotal − discount`; there is no amount parameter. `docs/BUSINESS_LOGIC.md` already flags this: *"Refunds are currently full refunds of the merchandise; partial refunds are planned."*
- **No payment provider.** Nothing calls Stripe (or any provider) anywhere in the repo.
- **No webhook endpoint or idempotency store.** `payments.provider_ref` has a unique index on `(provider, provider_ref)`, which gives *some* protection, but there is no record of which Stripe **event IDs** have been processed — required for §12.
- **No checkout UI.** `/cart`'s checkout button is an intentional Phase 3 stub ("Checkout — available in Phase 4").
- **Shipping is hardcoded to two tiers** (`express: boolean`) with no admin-configurable method list, no "Local Delivery"/"Pickup" option, and no per-method estimated delivery window.
- **Tax is inline, not a service.** `computeTotals()` calls `pct(net, STORE.taxRateBp)` directly; there's no `calculateTax()` seam and no `tax_enabled` flag.
- **No tracking number / carrier on orders.**
- **No internal admin notes action** (the `orders.notes` column exists but is only ever set once, at placement, by the customer/seed — there's no admin "add a note" action).
- **No storefront analytics events** for `checkout_started` / `shipping_info_added` / `payment_started` / `payment_failed` (Phase 3 already noted this gap for view/search events too — no event-log table exists anywhere in the schema).
- **No email provider.** No `RESEND_API_KEY` or equivalent anywhere in `.env.example`.

## 4. What must be changed

1. `lib/db/schema.ts` + a new migration: `payment_events` (webhook idempotency), `shipping_methods` (flexible shipping config), `orders.tracking_number` / `orders.carrier`, `payment_status` enum gains `partially_refunded`.
2. `lib/orders/pricing.ts`: accept an optional resolved shipping method (price + whether it's waived above the free-shipping threshold) instead of a bare `express` boolean, **without changing behavior for existing callers** that don't pass one (admin manual orders, the seed script, all 55 existing tests).
3. A new `lib/payments/stripe.ts` (server-only Stripe client) and `lib/payments/checkout.ts` (creates the pending order + Checkout Session together, in one place, so the browser can never create an order Stripe didn't charge for).
4. A new `lib/orders/refunds.ts` — `refundOrder()` supporting a partial `amountCents`, separate from the existing full-refund path in `updateOrderStatus` (which stays for cancellations).
5. New routes: `/checkout`, `/checkout/success`, `/api/checkout/session`, `/api/webhooks/stripe`.
6. Admin: tracking number + carrier fields, an "Add note" action, a partial-refund amount field in the existing refund dialog.

## 5. Payment integration requirements

No provider was selected before this phase. Per the brief's own instruction ("design the system to be Stripe-ready... never use real payment credentials"), and per this session's Vercel Marketplace policy for a `payments`-category need, **Stripe was provisioned as a real Vercel Marketplace sandbox resource** (test mode, `stripe-cobalt-anchor`), not hand-wired against placeholder keys. `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are real Stripe test-mode keys in `.env.local`. `STRIPE_WEBHOOK_SECRET` is not provided by the Marketplace install (it's created per webhook endpoint) — see `docs/WEBHOOKS.md` for how it's set locally (Stripe CLI) and in production (Stripe Dashboard, after deployment).

**Integration surface:** Stripe Checkout Sessions, `ui_mode: 'embedded'`, `redirect_on_completion: 'never'` — embedded in our own `/checkout` page (own header/footer/branding, own address/shipping/review steps), with Stripe's iframe handling only the card fields (PCI scope never touches our server). This is the pattern in Stripe's own Vercel integration guide and in the installed `stripe-best-practices` skill. `payment_method_types` is never passed, so Stripe's dashboard-configured dynamic payment methods apply.

## 6. Checkout architecture

See `docs/CHECKOUT.md` for the full flow. Summary: the cart (client-side, Phase 3) posts to `/api/checkout/session`, which re-runs `quoteCart`-equivalent validation, calls the **existing** `placeOrder(..., { status: "pending" })` (this *is* the reservation step — no new reservation table), then creates a Stripe Checkout Session for that exact server-computed total and returns its `client_secret`. The browser never sends a price.

## 7. Order lifecycle

Unchanged three-dimension model (`status` / `payment_status` / `fulfillment_status`) from Phase 1, extended with `partially_refunded` on `payment_status` and `tracking_number`/`carrier` on the order row. See `docs/ORDER_LIFECYCLE.md`. The brief's "suggested" flat status list (`PAYMENT_PENDING`, `READY_TO_SHIP`, `COMPLETED`, …) is deliberately **not** adopted as new enum values — the existing three-dimension model already expresses every one of those states as a combination (e.g. "payment pending" = `status=pending, payment_status=unpaid`), and Postgres enum changes are one-way. Adding a parallel, overlapping status vocabulary would be exactly the "duplicate order system" the brief says not to build.

## 8. Inventory lifecycle

No changes. `placeOrder(status:"pending")` reserves; `markOrderPaid` converts the reservation to a `SALE` movement; `updateOrderStatus(..., "cancelled")` from `pending` releases it. This is reused verbatim from the webhook handler.

## 9. Security concerns

- Webhook signature verification (`stripe.webhooks.constructEvent`) before touching the body, using `STRIPE_WEBHOOK_SECRET`.
- `payment_events` unique on `(provider, event_id)` — a second delivery of the same event is a no-op at the database level, independent of the order-state idempotency `markOrderPaid` already has.
- `STRIPE_SECRET_KEY` is never imported outside `lib/payments/`; nothing under `src/app` reads it directly.
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is the only Stripe env var exposed to the browser (by design — it is not secret).
- No raw card data ever reaches our server or logs; the embedded Checkout iframe is Stripe's origin.
- Checkout's own price/stock recomputation happens **inside** `/api/checkout/session`, server-side, from the DB — never from the request body's prices.

## 10. Testing requirements

New Vitest coverage (see `tests/checkout.test.ts`, `tests/webhooks.test.ts`, `tests/refunds.test.ts`): price/stock validation at checkout start, reservation, webhook creates exactly one order, a duplicate webhook event is a no-op, payment failure releases the reservation, full and partial refunds, the permission matrix (VIEWER cannot refund), and the full Aurora-Ring-style end-to-end scenario through the real checkout-session → simulated-webhook path (not just the pre-existing manual/`markOrderPaid` path Phase 1 already tested).

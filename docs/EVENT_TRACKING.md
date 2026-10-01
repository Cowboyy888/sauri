# Event tracking (Phase 7)

`marketing_events` (`lib/marketing/events.ts`), `POST /api/marketing/events`. One centralized event log for
every tracked interaction (brief §46) — never a separate table per event type, and never a duplicate of data
that already lives elsewhere (wishlist adds reuse Phase 6's `wishlist_events`; revenue always comes from
`orders`/`order_items`, never a copy stored on an event row).

## Event types (brief §46)

`page_view`, `product_viewed`, `collection_viewed`, `search`, `cart_added`, `cart_removed`,
`checkout_started`, `purchase_completed`, `coupon_applied`, `coupon_failed`. (`wishlist_added`,
`shipping_added`, `payment_started`, `promotion_viewed`, `email_clicked` are in the type enum for
completeness/future use but nothing writes them yet this phase — wishlist adds are already fully covered by
`wishlist_events`, and the others don't yet have a UI moment that would produce them.)

## Client-captured vs. server-written

| Written by | Events | Why |
|---|---|---|
| Client (`lib/storefront/track-client.ts`) | `page_view`, `product_viewed`, `collection_viewed`, `search`, `cart_added`, `coupon_applied`, `coupon_failed` | These only make sense as "the shopper did X in their browser" — no server-side mutation happens at that moment to hang an event off of. |
| Server, inside the existing transaction | `checkout_started` (in `placeOrder()`, for pending WEBSITE orders), `purchase_completed` (in `placeOrder()`/`markOrderPaid()`, whichever path marks an order paid) | These two must never be missed or double-counted — tying them to the exact transaction that creates/pays the order is more reliable than a client-side fire-and-forget, and gives purchase completion a hard, DB-enforced dedup guarantee (see below). |

The client module mirrors the existing `AttributionCapture` pattern exactly: a tiny, "use client" component
with no interpretation, sending whatever the current page/URL says. `AnalyticsCapture`
(`components/storefront/analytics-capture.tsx`), mounted once in the shop layout, fires `page_view` on every
route change — this is the basis for "sessions" (docs/ATTRIBUTION.md). Requests are sent via
`navigator.sendBeacon` (falling back to `fetch(..., {keepalive:true})`) so a page navigating away doesn't
lose the event, and the route (`/api/marketing/events`) always returns `{ok:true}` immediately — a malformed
or duplicate batch is silently dropped, never a 400 that could surface an error to a shopper for something
that isn't their fault.

## Deduplication (brief §47)

Two independent mechanisms, for two different failure modes:

- **Client-side retries**: every client event carries a `event_id` (a fresh `crypto.randomUUID()` per event).
  A unique partial index (`marketing_events_event_id_uq`, `WHERE event_id IS NOT NULL`) means a retried
  request with the same id is a no-op at the database level (`ON CONFLICT DO NOTHING`).
- **Purchase completion**: a partial unique index on `order_id` `WHERE type = 'purchase_completed'`
  guarantees **at most one** purchase-completed event per order, full stop — independent of `event_id`,
  independent of how many times `markOrderPaid()` is called for that order (it's already idempotent —
  `alreadyProcessed: true` on a repeat webhook — but this is belt-and-suspenders at the event layer too).
  "Purchase analytics should be tied to the unique order," per the brief, and this is enforced by the
  database, not application discipline.

No money is ever stored on an event row — see docs/PHASE_7_AUDIT.md's "New in Phase 7" section for why.

## Device classification (brief §34, §48)

`classifyDevice()` reduces the request's `User-Agent` header to `"desktop" | "mobile" | "tablet" | null` at
write time. **The raw user-agent string is never stored** — only this coarse class, which is all device
analytics needs and avoids retaining a more identifying string than necessary.

## Privacy (brief §48)

No card data, password, or auth token ever reaches this table (nothing in the checkout flow that touches
those passes through the client tracker). A search query is short, customer-entered text already visible in
the page's own URL — not treated as sensitive. Every column is either an id, a short enum/string, or a small
count.

## Performance (brief §49)

- Client events are fire-and-forget and batched (up to 25 per request) — never awaited by anything the
  shopper is waiting on.
- The two server-written events live inside a transaction that was *already* happening (order placement /
  payment confirmation) — no extra round trip.
- Indexes: `(type, created_at)` for date-ranged aggregates, `session_id` for session lookups,
  `(campaign_id, created_at)` for campaign analytics, `(product_id, type)` / `(collection_id, type)` for the
  product/collection funnel columns. Every marketing-analytics query in `lib/analytics/marketing.ts` is a
  plain aggregate `SELECT`, run on demand — no per-request loop, matching the existing analytics
  architecture's own performance principle (docs/ANALYTICS.md).

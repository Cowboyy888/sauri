# Phase 7 audit

What already existed before this phase, what Phase 7 reuses unchanged, and every scope decision made
building marketing, promotions and conversion analytics on top of it. See docs/MARKETING.md,
docs/ATTRIBUTION.md, docs/CAMPAIGNS.md, docs/PROMOTIONS.md, docs/COUPONS.md, docs/MARKETING_ANALYTICS.md
and docs/EVENT_TRACKING.md for the systems themselves.

## Already existed — reused, not rebuilt

- **Attribution capture** (Phase 6): `components/storefront/attribution-capture.tsx` copies UTM params +
  referrer into a cookie; `lib/storefront/attribution.ts` classifies it server-side; `customers.first_touch_*`
  / `last_touch_*` already hold first/last touch. Phase 7 **extends** the cookie payload (adds `utm_term`)
  and, critically, **snapshots** the touch pair onto every order at the moment it's placed
  (`marketing_attributions`), because the customer row's `last_touch_*` keeps changing on every future visit
  — campaign revenue for an order placed in March must never silently change because the same customer
  browsed again in April. This is the one genuinely new idea Phase 7 adds to attribution; everything else
  (the cookie, the classifier, the enum) is reused verbatim.
- **Discount engine** (Phase 1/2, extended Phase 6): `discounts` / `discount_usages` /
  `lib/discounts/service.ts` (`validateDiscount`, `consumeDiscount`) already do server-side validation,
  atomic usage counting, per-customer limits, min-subtotal, max-cap, category/product scope, dates, and
  (Phase 6) customer-restricted codes for loyalty rewards. Phase 7 **extends** this table and its validation
  function with product/collection allow-lists and exclude-lists, customer-segment eligibility and a
  first-order flag — see "Promotions and coupons are one system" below. **No second discount calculation
  system was created.**
- **Segments** (Phase 6): `lib/crm/segments.ts`'s `SEGMENT_KEYS`/`segmentWhere()`/`getCustomerSegments()` are
  reused as-is for promotion eligibility (§13) and email audiences (§23) — not reimplemented.
- **Abandoned carts** (Phase 6): `abandoned_carts`, `lib/marketing/abandoned-carts.ts`, and
  `/admin/marketing/abandoned-carts` already exist in full (tracking, recovery detection, KPIs). Phase 7
  adds only what didn't exist: a configurable (never auto-enabled) recovery-automation schedule and a
  staff-triggered "send now" action — see "Abandoned cart recovery" below.
- **Loyalty** (Phase 6): `lib/loyalty/service.ts`'s `redeemReward()` already issues a
  `discounts.restricted_to_customer_id` row — reused unchanged as "Loyalty reward" in the promotion type
  list (§13); no second reward-redemption code path was added.
- **Analytics conventions** (Phase 1/2/5/6): "recognized order" = paid, date ranges/time zone
  (`resolveRange`), the `rows`/`n` SQL helpers, the `settings` table pattern
  (`get*Settings`/`set*Settings`), zero-safety (`null` not `0%`) — all reused exactly as-is; see
  docs/ANALYTICS.md.
- **RBAC / audit / notifications / realtime** (`lib/auth/permissions.ts`, `lib/audit.ts`) — reused; one new
  permission area was added (see RBAC below), no new mechanism.
- **`/admin/analytics/products`** (Phase 2): already listed units/revenue/COGS/profit/margin/stock. Phase 7
  **extends** it with the funnel columns the brief asks for (views, wishlist adds, cart adds, conversion
  rate) rather than building a second, competing product-analytics page.

## New in Phase 7

- **Central event log** (`marketing_events`, brief §46-47): `page_view`, `product_viewed`,
  `collection_viewed`, `search`, `cart_added`, `coupon_applied`, `coupon_failed` are captured client-side
  (mirroring the existing `AttributionCapture` pattern — a small client component, no interpretation, fire
  and forget); `checkout_started` and `purchase_completed` are written **server-side**, inside the same
  transactions as `placeOrder`/`markOrderPaid`, because those are the two events that must never be missed
  or double-counted. `purchase_completed` has a partial unique index on `order_id` — a redelivered webhook
  or a retried request can never double-write it, independent of the client-side `event_id` dedup used for
  everything else (brief §47: "purchase analytics should be tied to the unique order").
- **`marketing_campaigns`** and **`campaign_costs`**: a campaign's `slug` *is* the exact `utm_campaign`
  value used for matching (the brief's "Campaign ID" and "Campaign" fields are the same string — see
  docs/CAMPAIGNS.md); `name` is the separate human label. Spend is entered as one or more dated
  `campaign_costs` rows (auditable, incremental) rather than a single mutable "actual spend" number.
- **`marketing_attributions`**: the per-order snapshot described above.
- **Marketing settings** (`settings.key = 'marketing'`): attribution model (`FIRST_TOUCH`/`LAST_TOUCH` — see
  "Attribution models" below) and the discount-stacking policy (see "Discount stacking" below).

## Promotions and coupons are one system, not two

The brief's §13 ("Promotion Management") and §15 ("Coupon Codes") describe the same underlying thing: a
`discounts` row. Every "promotion" in this codebase requires a code — there is no automatic, codeless,
cart-level discount, because building one would mean changing how checkout prices a cart (the brief
explicitly says not to rebuild checkout). `/admin/marketing/promotions` is the full authoring UI (all the
new eligibility rules, dates, limits); `/admin/marketing/coupons` is the same `discounts` table filtered and
presented for the specific job of running/monitoring a code (status, usage, revenue vs. discount cost). The
pre-existing simple `/admin/discounts` page (Phase 2, OWNER-only write) is untouched and still works — it is
a strict subset of what the new pages can do, kept for backward compatibility.

### Discount stacking (brief §40)

Checkout accepts exactly **one** discount code per order (`PlaceOrderInput.discountCode: string | null`) —
this was true before Phase 7 and still is. That single fact is already the strictest possible stacking
policy: a marketing coupon and a loyalty-reward code (both are `discounts` rows) can never be combined on
one order, structurally, with no code path that could accidentally allow it. The three settings the brief
asks for (`allowLoyaltyWithCoupon`, `allowRewardWithPromotion`, `allowFreeShippingRewardWithCoupon`) are
stored and OWNER-editable, so the business's *intent* is recorded and visible rather than an unstated
assumption — but none of them can currently be turned on, because doing so would require a multi-discount
checkout, which is out of scope for this phase. The settings UI and docs/PROMOTIONS.md say this plainly.

### Attribution models (brief §5)

`FIRST_TOUCH` and `LAST_TOUCH` are fully implemented (both are snapshotted on every order, so switching the
setting is instant and retroactive — no backfill needed). `LINEAR` and `POSITION_BASED` require a
customer's *entire* touch history, not just first/last; `marketing_events` (new this phase) is the raw
material a future phase would aggregate for that, but no code computes it yet. The enum carries all four
values (so the schema doesn't change again later); the settings form only offers the two that are actually
computed, with the other two visibly marked "not yet implemented."

## RBAC (brief §44)

A new `marketing` permission area (not the pre-existing `discounts` area, which stays OWNER-only per Phase
2). OWNER: full. ADMIN: read+write (the brief explicitly upgrades ADMIN to managing campaigns/promotions,
unlike the OWNER-only `discounts` area it does *not* get). SALES: read-only (campaign/customer data).
VIEWER: read-only (analytics only, matching its existing read-only-everything posture). INVENTORY: no
access (unrelated to its area, same as `customers`/`sales` today).

## Qualified session and the funnel (brief §9, §33)

A **session** is a client-generated id (`sauri_session` cookie, 30-minute rolling idle expiry) present on any
`page_view` event. A **qualified session** = a distinct session id with at least one `page_view` event in
the period — i.e., a real storefront visit, not an API hit with no page render. `Conversion Rate =
Completed (paid) Orders ÷ Qualified Sessions × 100`, `null` when qualified sessions is zero. The funnel
(§33) reports each stage as an **independent count in the period** (distinct sessions with a `page_view`;
count of `product_viewed`; count of `cart_added`; count of `checkout_started`; count of paid orders) — not a
strict per-visitor waterfall, since guest sessions can't be reliably joined all the way to an order. This is
stated on the page itself, next to the numbers.

## Abandoned cart recovery automation (brief §20)

Settings only (`enabled: false` by default, a 3-step delay schedule, editable), plus a staff "send now"
action for a specific cart — matches the brief's explicit "do not automatically send messages unless the
business explicitly activates the automation." No cron job was added: the Vercel Hobby plan already uses its
one daily cron slot for `release-reservations` (see docs/ORDER_LIFECYCLE.md); a real scheduled sender is a
one-line addition once a cron slot or a paid plan is available, and is called out as follow-up work in
docs/MARKETING.md rather than silently half-built.

## Email campaigns (brief §22-25)

Reuses the Phase 6 email provider abstraction (`lib/email/provider.ts`, still a console-logging stub — no
real provider is configured, matching that file's own Phase 6 note that a provider was never selected).
"Sent" is real (every recipient gets a real call through the same `emailProvider.send()` every transactional
email already uses). Opened/Clicked/Unsubscribed are always reported as "Not available" rather than
invented, exactly per brief §25. An email campaign may optionally link to a `marketing_campaigns` row, in
which case its Orders/Revenue/Conversion figures come from the *same* campaign-attribution query every other
campaign uses — not a second, recipient-level tracking system that the current provider can't actually
support.

## Product conversion, collections, search (brief §10-12, §36-38)

- Product funnel columns join `marketing_events` (views, cart adds) and the existing Phase 6
  `wishlist_events` (wishlist adds — reused, not duplicated) onto the existing `/admin/analytics/products`
  page.
- `/admin/analytics/collections` is new; "collection" here means an actual `collections` row (the
  editorial groupings, e.g. "Celestial") — the storefront's virtual nav entries like "All Jewelry" or
  category pages (Rings, Earrings) are not `collections` rows and are out of scope for this table, exactly
  as the brief's own examples (Rings, Necklaces, Bracelets, Earrings) suggest **categories**, which the
  existing `/admin/analytics/sales`'s "by category" breakdown already reports on the revenue side; this page
  adds the funnel side (views → cart → orders → conversion) for true `collections` rows specifically.
- Search analytics (`search_events`... in fact stored as `marketing_events` rows of type `search`, not a
  separate table — one central event log, per brief §46) power `/admin/analytics/search` and
  `/admin/analytics/search/zero-results`.

## Privacy and performance (brief §48-49)

`marketing_events` never stores card data, passwords, tokens, or a raw user-agent string (only a
`device` classification computed once at write time: desktop/mobile/tablet). Client-side events are
fire-and-forget (`fetch(..., { keepalive: true })`), batched where more than one fires in the same tick, and
the route returns before any heavy work; nothing here runs a query on checkout or storefront page load — it
only ever *writes* one small row.

## Final acceptance checklist mapping

Every checkbox in the brief's §56 has a corresponding page, function or test named in
docs/MARKETING.md, docs/CAMPAIGNS.md, docs/PROMOTIONS.md, docs/COUPONS.md, docs/MARKETING_ANALYTICS.md,
docs/ATTRIBUTION.md and docs/EVENT_TRACKING.md — see the Phase 7 STOP CONDITION report for the full
file-by-file mapping.

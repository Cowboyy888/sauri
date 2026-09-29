# Phase 6 Audit — CRM, Customer Management & Loyalty

What already exists, what Phase 6 extends vs. adds, and the scope decisions made along the way. Read
alongside docs/ARCHITECTURE.md, docs/DATABASE_SCHEMA.md, docs/BUSINESS_LOGIC.md, docs/ANALYTICS.md,
docs/ROLES_AND_PERMISSIONS.md.

## What already exists (Phase 1–5) — reused, not rebuilt

- **`customers`** (email, name, phone, `marketing_opt_in`, `created_at`) + **`customer_addresses`**
  (shipping/billing, `is_default`) — the one customer identity. Phase 6 adds columns, never a second
  customer table.
- **`customer_stats`** (SQL view): total orders, lifetime spend (net of discount+refund), gross profit,
  average order value, first/last **paid** order date — already the "recognized order = paid, not
  cancelled" definition the brief asks LTV to use. `lib/admin/customers.ts`'s `listCustomers`/`getCustomer`
  already read it, with search/sort/pagination and favorite-category/recent-products/wishlist/addresses.
  Phase 6 **extends** these two functions and their page rather than replacing them.
- **`reviews`** (rating, title, body, `order_id` nullable → verified purchase, `status`: pending/published/
  hidden). `lib/storefront/catalog.ts`'s `getReviews()` **already** computes the average rating, count, and
  1–5 star distribution, and already exposes `verifiedPurchase` (`order_id is not null`). `/admin/reviews`
  already lists, filters by status, and has approve/hide actions (`setReviewStatus` in
  `lib/catalog/service.ts`). Missing: a **rejected** status (only pending/published/hidden exist), a
  moderation **history** (today just one row's `status` + a generic audit-log entry), and — the actual gap
  — **customers cannot submit a review at all yet**; only display exists.
- **`wishlists`** (customer↔product, `created_at`). `lib/storefront/wishlist.ts` has add/remove. No history
  of removals (a remove is a hard delete).
- **`discounts`** (percent/fixed/free_shipping, category/product scope, per-customer usage limits via
  `discount_usages`). Loyalty rewards will **reuse this**, not build a second discount engine.
- **`notifications`**, **`audit_logs`**, **RBAC** (`assertCan`), the `settings` key/value table (already
  used for store config and, since Phase 5, the return policy) — all reused as-is for CRM/loyalty settings,
  audit trails, and admin alerts.
- **`sales_channels`** describes how an *order* was transacted (fee %, ships/charges shipping) — **not**
  reused for customer acquisition source, which is a different concept (how the *customer* found the
  brand, captured once at first touch, independent of which channel any given order later goes through).

## New tables (Phase 6)

`customer_tags`, `customer_tag_assignments`, `customer_notes`, `customer_communications`,
`customer_consents`, `wishlist_events`, `abandoned_carts`, `stock_notifications`,
`review_moderation_events`, `loyalty_accounts`, `loyalty_transactions`, `loyalty_tiers`,
`loyalty_rewards`, `loyalty_redemptions`. Extended: `customers` (acquisition/consent/preference columns),
`discounts` (`restricted_to_customer_id`, for a loyalty reward that only its own redeemer can use),
`reviews` (`rejected` status), `orders` (none — loyalty reads existing columns).

## Scope decisions (disclosed)

- **Acquisition source & UTM**: the storefront has no first-party tracking today. Added a lightweight
  first-touch capture (a cookie set client-side from `document.referrer` + `?utm_*`/`?ref=` on first
  landing, read once at checkout) rather than a full analytics/attribution system. `first_touch_source`
  is set once and never overwritten; `last_touch_source` updates on every order. This is genuinely new
  infrastructure, not a relabeling of `sales_channels`.
- **Abandoned carts**: the cart is **client-only** (`localStorage`, per docs/CHECKOUT.md) — there is no
  server-side cart to detect abandonment from. Rather than build a full server-side cart mirror for
  anonymous shoppers (a significant undertaking on its own), cart syncing is scoped to **signed-in
  customers only**: the cart provider debounced-syncs to `abandoned_carts` when a customer is known. Guest
  cart abandonment is out of scope for this phase — documented, not silently dropped.
- **Back-in-stock notifications**: unlike abandoned-cart recovery or marketing automation (which the brief
  explicitly says not to auto-send), a back-in-stock subscription is an explicit, single-product opt-in —
  closer to a transactional notice than marketing. It **does** fire for real, via the existing
  `emailProvider`, the moment `restock()` (Phase 1) crosses a variant from 0 to positive available stock.
- **Loyalty "completed order"**: this codebase's `orders.status` has no `completed` value (only
  `fulfillment_status` does, and only once staff mark it, sometimes long after payment). Per the brief's
  own instruction to use "the project's existing financial rules," points are earned at the same moment
  revenue is recognized everywhere else in this codebase — `paid_at` set, order not cancelled (the same
  "recognized order" definition `customer_stats`/`getMetrics` already use) — not gated on the Phase 5
  fulfillment-completion milestone. Documented explicitly in docs/LOYALTY.md so the mapping is never
  ambiguous.
- **Customer import**: not in the Final Acceptance Criteria checklist (§51) unlike merge and export, so
  only the architecture is documented (docs/CRM.md), no upload UI built this phase.
- **Customer merge**: built for real (preview, confirmation, FK reassignment, audit log) — bounded scope,
  explicitly required in the acceptance checklist.
- **SMS**: `customer_communications` supports an `sms` type as a manually-logged record; no SMS provider is
  integrated (none was requested or provisioned).
- **RFM/segment thresholds**: configurable via `settings` (key `"crm"`), mirroring exactly how Phase 5's
  return policy is configurable — never hardcoded, never a second settings mechanism.

## RBAC mapping (no new permission area)

Fulfillment reused `inventory:write`/`orders:write` in Phase 5; Phase 6 reuses **`customers:write`** for
tags/notes/communications/consent/merge/anonymize, **`sales:read`** for CRM analytics/RFM/retention/cohort
(same gate `/admin/analytics/*` already uses), and a new **`loyalty:read`/`loyalty:write`** pair (loyalty
touches money-like value — points, tiers, rewards — so it gets the same OWNER/ADMIN-only treatment as
discounts, not folded into `customers:write`). VIEWER stays read-only everywhere; a signed-in customer
(`CUSTOMER`, informal — enforced via `getCustomer()`/ownership checks, not the staff `Role` enum) can only
ever reach their own row.

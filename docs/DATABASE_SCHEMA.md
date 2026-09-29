# Database schema

Source of truth: `src/lib/db/schema.ts`. Migrations: `drizzle/0000_init.sql` (tables, enums, indexes, constraints) and `drizzle/0001_views_and_rls.sql` (views, row-level security, grants). Phase 5 adds `drizzle/0007_cute_ted_forrester.sql` (schema), `drizzle/0009_perfect_absorbing_man.sql` (a follow-up column fix — see below), and `drizzle/0010_phase5_rls_and_seed.sql` (RLS + seed, hand-written like `0001`). Phase 6 adds `drizzle/0011_wise_sebastian_shaw.sql` (schema), `drizzle/0012_phase6_rls_and_seed.sql` (RLS + seed), and `drizzle/0013_groovy_synch.sql` (a follow-up unique index on `reviews`).

## Conventions

- **Money** is integer cents, and every money column ends in `_cents`. No floats anywhere. `gross_margin` is the only decimal: a percentage, `numeric(7,2)`.
- **IDs** are UUIDs. Order numbers are human-readable (`ORD-10001`) and come from the sequence `order_number_seq`.
- **Emails** are stored lower-case, and a CHECK constraint enforces it, so uniqueness cannot be dodged with capital letters.
- **Timestamps** are `timestamptz`. Business days are cut in `STORE_TIMEZONE` at query time.

## Tables (51 — Phase 5 adds 10 (fulfillment/shipping/returns, see below); Phase 6 adds 14 more: `customer_tags`, `customer_tag_assignments`, `customer_notes`, `customer_communications`, `customer_consents`, `wishlist_events`, `abandoned_carts`, `stock_notifications`, `review_moderation_events`, `loyalty_accounts`, `loyalty_transactions`, `loyalty_tiers`, `loyalty_rewards`, `loyalty_redemptions` — see docs/CRM.md and docs/LOYALTY.md)

| Table | Purpose | Key points |
|---|---|---|
| `roles` | OWNER, ADMIN, SALES, INVENTORY, VIEWER | Reference data |
| `users` | Staff | `auth_user_id` → Supabase `auth.users`; `role`; `active` |
| `customers` | Shoppers | `user_id` → Supabase account once registered (guests have none); unique email; Phase 6 adds consent (`sms_marketing_consent`, `consent_updated_at`/`source`), `email_preferences`, first/last-touch acquisition (`*_touch_source`/`*_touch_details`, `first_visit_at`), and privacy/merge markers (`anonymized_at`, `merged_into_customer_id`) |
| `customer_addresses` | Saved addresses | `type` shipping or billing, `is_default` |
| `categories` | Rings, Earrings, Necklaces, Bracelets | `sku_prefix` (RNG, EAR, …) |
| `collections` | Editorial groups (The Everyday Edit, Celestial, …) | |
| `products` | Catalog entry | `category_id`, `collection_id`, `status`, `featured`, `best_seller`, `new_arrival`, SEO fields. **No stock and no price here.** |
| `product_variants` | The sellable unit | `sku` (unique), `barcode`, material, color, size, gemstone, `cost_price_cents`, `selling_price_cents`, `compare_at_price_cents`, `weight_mg`, `status` |
| `product_images` | Images | optional `variant_id` for per-metal photos |
| `inventory` | Stock per variant (1:1) | `stock_quantity`, `reserved_quantity`, `reorder_level` |
| `inventory_movements` | Every stock change, forever | type, signed quantity, `stock_before`, `stock_after`, `reference_type` / `reference_id`, user, notes |
| `suppliers` | Who restock comes from | |
| `sales_channels` | WEBSITE, INSTAGRAM, FACEBOOK, TIKTOK, PHYSICAL_STORE, WHOLESALE, MANUAL_ORDER, OTHER | card fee rules, whether we ship, whether the customer pays shipping |
| `orders` | One purchase | three statuses, customer amounts, profit snapshot, internal costs, addresses, notes; Phase 4 adds `shipping_method_id`, `tracking_number`, `carrier`, `internal_notes`, `reservation_expires_at` |
| `order_items` | Lines, as snapshots | name, SKU and variant snapshots; price, cost, discount share, line total, cost and profit |
| `order_events` | Status timeline | Powers "order tracking" and the admin timeline |
| `payments` | Payment attempts | provider + `provider_ref` (e.g. a Stripe PaymentIntent). **Never card data.** |
| `refunds` | Refunds issued | `restocked` flag decides whether cost is reversed |
| `discounts` | Codes | percent, fixed, or free shipping; category or product scope; minimum, cap, dates, usage and per-customer limits; Phase 6 adds `restricted_to_customer_id` (set when a code was issued by a loyalty-reward redemption — only that customer may use it) |
| `discount_usages` | Who used which code on which order | Enforces per-customer limits |
| `wishlists` | Customer ↔ product | |
| `reviews` | Product reviews | `pending`, `published`, `rejected` (Phase 6) or `hidden` (moderation); Phase 6 adds a partial unique index preventing a duplicate (customer, order, product) review |
| `customer_tags` / `customer_tag_assignments` (Phase 6) | Configurable tags, many-to-many to customers | never hardcoded — an admin creates the vocabulary |
| `customer_notes` (Phase 6) | Staff-only internal notes | never shown to the customer, same convention as `orders.internal_notes` |
| `customer_communications` (Phase 6) | Manually-logged contact history | email/SMS/call/WhatsApp/Telegram/note — never an automated send |
| `customer_consents` (Phase 6) | Append-only consent history | current state lives on `customers`; this is the audited log of every change |
| `wishlist_events` (Phase 6) | Add/remove history for `wishlists` | purely additive — `wishlists` remains the only source of truth for the *current* wishlist |
| `abandoned_carts` (Phase 6) | One tracked cart per signed-in customer | "abandoned" is computed from `last_activity_at` at read time, never a stored sweep |
| `stock_notifications` (Phase 6) | "Notify me when available" subscriptions | fires a real email the moment available stock crosses 0 → positive |
| `review_moderation_events` (Phase 6) | Structured per-review moderation history | parallel to `audit_logs`, queryable per-review |
| `loyalty_accounts` / `loyalty_transactions` / `loyalty_tiers` / `loyalty_rewards` / `loyalty_redemptions` (Phase 6) | Points, tiers, rewards | see docs/LOYALTY.md — the balance is only ever changed together with a transaction row |
| `notifications` | Dashboard bell | new order, large order, low or out of stock, refund, payment failed, review, system |
| `audit_logs` | Who changed what | `actor`, `action`, `entity`, `entity_id`, `old_value`, `new_value`, time |
| `settings` | Store settings (JSON) | currency, tax, time zone, homepage content |
| `shipping_methods` | Checkout shipping options (Phase 4; Phase 5 adds `country_code`, `region`, `min_order_cents`, `max_order_cents`) | name, price, estimated window, whether waived by the free-shipping threshold, carrier cost (internal), geography/order-value eligibility |
| `payment_events` | Stripe webhook idempotency ledger (Phase 4) | unique on `(provider, provider_event_id)`; see docs/WEBHOOKS.md |
| `inventory_locations` (Phase 5) | Where a picked item physically is | reference table only — does not track per-location quantities; see docs/INVENTORY_LOCATIONS.md |
| `fulfillment_events` (Phase 5) | Order-level fulfillment stage timeline | same shape as `order_events`, for the `fulfillment_status` dimension |
| `fulfillment_items` (Phase 5) | The picking list, one row per order line | `pick_status`, `picked_quantity`, `location_id` — deliberately separate from `order_items` (a financial snapshot); see docs/FULFILLMENT.md |
| `packages` (Phase 5) | One shippable unit; an order can have several | carrier, tracking, label, weight/dimensions, `shipment_status`, `shipped_at`/`delivered_at` |
| `package_items` (Phase 5) | Which order lines/quantities are in which package | enforces a line's units are never claimed by two packages at once |
| `shipping_events` (Phase 5) | Per-package shipment status timeline | same shape as `order_events`, for the package dimension |
| `return_requests` (Phase 5) | One customer return, possibly covering several lines | `status` (10-state machine), return-shipping cost/payer, return tracking |
| `return_items` (Phase 5) | Lines on a return | quantity, reason, description, photo URLs (plain HTTPS text fields — no file upload provider set up this phase), exchange flag |
| `return_inspections` (Phase 5) | At most one per `return_item` | condition, disposition — **only `disposition = 'restock'` ever writes an inventory movement**; see docs/RETURNS.md |
| `return_events` (Phase 5) | Return status timeline | same shape as `order_events`, for the return dimension |

`order_events` predates the brief's own table list; it is needed for order tracking and the admin timeline,
and Phase 5 follows the same pattern three more times (`fulfillment_events`, `shipping_events`,
`return_events`) rather than inventing one shared "events" table — each dimension's writer stays
independent of the others. `refunds` also gained a nullable `return_request_id` FK in Phase 5, tagging a
refund back to the return it came from without duplicating refund logic (docs/RETURNS.md).

## Design decisions

**Stock is on the variant, stored in `inventory`.** Brief §6 lists stock fields on the variant. They live in a 1:1 `inventory` table with the same names (`stock_quantity`, `reserved_quantity`, `reorder_level`). Checkout locks inventory rows with `SELECT … FOR UPDATE`. Keeping them apart from `product_variants` means an admin editing a product name or price never blocks, or is blocked by, a checkout. The view `variant_stock` gives the combined shape the brief describes:

`variant_stock`: variant, product, SKU, barcode, label, cost, price, `stock_quantity`, `reserved_quantity`, **`available_stock = stock_quantity − reserved_quantity`**, `reorder_level`, **`stock_status` (IN_STOCK / LOW_STOCK / OUT_OF_STOCK)**, `inventory_value_cents = stock × cost`.

**Customer statistics are not stored twice** (brief §15). The view `customer_stats` derives total orders, total spent, profit, average order value and first and last order date from paid orders. Lifetime value is total spent.

**Three order statuses, one source — with one deliberate exception.** `status` (the lifecycle),
`payment_status` and `fulfillment_status` are normally written together by `statusFields()` in
`lib/orders/service.ts`:

| status | payment_status | fulfillment_status |
|---|---|---|
| pending | unpaid (or failed) | unfulfilled |
| paid | paid | unfulfilled |
| processing | paid | processing |
| cancelled | unpaid, or refunded if it had been paid | cancelled |
| refunded | refunded | **unchanged** if it was already past `unfulfilled`, else `cancelled` (see below) |

`shipped`/`delivered` are **not** in this table on purpose: since Phase 5, those two are reached only
through the fulfillment/package rollup (`recomputeOrderFulfillmentStatus()`,
`lib/fulfillment/service.ts`), which writes `orders.status` itself at those two milestones without going
through `statusFields()` — see docs/ORDER_STATUS.md and docs/FULFILLMENT.md for why reusing it there would
overwrite the fine-grained Phase 5 status with a coarse one.

`payment_status` gained a fifth value in Phase 4, `partially_refunded` — reachable only from a standalone,
money-only partial refund (`refundOrder()`, docs/ORDER_LIFECYCLE.md), which never changes `status` or
`fulfillment_status`. The `refunded` row above changed in Phase 5: it used to unconditionally coerce
`fulfillment_status` to `returned` (or `cancelled`), which silently destroyed real operational history —
a refund is a money event and must not overwrite it (docs/ORDER_STATUS.md, docs/RETURNS.md). Whether an
order was actually returned lives in `return_requests.status` now, not here.

## Integrity enforced by the database (CHECK constraints)

| Constraint | Rule |
|---|---|
| `inventory_stock_non_negative` | `stock_quantity >= 0` |
| `inventory_reserved_valid` | `0 <= reserved_quantity <= stock_quantity` |
| `movement_math` | `stock_after = stock_before + quantity`, quantity ≠ 0 |
| `order_total_math` | `total = subtotal − discount + shipping + tax` |
| `order_profit_math` | `gross_profit = subtotal − discount − refund − cost_total` |
| `order_refund_bounds` | `0 <= refund <= subtotal − discount` |
| `order_item_line_math` | `line_total = qty × price − discount`, `line_cost = qty × cost`, `line_profit = line_total − line_cost` |
| `variant_price_positive`, `variant_cost_non_negative`, `variant_compare_at_above_price` | sane prices |
| `review_rating_range`, `discount_percent_range`, `refund_positive`, lower-case emails | |
| `shipping_method_price_non_negative` | `price_cents >= 0` |
| `payment_events_provider_event_uq` | unique `(provider, provider_event_id)` — the webhook idempotency guarantee lives here, not just in application code |
| `shipping_method_order_bounds_valid` (Phase 5) | `min_order_cents IS NULL OR max_order_cents IS NULL OR min_order_cents <= max_order_cents` |
| `fulfillment_item_picked_qty_valid` (Phase 5) | `picked_quantity >= 0` |
| `package_item_qty_positive` (Phase 5) | `quantity > 0` — same rule as `order_item`/`return_item` quantities |
| `return_item_qty_positive` (Phase 5) | `quantity > 0` |
| `return_shipping_cost_non_negative` (Phase 5) | `return_shipping_cost_cents >= 0` |
| `movement_non_zero` (pre-existing, load-bearing for Phase 5) | an inventory movement can never have `quantity = 0` — this is *why* a non-restock return disposition (repair/damaged/dispose/return_to_customer) correctly writes no movement at all rather than a zero-quantity one; see docs/RETURNS.md |

A bug in application code cannot write a negative stock level or an order whose numbers don't add up. The database rejects it, and the tests prove this.

## Indexes (brief §20)

| Need | Index |
|---|---|
| product slug, SKU, order number, customer email, staff email, discount code | unique indexes |
| barcode | `variants_barcode_idx` |
| order date | `orders_paid_at_idx`, `orders_placed_at_idx` |
| order status, payment status | `orders_status_idx`, `orders_payment_status_idx` |
| sales channel (+ date) | `orders_channel_paid_idx (channel_id, paid_at)` |
| product category, collection, status | `products_category_idx`, `products_collection_idx`, `products_status_idx` |
| inventory status | partial index `inventory_needs_attention_idx` (only rows where available ≤ reorder level) |
| movements | by variant + time, by time, by order, by reference |
| lines | by order, variant, product |

There are no speculative indexes. Each one serves a query in `lib/` or a dashboard filter planned for Phase 2.

## Row-level security (brief §21)

RLS is enabled on **every** table, and a test fails if a new table is added without it. Access for Supabase's public roles:

| Role | Can read | Cannot |
|---|---|---|
| `anon` | active products, active variants (**without** `cost_price_cents`), images, categories, collections, published reviews, active `shipping_methods` | orders, customers, inventory, movements, staff, audit, notifications, settings, payments, discounts, `payment_events`, `variant_stock` |
| `authenticated` (customer) | the above + **their own** customer row, addresses (read/write), wishlist (read/write), orders and order lines, and (Phase 4) their own `shipping_method_id` / `tracking_number` / `carrier`; (Phase 5) their own `packages` (safe columns: carrier/tracking/status/dates, never cost) and their own `return_requests`/`return_items` (read + insert, so a customer can create a return request directly, mirroring how orders already work) | anyone else's data; any cost, margin, fee, profit, or internal-notes column (column privileges); `payment_events`; every other Phase 5 table (`fulfillment_items`, `fulfillment_events`, `shipping_events`, `return_inspections`, `return_events`, `inventory_locations`, `package_items`) — staff-only, no customer policy, same pattern as `payments`/`refunds` |

The Next.js server connects as the database owner and enforces staff roles itself (see ROLES_AND_PERMISSIONS.md). The migration creates `anon`, `authenticated` and `auth.uid()` only if they are missing, so the same migration runs on Supabase and on plain Postgres for CI.

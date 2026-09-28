# Database schema

Source of truth: `src/lib/db/schema.ts`. Migrations: `drizzle/0000_init.sql` (tables, enums, indexes, constraints) and `drizzle/0001_views_and_rls.sql` (views, row-level security, grants).

## Conventions

- **Money** is integer cents, and every money column ends in `_cents`. No floats anywhere. `gross_margin` is the only decimal: a percentage, `numeric(7,2)`.
- **IDs** are UUIDs. Order numbers are human-readable (`ORD-10001`) and come from the sequence `order_number_seq`.
- **Emails** are stored lower-case, and a CHECK constraint enforces it, so uniqueness cannot be dodged with capital letters.
- **Timestamps** are `timestamptz`. Business days are cut in `STORE_TIMEZONE` at query time.

## Tables (25)

| Table | Purpose | Key points |
|---|---|---|
| `roles` | OWNER, ADMIN, SALES, INVENTORY, VIEWER | Reference data |
| `users` | Staff | `auth_user_id` → Supabase `auth.users`; `role`; `active` |
| `customers` | Shoppers | `user_id` → Supabase account once registered (guests have none); unique email |
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
| `orders` | One purchase | three statuses, customer amounts, profit snapshot, internal costs, addresses, notes |
| `order_items` | Lines, as snapshots | name, SKU and variant snapshots; price, cost, discount share, line total, cost and profit |
| `order_events` | Status timeline | Powers "order tracking" and the admin timeline |
| `payments` | Payment attempts | provider + `provider_ref` (e.g. a Stripe PaymentIntent). **Never card data.** |
| `refunds` | Refunds issued | `restocked` flag decides whether cost is reversed |
| `discounts` | Codes | percent, fixed, or free shipping; category or product scope; minimum, cap, dates, usage and per-customer limits |
| `discount_usages` | Who used which code on which order | Enforces per-customer limits |
| `wishlists` | Customer ↔ product | |
| `reviews` | Product reviews | `pending`, `published` or `hidden` (moderation) |
| `notifications` | Dashboard bell | new order, large order, low or out of stock, refund, payment failed, review, system |
| `audit_logs` | Who changed what | `actor`, `action`, `entity`, `entity_id`, `old_value`, `new_value`, time |
| `settings` | Store settings (JSON) | currency, tax, time zone, homepage content |

`order_events` is the 25th table. It is not in the brief's list, but it is needed for order tracking and the admin timeline.

## Design decisions

**Stock is on the variant, stored in `inventory`.** Brief §6 lists stock fields on the variant. They live in a 1:1 `inventory` table with the same names (`stock_quantity`, `reserved_quantity`, `reorder_level`). Checkout locks inventory rows with `SELECT … FOR UPDATE`. Keeping them apart from `product_variants` means an admin editing a product name or price never blocks, or is blocked by, a checkout. The view `variant_stock` gives the combined shape the brief describes:

`variant_stock`: variant, product, SKU, barcode, label, cost, price, `stock_quantity`, `reserved_quantity`, **`available_stock = stock_quantity − reserved_quantity`**, `reorder_level`, **`stock_status` (IN_STOCK / LOW_STOCK / OUT_OF_STOCK)**, `inventory_value_cents = stock × cost`.

**Customer statistics are not stored twice** (brief §15). The view `customer_stats` derives total orders, total spent, profit, average order value and first and last order date from paid orders. Lifetime value is total spent.

**Three order statuses, one source.** `status` (the lifecycle), `payment_status` and `fulfillment_status` are always written together by `statusFields()` in `lib/orders/service.ts`:

| status | payment_status | fulfillment_status |
|---|---|---|
| pending | unpaid (or failed) | unfulfilled |
| paid | paid | unfulfilled |
| processing / shipped / delivered | paid | processing / shipped / delivered |
| cancelled | unpaid, or refunded if it had been paid | cancelled |
| refunded | refunded | returned if it had shipped, otherwise cancelled |

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
| `anon` | active products, active variants (**without** `cost_price_cents`), images, categories, collections, published reviews | orders, customers, inventory, movements, staff, audit, notifications, settings, payments, discounts, `variant_stock` |
| `authenticated` (customer) | the above + **their own** customer row, addresses (read/write), wishlist (read/write), orders and order lines | anyone else's data; any cost, margin, fee or profit column (column privileges) |

The Next.js server connects as the database owner and enforces staff roles itself (see ROLES_AND_PERMISSIONS.md). The migration creates `anon`, `authenticated` and `auth.uid()` only if they are missing, so the same migration runs on Supabase and on plain Postgres for CI.

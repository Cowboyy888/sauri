# Project audit

Audited at git commit `569f85e` ("Baseline: foundation before Phase 1 brief"), before any Phase 1 changes.

## 1. What exists

There are two artifacts:

1. **`sauri.html` (prototype).** A single-file storefront and admin demo that keeps its data in browser localStorage. It is a visual and behavioral reference only. It has no server, no real authentication, and nothing in it is reused as code.
2. **This repository.** A Next.js project with a working data and business-logic core. It was built as an earlier foundation pass, and this audit covers it.

### Stack

| Area | Found |
|---|---|
| Framework | Next.js 15.5 (App Router), React 19, TypeScript 5.9 (strict, `noUncheckedIndexedAccess`) |
| Package manager | npm (`package-lock.json`) |
| Styling | Tailwind CSS 4 (PostCSS plugin). No shadcn/ui or Lucide yet. |
| Database | PostgreSQL through Drizzle ORM 0.45 + `pg`. Connection string in `DATABASE_URL`. |
| Supabase | **Not configured.** No Supabase client, no `supabase/` folder, no auth integration. |
| Authentication | **None for real users.** `src/middleware.ts` protects `/admin` with a temporary HTTP Basic password (`ADMIN_BASIC_AUTH`). |
| Authorization | Role matrix in `src/lib/auth/permissions.ts`. `assertCan()` is called inside the services, but no route resolves who the current user is. |
| Tests | Vitest, 19 integration tests against a real Postgres test database, including the business test |
| Scripts | `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `db:generate`, `db:migrate`, `db:seed`, `db:seed:demo` |
| Environment variables | `DATABASE_URL`, `TEST_DATABASE_URL`, `ADMIN_BASIC_AUTH`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (unused), `STORE_TIMEZONE` (optional) |

### Architecture

```
src/app/            thin pages and routes: /, /admin (KPI cards), /api/cart/quote, /api/health
src/lib/            business logic, no UI
  db/               schema.ts (25 tables), client.ts, reference-data.ts
  orders/           pricing.ts (pure totals), service.ts (quote, place, pay, status)
  inventory/        service.ts (row-locked movements, restock, adjust, reservations)
  discounts/        service.ts (validation, atomic usage)
  analytics/        service.ts (SQL aggregates, date ranges in the store time zone)
  auth/             permissions.ts (role matrix)
drizzle/            one generated migration (0000_init.sql)
scripts/            migrate, seed (+ catalog.json exported from the prototype)
tests/              vitest integration tests
```

### Existing features that work and are tested

- Transactional order placement with row locks (`SELECT … FOR UPDATE`, taken in a fixed order so concurrent orders cannot deadlock). Oversell is rejected, and a race for the last unit produces exactly one winner.
- Checkout reservations (`pending`) converted to a SALE on payment. Running payment confirmation twice has no effect.
- Every stock change writes a movement in the same transaction. The database checks `after = before + quantity` and refuses negative stock.
- Prices, costs and totals are computed on the server only. The quote API rejects unknown fields, such as a price.
- Discounts: minimum order, date window, usage limit (consumed atomically), per-customer limit, category scope.
- Refunds and cancellations restock (RETURN movements) and are written to the audit log.
- Analytics: KPIs, time series, breakdowns by product, category, material, SKU and channel, customer stats, and inventory forecast. Date ranges resolve in the store time zone.
- Demo seed replays 120 days of orders through the real order service. The stock ledger reconciles for every variant.

### Reusable as-is

`orders/pricing.ts` (pure math), the locking pattern in `inventory/service.ts`, `discounts/service.ts`, `errors.ts`, `money.ts`, `config.ts`, the test harness (`tests/global-setup.ts`, which refuses to wipe any database whose name does not end in `_test`), and the seed approach.

## 2. Problems found, measured against the Phase 1 brief

| # | Problem | Brief § | Severity |
|---|---|---|---|
| 1 | No real authentication. There is no link between a logged-in person and a staff role, and routes never check who is calling. | 17–18 | High |
| 2 | No row-level security. If the database were exposed through Supabase's public API, every table would be readable. | 21 | High |
| 3 | **Profit definition conflict.** The code subtracts payment fees and shipping cost from gross profit, as the earlier brief (§15) required. This brief (§11) defines gross profit as net revenue − COGS. | 11 | High, decision needed |
| 4 | Orders lack `order_number` text, `payment_status`, `fulfillment_status`, `cost_total`, `gross_profit`, `gross_margin`, `billing_address` and `notes`. Totals are named differently. | 9 | Medium |
| 5 | Order items lack per-line `discount`, `line_total`, `line_cost`, `line_profit` and a variant snapshot. | 10 | Medium |
| 6 | Products lack `collection_id` and `featured`. They use `is_new` / `is_best_seller` flags and a many-to-many `product_collections` table instead. | 5 | Low |
| 7 | Variants lack `compare_at_price`, `status` and `color` handling. Stock lives in a separate 1:1 `inventory` table, not on the variant. | 6–7 | Medium, design decision |
| 8 | Movements lack `RESTOCK`, `reference_type` and `reference_id`. | 8 | Low |
| 9 | Customers lack `user_id` and `updated_at`. The address table is named `addresses`, not `customer_addresses`. | 4, 15 | Low |
| 10 | Sales channels are keyed `web`, `store`, and so on, not the brief's codes (`WEBSITE`, `PHYSICAL_STORE`, …). | 16 | Low |
| 11 | `getOutOfStockProducts()` is missing. | 22 | Low |
| 12 | No notification that the dashboard should refresh when an order lands (order flow step 10). | 13 | Low |
| 13 | `analytics_snapshots` exists, but nothing writes to it. | – | Low (unused) |
| 14 | No `/docs` folder. | 26–27 | Required |
| 15 | `tsconfig.tsbuildinfo` was committed. | – | Housekeeping |

## 3. Recommended architecture

Keep the architecture. It already matches the target of one database and one business-logic layer, shared by the storefront and the dashboard. Fix the gaps above:

- **ORM: stay on Drizzle.** The brief asks for Prisma *or* the Supabase client, used consistently. Drizzle is the one data-access approach used everywhere in this repo. Prisma could not run in the build environment because it needs an engine binary download, so it was never verifiable there. Switching now would mean rewriting working, tested code for no functional gain. The services never expose the ORM to the UI.
- **Auth: Supabase Auth**, with staff linked to `users.auth_user_id`. The current user is resolved on the server, and every admin route and service checks roles.
- **Stock stays in the 1:1 `inventory` table** (brief #7). It holds `stock_quantity`, `reserved_quantity` and `reorder_level`, named as the brief asks. Keeping it separate means a product or price edit never locks the rows that checkout is locking. A view `variant_stock` presents the combined shape (variant + available + status) the brief describes.
- **Profit (#3):** follow this brief. Gross profit = net revenue − COGS. Payment fees and carrier costs are still recorded per order and reported separately as *contribution profit*, so nothing is lost.
- **Migrations:** no database has been deployed, so the initial migration is regenerated rather than stacked with a patch migration. Once anything is deployed, every change will be a new numbered migration.

## 4. Files

| Preserve (unchanged or lightly edited) | Modify | Remove eventually |
|---|---|---|
| `orders/pricing.ts`, `discounts/service.ts`, `errors.ts`, `money.ts`, `config.ts`, `tests/global-setup.ts`, `scripts/migrate.ts`, `scripts/data/catalog.json`, configs | `db/schema.ts`, `db/reference-data.ts`, `orders/service.ts`, `inventory/service.ts`, `analytics/service.ts`, `audit.ts`, `scripts/seed.ts`, all tests, `src/middleware.ts` (basic auth → Supabase session) | `src/app/page.tsx` and `src/app/admin/page.tsx` are wiring checks, to be replaced by the real UIs in later phases. `ADMIN_BASIC_AUTH` goes once Supabase Auth is live. The prototype `sauri.html` is a reference, not code. |

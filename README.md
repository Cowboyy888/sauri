# SAURI: jewelry commerce + business management

One Next.js app, one Postgres database. The storefront and the admin dashboard read and write the same records, so a single order updates orders, revenue, profit, inventory, movements, customer lifetime value, notifications and the dashboard at once.

## Status: phase 1 of 4 (foundation) is complete

| Check | Result |
|---|---|
| `npm run typecheck` | passes |
| `npm run lint` | passes, 0 warnings |
| `npm test` | 19/19 against real Postgres, including the §57 business test |
| `npm run build` | passes |
| Ledger check on demo data | stock on hand = sum of movements for all 142 variants |

## Run it

```bash
cp .env.example .env              # set DATABASE_URL (local Postgres or Supabase)
npm install
npm run db:migrate
npm run db:seed:demo              # or db:seed for catalog only, no demo orders
npm run dev                       # storefront at /, dashboard at /admin
npm test                          # needs TEST_DATABASE_URL; the database name must end in _test
```

**Supabase:** use the connection string from Project settings > Database. Migrations are plain SQL in `drizzle/`, so they can also be applied from the Supabase SQL editor.

## Architecture

```
src/lib/                    business logic: server-only, no UI
  db/schema.ts              all 25 tables from §45 (+ order_events, product_collections)
  db/reference-data.ts      roles, sales channels, categories, settings
  orders/pricing.ts         pure order math: the only place totals are calculated
  orders/service.ts         quoteCart, placeOrder, markOrderPaid, updateOrderStatus
  inventory/service.ts      row-locked stock changes, restock, adjust, reservations
  discounts/service.ts      server-side validation + atomic usage counting
  analytics/service.ts      SQL aggregates + the §53 functions (getRevenue … getCustomerLifetimeValue)
  auth/permissions.ts       OWNER / ADMIN / SALES / INVENTORY / VIEWER matrix, assertCan()
src/app/                    thin UI and route layer that calls lib/
drizzle/                    generated SQL migrations
scripts/                    migrate, seed (catalog.json exported from the prototype)
tests/                      integration tests against a real database
```

### Rules the code enforces

- **Money is integer cents.** Rounding happens in `money.ts` and `pricing.ts` only.
- **The browser sends only variant ids, quantities and a code.** The API rejects any other field with 400. Prices, costs, stock, discounts and totals are read from the database or computed on the server.
- **Stock cannot oversell.** Inventory rows are locked (`SELECT … FOR UPDATE`, in a fixed order to avoid deadlocks). The database also refuses negative stock and invalid reservations through CHECK constraints.
- **Every stock change writes a movement** in the same transaction, and the database checks `after = before + quantity`.
- **Checkout reserves; payment deducts.** A web order starts `pending` with its stock reserved. `markOrderPaid` (the future Stripe webhook) converts the reservation into a SALE movement, and running it twice changes nothing. In-store and manual orders are paid immediately.
- **Order lines snapshot price and unit cost,** so a later cost change never rewrites past profit.
- **Refunds and cancellations** return stock (RETURN movements), remove the revenue and cost of goods, and are audited.
- **Order totals are checked by the database:** `total = subtotal − discount + shipping + tax`.

### Profit definitions (identical on screen, in exports and in tests)

net revenue = gross − discounts − refunds · gross profit = net revenue − COGS − payment fees − shipping cost · margin = gross profit ÷ net revenue × 100. Tax and shipping charged to customers are pass-through, not revenue. Orders count from when they are paid, grouped in the store time zone (`STORE_TIMEZONE`, default Asia/Phnom_Penh).

## Roadmap

1. **Foundation: done.** Schema, migrations, services, analytics, RBAC matrix, seed, tests.
2. **Storefront.** Port the prototype design to components: home, collections with URL filters, product page with variants, cart, checkout, account, order tracking, reviews. SEO: metadata, JSON-LD, sitemap, robots, canonical URLs.
3. **Admin.** Staff login (Supabase Auth or Auth.js, replacing the temporary basic-auth guard in `middleware.ts`), then dashboard, charts (Recharts), orders, products and variant editor, inventory, movements, customers, discounts, reports with CSV / Excel / PDF export, audit log, notifications, and the mobile layout.
4. **Payments and realtime.** Stripe Checkout + webhook → `markOrderPaid`, Supabase Realtime for the live dashboard, rate limiting, row-level security policies, image storage.

## Why Drizzle instead of Prisma

The brief allows Prisma or the Supabase tooling. Drizzle is pure TypeScript, needs no engine binary, and works with Supabase Postgres. That meant every migration and test here could run against a real database. Business logic sits in `src/lib/*/service.ts` behind plain functions, so the UI never touches the ORM directly.

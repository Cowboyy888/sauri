# Architecture

## One system, not two

```
 CUSTOMER STOREFRONT (/)                         ADMIN DASHBOARD (/admin)
 pages · /api/cart/quote · checkout (Phase 3)    pages · /api/admin/*  (Phase 2)
            │                                              │
            │  only ids, quantities, codes, addresses      │  requireStaff(permission)  → 401 / 403
            ▼                                              ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                  src/lib : APPLICATION / BUSINESS LOGIC                  │
 │  orders/     pricing.ts (pure math) · service.ts (quote, place, pay,     │
 │              fail, status, refund)                                       │
 │  inventory/  row-locked stock changes, reservations, restock, adjust     │
 │  discounts/  server-side validation, atomic usage                        │
 │  marketing/  campaigns, promotions, email, event tracking (Phase 7)      │
 │  purchasing/ suppliers, purchase orders, receiving, stocktake (Phase 8)  │
 │  finance/    expenses, summary, cash flow, reconciliation, tax (Phase 9) │
 │  analytics/  SQL aggregates, date ranges in the business time zone       │
 │  auth/       permissions.ts (role matrix) · session.ts (who is calling)  │
 │  audit.ts    audit log · notifications · pg_notify events                │
 └─────────────────────────────────────────────────────────────────────────┘
                                   │  Drizzle ORM (server only)
                                   ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │  PostgreSQL / Supabase: one database                                     │
 │  25 tables · 2 views · CHECK constraints · RLS on every table            │
 └─────────────────────────────────────────────────────────────────────────┘
```

The storefront and the dashboard call the same functions in `src/lib`. An order placed by a shopper and an order entered by staff in the shop run through the same `placeOrder` transaction, write the same rows, and show up in the same analytics.

## Stack decisions

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 15 App Router, React 19, TypeScript (strict) | Server components and route handlers keep business logic on the server |
| Database | PostgreSQL (Supabase in production) | Transactions, row locks, CHECK constraints, RLS, views |
| Data access | **Drizzle ORM**, used everywhere | See "Why Drizzle" below |
| Auth | Supabase Auth (identity) + our `users` table (role) | Supabase verifies who you are. Our table decides what you may do. |
| Validation | Zod at every route boundary (`.strict()`, so unknown fields are rejected) | A browser cannot send a price or a cost |
| Styling / UI | Tailwind CSS 4; shadcn-style components on Radix primitives; Lucide icons; Recharts; IBM Plex Sans (bundled) | The shadcn CLI needs its registry, which was unreachable in the build environment, so the components were written in the same pattern by hand |
| Payments | Stripe (Vercel Marketplace, test mode), Checkout Sessions (`ui_mode: "embedded_page"`) + webhook. Pending order + reservation, `markOrderPaid` for the webhook | The browser can never mark an order paid — see docs/PAYMENTS.md, docs/WEBHOOKS.md |
| Realtime | `pg_notify('sauri_events', …)` on commit. Supabase Realtime subscriptions in Phase 2. | Dashboards refresh when an order lands |
| Storage | Supabase Storage URLs in `product_images.url` | Images later; the schema is ready |
| Tests | Vitest against a real Postgres database | Locks, constraints and RLS cannot be tested with mocks |

### Why Drizzle and not Prisma

The brief allows "Prisma OR Supabase client; choose one and remain consistent". This codebase uses one data-access approach throughout: Drizzle, which is plain TypeScript over `pg`.

- It needs no engine binary. Prisma's engine download was blocked in the build environment, so Prisma code could not have been migrated or tested there.
- Its SQL-first style suits the analytics, which are hand-written aggregate queries.
- The UI never imports the ORM. Only `src/lib` does, so the choice is contained.

The Supabase JS client is used **only** for authentication (`@supabase/ssr`), never for data.

## Security layers

1. **Route boundary.** Zod validates every body. `requireStaff(permission)` resolves the caller and checks the role (401 or 403).
2. **Service.** Every mutating service calls `assertCan(actor, permission)` again, so a route that forgets its check is still protected.
3. **Database.** CHECK constraints make impossible states unrepresentable: negative stock, totals that don't add up, broken line math. Row-level security protects everything reachable through Supabase's public API.
4. **Secrets.** `DATABASE_URL` is server-only. The browser only ever sees `NEXT_PUBLIC_SUPABASE_URL` and the anon key, which RLS protects. The service-role key is not used at all.

## Folder map

```
src/app/                 pages and route handlers (thin); admin under src/app/admin/(console);
                         storefront under src/app/(shop); /checkout, /api/webhooks/stripe, /api/cron/*
src/components/admin     dashboard components (KPICard, SalesChart, DataTable, DateRangePicker, …)
src/components/storefront storefront components (cart, checkout, product, account, layout)
src/components/ui        shadcn-style primitives on Radix (button, field, card, dialog, menu)
src/lib/admin            admin read models, reports, range handling, page guard; Phase 5: fulfillment.ts, returns.ts, shipping-methods.ts
src/lib/payments         Stripe client + checkout session creation (server-only)
src/lib/storefront       storefront read models (catalog, account, wishlist, shipping)
src/lib/fulfillment      Phase 5: stage advancement, picking, packages, shipment status, the fulfillment rollup
src/lib/returns          Phase 5: return request → inspection → refund workflow, return policy
src/lib/analytics        sales/products/customers/channels; Phase 5: shipping.ts, returns.ts; Phase 6: retention.ts, wishlist.ts; Phase 7: marketing.ts; Phase 8: purchasing.ts
src/lib/crm              Phase 6: tags, notes, communications, consent, segments, RFM, merge, anonymize
src/lib/loyalty          Phase 6: points, tiers, rewards, redemption — reuses the discount engine
src/lib/reviews          Phase 6: review submission/eligibility, moderation history
src/lib/marketing        Phase 6: abandoned-cart tracking (signed-in customers only); Phase 7: campaigns.ts,
                         promotions.ts, email-campaigns.ts, events.ts, settings.ts
src/lib/purchasing       Phase 8: suppliers.ts, orders.ts, receiving.ts, stocktake.ts, pdf.ts
src/lib/finance          Phase 9: expenses.ts, expense-categories.ts, summary.ts, cash-flow.ts,
                         reconciliation.ts, snapshots.ts, tax.ts, customer-payments.ts, supplier-payments.ts,
                         refunds.ts, product-profitability.ts, inventory-value.ts
src/lib/                 all business logic (server-only)
src/middleware.ts        coarse sign-in gate + Supabase session refresh for /admin
drizzle/                 SQL migrations (0000 schema, 0001 views + RLS, 0002 dashboard, 0003+ Phase 4: payment_events, shipping_methods, refund/tracking columns; 0007+0009+0010 Phase 5: fulfillment/shipping/returns tables + RLS; 0011-0013 Phase 6: CRM/loyalty tables + RLS; 0014-0015 Phase 7: marketing tables + RLS; 0016-0017 Phase 8: purchasing/supplier tables + RLS + variant_stock view update; 0018-0019 Phase 9: finance tables + RLS)
scripts/                 migrate, seed (+ data/catalog.json)
tests/                   integration tests (real Postgres, real Stripe test mode)
docs/                    this documentation
```

## Environments

| Variable | Where | Notes |
|---|---|---|
| `DATABASE_URL` | server | Supabase session-pooler connection string |
| `STORE_TIMEZONE` | server | defaults to `Asia/Phnom_Penh`; all "today / this year" logic uses it |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | server + browser | public by design |
| `AUTH_DEV_STAFF_EMAIL` | local only | acts as that staff member when Supabase is not configured; ignored in production |
| `TEST_DATABASE_URL` | tests | database name must end in `_test`; wiped on every run |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | server / server+browser | test-mode keys, provisioned via Vercel Marketplace; see docs/PAYMENTS.md |
| `STRIPE_WEBHOOK_SECRET` | server | from `stripe listen` (local) or the Stripe Dashboard webhook endpoint (production); see docs/WEBHOOKS.md |
| `CRON_SECRET` | server | authorizes `/api/cron/release-reservations`; Vercel Cron sends it automatically once set |

Without Supabase configured, `/admin` and `/api/admin/*` return **404 in production**. There is no way in.

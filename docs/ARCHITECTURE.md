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
| Payments | Stripe-ready: pending order + reservation, `markOrderPaid` for the webhook | The browser can never mark an order paid |
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
src/app/                 pages and route handlers (thin); admin under src/app/admin/(console)
src/components/admin     dashboard components (KPICard, SalesChart, DataTable, DateRangePicker, …)
src/components/ui        shadcn-style primitives on Radix (button, field, card, dialog, menu)
src/lib/admin            admin read models, reports, range handling, page guard
src/lib/                 all business logic (server-only)
src/middleware.ts        coarse sign-in gate + Supabase session refresh for /admin
drizzle/                 SQL migrations (0000 schema, 0001 views + RLS)
scripts/                 migrate, seed (+ data/catalog.json)
tests/                   integration tests (real Postgres)
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

Without Supabase configured, `/admin` and `/api/admin/*` return **404 in production**. There is no way in.

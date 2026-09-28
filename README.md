# SAURI: jewelry commerce + business management

One Next.js app, one Postgres database. The storefront and the admin dashboard read and write the same records, so a single order updates orders, revenue, profit, inventory, movements, customer lifetime value, notifications and the dashboard at once.

## Status: Phase 1 (foundation) complete, awaiting approval for Phase 2

`npm run lint` ✓ · `npm run typecheck` ✓ · `npm test` ✓ 41/41 on real Postgres, including the business test · `npm run build` ✓

Documentation: [`docs/`](docs): PROJECT_AUDIT, ARCHITECTURE, DATABASE_SCHEMA, BUSINESS_LOGIC, ROLES_AND_PERMISSIONS, ANALYTICS, ERD.

## Run it

```bash
cp .env.example .env              # set DATABASE_URL (local Postgres or Supabase)
npm install
npm run db:migrate
npm run db:seed:demo              # or db:seed for catalog only, no demo orders
npm run dev                       # set AUTH_DEV_STAFF_EMAIL=owner@sauri.example to open /admin locally
npm test                          # needs TEST_DATABASE_URL; the database name must end in _test
```

**Supabase:** use the connection string from Project settings > Database. Migrations are plain SQL in `drizzle/`, so they can also be applied from the Supabase SQL editor.

## Where things are

See `docs/ARCHITECTURE.md`. In short: `src/lib` holds all business logic (server-only), `src/app` holds thin pages and routes, `drizzle/` holds the migrations, and `tests/` holds the integration tests.

## Roadmap

1. **Foundation**: done (this phase).
2. **Admin business dashboard**: staff sign-in, sales and revenue charts, profit, orders, inventory and low-stock alerts, product management, customer analytics, reports and exports.
3. **Storefront and checkout**: the luxury storefront UI, Stripe Checkout + webhook → `markOrderPaid`.
4. **Hardening**: rate limiting, Supabase Storage images, realtime subscriptions, SEO (sitemap, structured data).

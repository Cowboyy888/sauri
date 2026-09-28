# Admin business dashboard (Phase 2)

Every number in the admin comes from Postgres through `src/lib`. Nothing is hard-coded, random, or added up in the browser.

## Routes

| Route | Permission | What it shows |
|---|---|---|
| `/admin/login` | public | Supabase email + password. Without Supabase, in development only: a "sign in as" list of seeded staff |
| `/admin` → `/admin/dashboard` | `dashboard:read` | Business overview (below) |
| `/admin/analytics/sales` | `sales:read` | Revenue, orders, units, AOV, COGS, gross profit, margin + four trends |
| `/admin/analytics/products` | `sales:read` | Every product: units, revenue, COGS, profit, margin, stock. Sortable, including products with no sales |
| `/admin/analytics/customers` | `sales:read` | New vs returning, repeat rate, average customer value, lifetime value, revenue per customer, growth chart, top customers |
| `/admin/analytics/channels` | `sales:read` | All eight channels: revenue, change, orders, profit, margin, AOV, share |
| `/admin/orders`, `/admin/orders/[id]` | `orders:read` (actions `orders:write`) | Search, filters (status, payment, channel, customer, date), sort, pagination. Detail: items with cost and profit, what the customer paid, profit, payment, shipping, timeline, stock movements, status actions |
| `/admin/products`, `/new`, `/[id]` | `products:read` / `products:write` | Debounced server search (name, SKU, barcode, category, variant), filters, pagination. Editor tabs: General, Variants, Images, Inventory, SEO, Analytics, Reviews |
| `/admin/inventory` | `inventory:read` | KPIs, current inventory table, low stock (most urgent first), out of stock (best sellers first), value by category and product, value trend (estimate) |
| `/admin/inventory/movements` | `inventory:read` | The full ledger: date, product, SKU, type, quantity, before, after, reference, user, notes |
| `/admin/customers`, `/[id]` | `customers:read` | List sorted by revenue, profit, orders, AOV, last order or customer since. Detail: history, totals, lifetime value, favorite categories, recent products, wishlist, addresses |
| `/admin/reports` | `reports:read` | Nine reports: preview, CSV, Excel, PDF |
| `/admin/discounts`, `/reviews`, `/content`, `/audit-log` | OWNER | Manage codes, moderate reviews, edit storefront text, audit trail |
| `/admin/settings`, `/admin/profile` | OWNER / everyone | Staff and roles, permission matrix, store rules / your role and permissions |

APIs: `/api/admin/reports/[key]?format=csv\|xlsx\|pdf&range=…`, `/api/admin/search`, `/api/admin/notifications` (GET, POST to mark read), `/api/admin/events` (live updates), `/api/admin/analytics/summary`, `/api/admin/inventory/restock`, `/api/admin/orders/[id]/status`.

## Dashboard

- **Date range** (`<DateRangePicker/>`): Today, Yesterday, 7D, 30D, 90D, YTD, Custom. It is stored in the URL (`?range=30d` or `?from=2026-09-01&to=2026-09-28`), so every view can be shared. Days are cut in `STORE_TIMEZONE`.
- **Comparison:** each figure is compared with the previous equivalent period (a 28-day range against the 28 days before it; "today" against yesterday up to the same time). If the previous value is zero, the card says "No comparison" instead of printing a meaningless percentage.
- **Sections**, each loading independently with a skeleton, an empty state and an error state with Retry:
  - KPI cards: total revenue, orders, gross profit, gross margin, AOV, units sold, new customers, inventory value
  - Sales overview chart: revenue / orders / profit / units, area or line, previous period dashed, tooltip with all four exact values, "View as table"
  - Revenue breakdown: gross sales → discounts → refunds → net revenue → COGS → gross profit, with shipping and tax shown separately as pass-through
  - Profit: revenue, COGS, gross profit, margin (the formula is shown) + profit trend
  - Low stock, with Restock / Adjust; out of stock, with last sold and 30-day sales
  - Recent orders; top products (sort by units, revenue, profit, margin)
  - Sales by category (click a category for its products); sales by channel
  - Inventory summary and value by category
- **On phones** the order changes so KPIs, stock alerts and recent orders come first. Charts scroll sideways instead of squashing.
- **Refresh:** a Refresh button and an "Updated" time. **Live:** each open admin tab holds one `EventSource` on `/api/admin/events`, fed by Postgres `LISTEN sauri_events`. Orders, refunds and stock changes call `pg_notify`, which is delivered only after the transaction commits. The page then re-renders on the server with the new figures. With Supabase, use the Session pooler or a direct connection: LISTEN does not work through the Transaction pooler.

## Actions (server actions in `src/app/admin/actions.ts`)

Each action checks the role on the server, validates its input with zod, calls the service (which checks the role again and writes the audit log), then refreshes every admin page. The actions:

- Restock (transaction: stock + RESTOCK movement + weighted-average cost + audit + refresh)
- Adjust stock (counted level + reason + optional reorder level)
- Order status, cancel or refund (with or without restock)
- Create, edit, duplicate, archive or delete a product (delete is refused once a product has stock or sales history)
- Variant price, cost and status; add a variant; add or remove images
- Review moderation; storefront content; discounts; staff roles (the last active owner can't be removed)

## Reports and exports

`src/lib/admin/reports.ts` defines each report once, and the same rows feed the on-screen preview and every file format:

- **CSV:** UTF-8 with BOM for Excel, CRLF line endings. Cells that start with `= + - @` are neutralised against spreadsheet formula injection.
- **Excel:** real number, currency, percentage and date formats; frozen header; autofilter; an "About" sheet with the period and time zone.
- **PDF:** landscape for wide reports, totals row, page numbers.

Date-bound reports use the selected range. Inventory and low stock are a snapshot as of now, and say so.

## Performance

- Every figure comes from a SQL aggregate. Lists are paginated on the server (25 to 40 rows).
- Search uses `ILIKE` backed by trigram indexes (migration 0002). Sort columns come from a whitelist and are never taken raw from the URL.
- Each dashboard section runs one or two aggregate queries, and the sections load in parallel.
- If the order history grows very large, a daily rollup table refreshed from the same event channel is the next step (see ANALYTICS.md).

## Design

The dashboard uses IBM Plex Sans (bundled locally, with tabular figures), a warm neutral canvas, white cards, 1px borders, one deep green accent, and a muted gold for profit. Status badges share one color mapping everywhere. Charts start their axes at zero with round-number ticks, use one hue per series, and show exact values in tooltips. The storefront's editorial look is kept separate for Phase 3.

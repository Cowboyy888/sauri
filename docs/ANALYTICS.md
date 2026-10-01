# Analytics

`src/lib/analytics/service.ts`. Every figure is an aggregate SQL query run on the server. The browser receives numbers, never raw rows to add up.

## Definitions

These are used identically on screen, in exports and in tests.

| Metric | Definition |
|---|---|
| Recognized order | an order that was paid (`paid_at` set). It is counted in the period of `paid_at`. |
| Gross sales | Σ subtotal (before discounts) |
| **Revenue** | Σ line totals = gross sales − discounts |
| Refunds | Σ `refund_total` |
| **Net revenue** | revenue − refunds |
| **COGS** | Σ `cost_total`, the unit cost snapshot × quantity. Goods returned to stock stop counting. |
| **Gross profit** | net revenue − COGS |
| **Gross margin %** | gross profit ÷ net revenue × 100 |
| **Average order value** | net revenue ÷ orders |
| Units sold | Σ quantity on orders that were not refunded |
| Contribution profit | gross profit − payment fees − carrier costs (reported separately) |
| Inventory value | Σ **available** stock × current cost price (Phase 2 brief §18). Units reserved by unpaid checkouts are excluded until they sell or are released. The on-hand value (stock × cost) is kept as `variant_stock.on_hand_value_cents`. |

Tax collected and shipping charged are pass-through, not revenue.

> **Changed from the first brief:** that brief subtracted payment fees and shipping inside gross profit. This Phase 1 brief (§11) defines gross profit = net revenue − COGS, so gross profit now follows that. Fees and carrier costs are still recorded on every order and reported as **contribution profit**, so the owner can see both.

## Date ranges and time zone

`resolveRange(db, key, custom?)` supports `today`, `yesterday`, `7d`, `30d`, `90d`, `ytd` (this year), `all` and `custom` (YYYY-MM-DD to YYYY-MM-DD, inclusive). Boundaries are computed **by Postgres in `STORE_TIMEZONE`** (default Asia/Phnom_Penh), never in the browser's time zone. A test places an order at 18:30 UTC on 10 March, which is 01:30 on 11 March in Phnom Penh, and confirms it counts on 11 March.

Each range carries its **previous period**: the same length, ending where the range starts. For "today", the comparison is yesterday up to the same time of day, so a morning is never compared against a whole day.

## Functions (brief §22)

| Function | Returns |
|---|---|
| `getMetrics(range)` | **all headline KPIs in one query.** Use this on dashboards. |
| `getRevenue`, `getNetRevenue`, `getCOGS`, `getGrossProfit`, `getGrossMargin`, `getOrders`, `getUnitsSold`, `getAverageOrderValue` | single figures (thin wrappers over `getMetrics`) |
| `getInventoryValue()` | Σ stock × cost |
| `getLowStockProducts()`, `getOutOfStockProducts()` | variants by status, with forecast |
| `getTopProducts(range, sortBy, limit)` | sort by revenue, units, profit or margin |
| `getTopCustomers(limit)`, `getCustomerLifetimeValue(customerId)` | from the `customer_stats` view |
| `getSalesByCategory(range)`, `getSalesByChannel(range)` | with share of revenue |
| `getSalesBy(range, "product" \| "category" \| "material" \| "sku")` | line-level breakdowns from **snapshots**, so renamed products still report correctly |
| `getSeries(range, unit?)` | zero-filled time series: hour for ≤ 1.5 days, day for ≤ 95 days, week for ≤ 400 days, month beyond |
| `getInventory({ onlyAttention })` | every variant: stock, reserved, available, status, value, sold in the last 7 and 30 days, **forecast** |
| `getCustomerAnalytics(range)` | new vs returning customers, repeat purchase rate, average lifetime value, average order value, revenue per customer |

## Phase 4

No changes. An order paid through the Stripe webhook is written by the same `markOrderPaid` function, into
the same `orders`/`order_items` rows, as any other paid order — every function below already reports it
correctly with no new code. This is checked directly in `tests/checkout-e2e.test.ts`, which reads
`getMetrics()` immediately after a real checkout + webhook and asserts revenue/COGS/gross profit.

## Added in Phase 7

`lib/analytics/marketing.ts` — marketing/campaign/channel performance, the conversion funnel, product/
collection funnel columns, search analytics, back-in-stock demand, and abandoned-cart recovery analytics.
See docs/MARKETING_ANALYTICS.md for every metric's exact definition and docs/EVENT_TRACKING.md for the new
`marketing_events` log these read from. Money figures still come exclusively from `orders`/`order_items`
(joined through the new `marketing_attributions` snapshot for campaign/channel grouping — docs/ATTRIBUTION.md)
— nothing here duplicates a total the sales dashboard already computes; only behavioral counts (sessions,
views, cart adds) are new data.

## Added in Phase 8

`lib/analytics/purchasing.ts` — supplier performance (purchase orders, units purchased, total spend, average
cost, average lead time, late deliveries, rejected/damaged quantity — "only calculate metrics supported by
actual receiving data," brief §34) and purchase analytics (purchase spend, units purchased, average cost,
open POs, incoming inventory value, spend by supplier). See docs/PURCHASING.md and docs/PURCHASE_WORKFLOW.md.

**Purchase spend is never COGS, and is never added to it.** `getPurchaseVsSales()` reports Sales Revenue,
Purchase Spend, COGS and Inventory Value as four clearly separate numbers on the same screen
(`/admin/analytics/purchases`) specifically so they can never be confused — COGS still comes exclusively
from `orders.cost_total_cents` (this page's own definition above), completely unaffected by purchasing
activity; see docs/INVENTORY_COSTING.md for why a purchase changes the *going-forward* cost, never a
past sale's recorded COGS.

## Added in Phase 5

Two new files, `lib/analytics/shipping.ts` and `lib/analytics/returns.ts`, plus their pages
`/admin/analytics/shipping` and `/admin/analytics/returns` (new tabs on `AnalyticsNav`). Both compute from
live Phase 5 tables, never from a cached/derived figure:

| Metric | Definition | Zero-safety |
|---|---|---|
| Return rate | returned orders ÷ completed orders × 100 | `null` (not `0%`) when there are zero completed orders in the period |
| Fulfillment time | avg(`shipped_at` − `paid_at`) | orders missing either timestamp are excluded from the average, never treated as zero |
| Delivery time | avg(`delivered_at` − `shipped_at`) | same rule |

"Completed" for the return-rate denominator means `fulfillment_status in ('delivered','completed')`, dated
by `paid_at` like every other order-based report here; "returned" means a distinct order with a
non-rejected `return_requests` row. `shipped_at`/`delivered_at` are read from `order_events` (the moment
`recomputeOrderFulfillmentStatus` — docs/FULFILLMENT.md — flips the order-level status), not from an
individual package's own timestamps, since one order can have several packages.

The main dashboard also gained `FulfillmentKpiSection` (`components/admin/dashboard/sections.tsx`):
counts of orders currently `processing`, `picking`+`packing`, `ready_to_ship`+`partially_shipped`, and
returns still needing action (`requested` + `received` status), each linking into `/admin/fulfillment` or
`/admin/returns`. Visible only to roles with `inventory:write` (the same gate the rest of the operational
dashboard already uses).

## Added in Phase 9

`lib/finance/summary.ts` is the one authoritative financial calculation service (brief §14): `getGrossSales`,
`getDiscounts`, `getRefunds`, `getNetRevenue`, `getCOGS`, `getGrossProfit`, `getGrossMargin`,
`getOperatingExpenses`, `getOperatingProfit`, `getOperatingMargin`, `getCustomerPayments`,
`getSupplierPayments`, `getCashIn`, `getCashOut`, `getNetCashFlow`, `getOutstandingSupplierPayments`,
`getOverdueSupplierPayments`, and the combined `getFinancialSummary(range)` for the Financial Overview page.
The dollar figures for revenue/COGS/profit are read straight from `getMetrics()` above — nothing here
recomputes them. Two things are genuinely new:

- **Accrual vs. cash.** Operating expenses for the P&L (`getOperatingExpenses`) sum expenses with status
  APPROVED or PAID, dated by `expense_date` (when the cost was incurred). Cash flow (`getExpensesCashOutCents`
  inside `getCashOut`) sums only PAID expenses, dated by `paid_at` (when money actually left). The same
  distinction applies to revenue vs. cash in — see docs/CASH_FLOW.md.
- **N/A margins.** `getGrossMargin`/`getOperatingMargin` return `null` (not the pre-existing `getMetrics()`
  convention of `0`) when net revenue is zero, matching brief §32's explicit requirement. This is computed
  independently in `lib/finance/summary.ts`, not by changing `getMetrics()` itself — every Phase 1-8 page
  that already reads `grossMarginPct` keeps its established zero-on-zero display, unchanged.

Also new: `lib/finance/cash-flow.ts` (bucketed cash-in/cash-out/net/cumulative series), `lib/finance/tax.ts`
(tax report from real `orders.tax_total_cents`, never a re-derived guess), `lib/finance/refunds.ts` and
`lib/finance/product-profitability.ts` (both allocate an order-level refund pro rata across its lines for
reporting — an estimate, labeled as such, never stored as fact). See docs/FINANCIAL_CALCULATIONS.md,
docs/CASH_FLOW.md, docs/TAX_REPORTING.md and docs/FINANCIAL_REPORTS.md.

## Added in Phase 2

- `getMetrics` also returns shipping charged and tax collected, for the revenue breakdown.
- `getSeries(range, { unit, productId })` returns COGS per bucket and can be limited to one product.
- `getCustomerSeries` returns new vs returning customers per bucket, plus the cumulative number of buyers.
- `getSalesBy(range, by, { categorySlug, productId })` supports category drill-down. Every group row now carries AOV.
- Admin read models live in `src/lib/admin/*`: paginated products, orders, customers, stock and movements; low and out-of-stock lists; value by category and product; the inventory value trend (an estimate rebuilt from the movement ledger at today's costs); notifications; audit log; global search; reports.

## Forecast (estimates; label them so in the UI)

`average daily sales = units sold in the last 30 days ÷ 30` · `estimated days remaining = available ÷ average` · `suggested reorder = round up to 5 of (average × 45 days + reorder level − available)`. The 45-day cover is a parameter.

## Consistency guarantees (tested)

Breakdowns by time, product, category, material, SKU and channel each **sum to the same net revenue** as the headline KPI. A test asserts this, so the charts can never disagree with the totals.

## Performance

- A dashboard needs one `getMetrics` query per period, plus one per breakdown. No per-order loops run in JavaScript.
- Indexes on `paid_at`, `(channel_id, paid_at)`, `status` and `payment_status` serve every range filter.
- Order-level profit columns mean most KPIs never touch `order_items`.
- If the order history grows into the hundreds of thousands, add a daily rollup table refreshed on commit. The event channel already signals when to refresh it. It is not needed yet, so it isn't built.

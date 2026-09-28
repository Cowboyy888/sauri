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

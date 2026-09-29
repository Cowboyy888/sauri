# Customer Analytics (Phase 6)

`/admin/analytics/customers` (extended, Phase 2 already existed) and the new `/admin/analytics/retention`.
See docs/ANALYTICS.md for the shared range/comparison conventions every analytics page uses, docs/RFM.md
and docs/CUSTOMER_SEGMENTS.md for the related segment/RFM systems shown alongside these figures.

## `/admin/analytics/customers` — dashboard metrics (brief §6)

`getCustomerAnalytics()` (`lib/analytics/service.ts`), extended in Phase 6 with the metrics the brief's
dashboard list required but the function didn't yet return:

| Metric | Definition |
|---|---|
| Total customers | `count(*)` from `customers` excluding merged-away rows |
| Customers with / without orders | Split of total customers by `customer_stats.total_orders > 0` |
| New customers | Recognized-order buyers whose *first* recognized order falls in the period |
| Returning customers | Recognized-order buyers whose first recognized order was *before* the period |
| Repeat purchase rate | All-time: buyers with 2+ recognized orders ÷ all buyers |
| Orders per customer | All-time: total recognized orders ÷ buyers |
| Average customer value | Net revenue in the period ÷ distinct buyers in the period |
| Customer lifetime value | All-time net spend ÷ all-time buyers (the per-customer figure; `getCustomerLifetimeValue()` in the same file is the single-customer version, brief §7) |
| Average order value | Net revenue in the period ÷ orders in the period |

This page also shows the **RFM distribution** (brief §5 — how many customers are currently Recent/Active/
At Risk/Inactive, docs/RFM.md) and **wishlist** figures (brief §18 — most-wishlisted products and the
conversion rate, `lib/analytics/wishlist.ts`), so a business owner doesn't need to cross-reference three
different pages to answer "who buys, what do they prefer, are they coming back."

## `/admin/analytics/retention` — retention & cohorts (brief §30-31)

`lib/analytics/retention.ts`. Every figure is precisely defined and documented as a hint on its own card —
see the file's own doc comment for the exact SQL-level definitions. In summary:

- **Repeat purchase rate** / **Second purchase rate** — the latter specifically measures whether a
  first-time buyer in the selected period ever came back, distinct from the dashboard's simpler all-time
  repeat rate.
- **Retention rate** — of customers who bought in the *previous* period of the same length, the share who
  bought again in the selected period. **Churn (proxy)** is `100% − retention rate` — explicitly labeled a
  proxy, never presented as a prediction that a given customer will not return, per the brief's own
  instruction ("do not present estimates as exact churn unless the methodology supports it").
- **Average days between orders** — the average gap between a customer's consecutive recognized orders,
  computed across all their orders (not scoped to the selected period, since a single period rarely
  contains two orders from the same customer — scoping it would starve the average of data).

Every percentage is `null` ("No data"), never a fabricated `0%`, when there's nothing to compute it from
(e.g. no orders existed in the equivalent previous period yet).

### Cohort retention (brief §31)

`getCohortAnalysis()` groups customers by the calendar month of their *first* recognized order, then for
each subsequent month reports the share of that cohort that placed at least one more recognized order in
it. A cell is `null` (shown as `—`, never a fabricated `0%`) when that month is in the future relative to
today — "only show percentages where sufficient data exists" is enforced structurally, not by convention.

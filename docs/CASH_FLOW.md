# Cash flow (Phase 9, brief §12)

## Revenue ≠ cash received, expense ≠ cash paid

This page (`/admin/finance/cash-flow`) and its underlying functions (`lib/finance/cash-flow.ts`,
`lib/finance/summary.ts#getCashIn`/`getCashOut`/`getNetCashFlow`) are the **only** place in the admin that
reports actual cash movement. Every other revenue/profit figure in this codebase is accrual: recognized
when an order is paid or a cost is incurred, independent of when money physically moved. See
docs/FINANCIAL_CALCULATIONS.md for the exact two-date (`expense_date` vs. `paid_at`) mechanism behind this.

## What counts as cash in

Customer payments only (`payments.status = 'succeeded'`), dated by the order's `paid_at`. There is no
"other income" source in this build, so cash in = customer payments exactly; the architecture doesn't
prevent adding one later, but nothing invents a nonzero "other income" figure today.

## What counts as cash out

Three real, existing sources, unioned by date:

1. **Supplier payments** — `purchase_payments`, dated by `paid_at`. The one write path is
   `recordPurchasePayment()` (Phase 8), unchanged.
2. **Expenses actually paid** — `expenses` where `status = 'PAID'`, dated by `paid_at`. An APPROVED-but-
   unpaid expense does **not** appear here (it's already in the accrual P&L, but not yet cash out).
3. **Refunds** — `refunds`, dated by `created_at` (when the refund was actually processed/recorded, not
   when the original sale happened). This is a deliberate, different date convention from `getMetrics()`'s
   own refund total (which is dated by the *order's* `paid_at`, an accrual view) — see "Two dates for one
   refund" below.

There is no "other recorded outflow" source yet either — same reasoning as cash in.

## Two dates for one refund

`getMetrics().refundCents` (accrual: how much of *this period's recognized revenue* was given back) sums
`orders.refund_total_cents` for orders whose **`paid_at`** falls in the period — a refund processed next
month against an order sold this month still reduces *this month's* recognized net revenue, because the
mutable `orders.refund_total_cents` column moves with the order, not with the calendar date the refund
happened. `getRefundsCashOut()` (cash: how much cash actually left this period) instead sums individual
`refunds` rows by their own `created_at`. Both are correct for what they measure; conflating them would be
the actual bug. This is why "Refunds" appears as its own outflow line here rather than being netted against
"Cash in" — the brief's own structure (§12: Cash Inflows vs. Cash Outflows as separate sections, refunds
listed under outflows) matches this exactly.

## Why no `financial_transactions` ledger table

See docs/FINANCE_AUDIT.md §2 and docs/FINANCE_ARCHITECTURE.md — cash flow is computed by `UNION ALL`-ing the
three real source tables in `lib/finance/cash-flow.ts`, bucketed the same `generate_series`/`date_trunc` way
`analytics/service.ts#getSeries` already buckets sales, rather than duplicating those rows into a fifth table.

## Cumulative position

`getCashFlowSeries()` computes a running total of `netCents` per bucket in application code (not SQL window
functions, to keep the query simple), optionally seeded with an `openingBalanceCents` — currently always
`0` (no prior-period cash position is tracked), so the cumulative line for a range always starts at zero.
This is documented rather than silently treated as the store's actual bank balance.

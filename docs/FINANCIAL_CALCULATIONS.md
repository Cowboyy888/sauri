# Financial calculations (Phase 9, brief §4)

Every formula below is implemented once, in `lib/finance/summary.ts` (or a function it calls). No UI
component recomputes any of these — see docs/FINANCE_AUDIT.md and docs/FINANCE_ARCHITECTURE.md.

## Definitions

| Line | Formula | Source |
|---|---|---|
| Gross sales | Σ order-item line totals before refunds | `getMetrics().grossSalesCents` (Phase 1) |
| Discounts | Σ order discounts | `getMetrics().discountCents` |
| Refunds | Σ completed refunds | `getMetrics().refundCents` — sums `orders.refund_total_cents`, which already includes both the full-refund-via-cancellation path and the standalone partial-refund path (`refundOrder()`), so this never needs a second refund total |
| Net revenue | Gross sales − discounts − refunds | `getMetrics().netRevenueCents` |
| COGS | Σ (unit cost × quantity sold) | `getMetrics().cogsCents` — the cost snapshot taken at sale time, unaffected by later purchasing activity (docs/INVENTORY_COSTING.md) |
| Gross profit | Net revenue − COGS | `getMetrics().grossProfitCents` |
| Gross margin | Gross profit ÷ net revenue × 100 | `getGrossMargin()` — **`null` when net revenue is 0**, not `0%` |
| Operating expenses | Σ posted (APPROVED or PAID) expenses, by `expense_date` | `getOperatingExpenses()` — accrual basis |
| Operating profit | Gross profit − operating expenses | `getOperatingProfit()` |
| Operating margin | Operating profit ÷ net revenue × 100 | `getOperatingMargin()` — **`null` when net revenue is 0** |
| Cash in | Actual completed customer payment inflows | `getCashIn()` = `getCustomerPayments()` — Σ `payments.amount_cents` where `status='succeeded'`, dated by the order's `paid_at` (the real moment payment was confirmed, not when checkout started — see below) |
| Cash out | Supplier payments + expenses actually paid + refunds actually paid back | `getCashOut()` = supplier payments (`purchase_payments`, by `paid_at`) + expenses paid (`expenses` where `status='PAID'`, by `paid_at`) + refunds (`refunds`, by `created_at`) |
| Net cash flow | Cash in − cash out | `getNetCashFlow()` |
| Outstanding supplier payments | Σ (PO total − amount paid), open POs | `getOutstandingSupplierPayments()` — a snapshot, not date-bound |
| Overdue supplier payments | Same, filtered to `due_date < now()` | `getOverdueSupplierPayments()` |

## Why `payments.created_at` is never used for "when was this cash received"

A `payments` row is inserted at **order-placement** time (`placeOrder()`), which for a web checkout precedes
actual payment confirmation by however long the customer takes at Stripe Checkout. The row's `status` later
flips to `succeeded` (`markOrderPaid()`, the webhook) without touching `created_at`. Every cash-in query in
this phase therefore joins `payments` → `orders` and buckets by **`orders.paid_at`** — the same "recognized
order" convention every Phase 1 analytics query already uses (`RECOGNIZED = orders.paid_at is not null`).

## Accrual vs. cash — the one genuinely new modeling decision

The brief is explicit (§4, §12): "Do not treat missing financial data as zero if that would create a
misleading report" and "Expense ≠ Cash Paid unless the actual payment has occurred." This build models that
with **two different dates on the same `expenses` row**:

- `expense_date` — when the cost was incurred. Drives the **accrual** figure, `getOperatingExpenses()`,
  which counts a expense as soon as it's **posted** (APPROVED or PAID — brief's own wording), matching how a
  business normally reads its own P&L: an approved invoice is a real cost even before the bank transfer
  clears.
- `paid_at` — when the money actually left. Drives the **cash** figure, `getExpensesCashOutCents()`, counted
  only once `status = 'PAID'`.

The same distinction exists implicitly on the revenue side: `getNetRevenue()` (accrual, dated by the order's
`paid_at`, i.e. when the sale was recognized) vs. `getCashIn()` (cash, the actual payment). A DRAFT or
PENDING_APPROVAL expense counts toward neither figure. A REJECTED or CANCELLED expense never counts toward
either, even if it had briefly been APPROVED — see docs/EXPENSES.md.

## N/A, never a misleading percentage

`marginOrNull(numerator, denominator)` in `lib/finance/summary.ts` returns `null` whenever the denominator is
zero. Every finance page and report renders `null` as the literal text `N/A`, never `0%` and never a crash.
This is a deliberate refinement layered on top of `getMetrics()`'s dollar figures: `getMetrics()` itself
still returns `0` for its own (Phase 1) `grossMarginPct` field when revenue is zero, and that field is left
unchanged everywhere it's already used (the main dashboard, the pre-existing "profit" report) — Phase 9
recomputes the null-safe version independently rather than editing a field other, already-tested pages read.

## Date comparison (brief §22)

`lib/admin/range.ts#pctChange(current, previous)` (pre-existing, Phase 2) already returns `null` when the
previous period is zero, and every finance page reuses it — no second "percent change" helper was written.
The same function handles negative values and zero-to-nonzero transitions correctly (division by the
**absolute value** of the previous figure), which is why refunds/expenses/costs — lines that are naturally
negative in a P&L view — still show a sensible percentage change rather than a sign-flipped one.

## Zero-revenue safety (brief §32)

With no recognized orders in a period: `getNetRevenue()` returns `0` (a real, correct answer — there was no
revenue), `getGrossMargin()`/`getOperatingMargin()` return `null` (not computable, not zero), and no function
in this phase ever divides by a value that could be zero without checking first. Covered by
`tests/finance.test.ts`'s "zero revenue" test.

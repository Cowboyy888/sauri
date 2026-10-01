# Phase 9 audit — finance, expenses, cash flow & business reporting

Read before writing any Phase 9 code. Lists what already exists (reused, not rebuilt), what's genuinely
missing, and the integration approach for each new piece.

## 1. Existing financial architecture

| Concern | Where | Verdict |
|---|---|---|
| Order revenue/discount/refund/COGS/profit | `orders` columns (`subtotal_cents`, `discount_total_cents`, `refund_total_cents`, `cost_total_cents`, `gross_profit_cents`, `gross_margin`), written once per order by `lib/orders/service.ts` and `lib/orders/refunds.ts` | **Reuse.** Every dollar figure in Phase 9 revenue/COGS/profit reporting reads these columns — none are recomputed independently. |
| Headline KPIs (gross sales, discounts, refunds, net revenue, COGS, gross profit, gross margin, AOV, payment fees, carrier costs, contribution profit, tax collected, shipping charged) | `lib/analytics/service.ts` → `getMetrics(range)` | **Reuse.** This is already the "one authoritative query" the brief asks for at the sales layer. Phase 9's finance summary service wraps it rather than re-querying `orders`. |
| Customer payments | `payments` table (provider, provider_ref, status, amount_cents, fee_cents) written by `placeOrder`/`markOrderPaid`/`recordPaymentFailure` | **Reuse.** No new "customer payment" record type — Phase 9 reads this table directly. `provider` already doubles as "payment method" (`stripe`\|`cash`\|`card_terminal`\|`bank_transfer`\|`manual`), so no separate column is added for that. |
| Refunds | `refunds` table (amount, reason, restocked, return_request_id, user_id) + `orders.refund_total_cents`, written by `updateOrderStatus` (full refund via cancellation) and `lib/orders/refunds.ts#refundOrder` (partial refunds) | **Reuse.** `getMetrics().refundCents` already sums `orders.refund_total_cents`, so it already captures both refund paths with no new code. Phase 9 adds refund *reporting* (by product/category/reason/month) on top of the existing rows — never a second refund record. |
| Supplier / purchase-order payments | `purchase_orders` (`total_cents`, `amount_paid_cents`, `payment_status`, `due_date`) + `purchase_payments` (amount, paid_at, note), written by `lib/purchasing/orders.ts#recordPurchasePayment` (Phase 8) | **Reuse, extend additively.** Phase 9 adds `payment_method`, `reference_number`, `attachment_url` columns to `purchase_payments` (brief §9's richer field list) but keeps `recordPurchasePayment()` as the only write path — **no second purchasing/payment system.** `isOverdue()` (Phase 8) is reused as-is; a PO's own `status = 'CANCELLED'` is read directly rather than duplicated into a payment-status enum value. |
| COGS / inventory costing | `inventory.cost_price_cents`, weighted-average via `lib/inventory/service.ts#weightedAverageCost`, applied identically by `restock()` and `lib/purchasing/receiving.ts#receivePurchaseOrder` (Phase 8) | **Reuse, unchanged.** Phase 9 never recomputes cost — `orders.cost_total_cents` (a snapshot taken at sale time) is COGS; inventory valuation reads `variant_stock.inventory_value_cents`, the same view every prior phase uses. |
| Reports (CSV/Excel/PDF) | `lib/admin/reports.ts` (`buildReport`, `toCsv`, `toXlsx`, `toPdf`) + `/admin/reports` + `/api/admin/reports/[key]` | **Reuse, extend.** Phase 9 adds new `ReportKey`s to the same switch statement and the same three exporters — no second export library, no second "Reports" page engine. `/admin/finance/reports` is a finance-scoped *view* into the same `REPORT_META`/`buildReport`, not a parallel implementation. |
| Settings (key/value config) | `settings` table, one row per key (`store`, `content`, `returns`, `crm`, `loyalty`, `marketing`, `stocktake`), read/written via `getStoreSettings`-style helpers | **Reuse.** Tax configuration (brief §17) is a new `settings.key = 'tax'` row, not a new table — the exact pattern every prior phase already used for its own config. |
| Audit log | `audit_logs` (generic entity/action/old/new), `lib/audit.ts#audit()` | **Reuse, unchanged.** Every new Phase 9 write path calls the same `audit()` helper with a new `entity` value (`expense`, `reconciliation_record`, `financial_report_snapshot`, …) — no second audit table. |
| RBAC | `lib/auth/permissions.ts` — `Area`/`Permission`, `PERMISSIONS` matrix, `assertCan`/`can` | **Reuse, extend.** One new area, `finance` (see §7 below), following the exact same `RW`/`RO` composition every prior phase used. |
| Company letterhead (for PDFs) | `lib/admin/store-settings.ts` (Phase 8) | **Reuse.** Finance PDF exports use the same `getStoreSettings()` — no second "who are we" config. |
| Stripe integration | `lib/payments/stripe.ts#getStripe()` | **Reuse.** Reconciliation calls the same singleton Stripe client already used by checkout — no second Stripe SDK instance or key. |

## 2. What's genuinely missing (new in Phase 9)

- **Expenses.** Nothing today models an operating expense (rent, salaries, software, …) or its approval workflow. New: `expense_categories`, `expenses` tables + `lib/finance/expenses.ts`.
- **A centralized financial summary service.** `getMetrics()` covers the sales side; nothing today computes operating expenses, operating profit, cash in/out, net cash flow, or outstanding/overdue supplier payments as named, reusable functions. New: `lib/finance/summary.ts` — the "one authoritative financial calculation service" the brief requires. Every finance page calls through it; none recomputes a formula inline.
- **Cash vs. accrual distinction.** No existing system distinguishes "an expense was approved" from "an expense was actually paid," which the brief explicitly requires (§4, §12: revenue ≠ cash received, expense ≠ cash paid). New: `expenses.expense_date` (accrual — when the cost was incurred, used by the P&L) vs. `expenses.paid_at` (cash — when money actually left, used by cash flow).
- **Payment reconciliation.** Nothing compares an internal `payments` row against the payment provider's own record. New: `reconciliation_records` table + `lib/finance/reconciliation.ts`, using the real Stripe client for `provider = 'stripe'` rows (not a mocked or fabricated comparison).
- **Financial report snapshots.** Nothing persists a generated report so it stays reproducible after the underlying data changes. New: `financial_report_snapshots` table.
- **Tax configuration surfaced explicitly.** Today's tax rate (`STORE.taxRateBp`, 8%) is a hardcoded constant in `lib/config.ts`, read only by `lib/orders/tax.ts#calculateTax`. It is real and always present (never "missing"), but it is not staff-editable. New: `settings.key = 'tax'`, editable from the finance section. **Decision:** this new settings row is documentation/reporting context for the *already-applied* rate, not a rewire of checkout's tax pipeline — `calculateTax()` is a pure, DB-free function called from deep inside the order-pricing engine (`computeTotals`), and making it async/DB-backed would ripple through Phase 1–4's tested checkout path for no requirement in this brief. The tax *report* always reads real, already-collected `orders.tax_total_cents` — never a number invented from the configured rate.
- **Cash flow reporting.** No system buckets cash inflows/outflows by day/week/month or tracks a cumulative cash position. New: `lib/finance/cash-flow.ts`.

## 3. Existing payment flow (recap, for the summary service)

`placeOrder` inserts one `payments` row per order (`pending` while awaiting Stripe, `succeeded` immediately for in-store/manual paid orders). `markOrderPaid` (the Stripe webhook) flips it to `succeeded`. **The authoritative "when was this cash actually received" timestamp is `orders.paid_at`**, not `payments.created_at` — the payments row is inserted at order-*placement* time, which for a web checkout can precede actual payment confirmation by minutes. Every Phase 9 cash-in query joins `payments` → `orders` and buckets by `orders.paid_at`, matching the exact convention every existing analytics query already uses (`RECOGNIZED = orders.paid_at is not null`).

## 4. Existing refund flow (recap)

Two write paths, one ledger: `updateOrderStatus(..., "cancelled" | "refunded")` (full refund via cancellation, may restock) and `refundOrder()` (partial, money-only, never restocks). Both insert into `refunds` and update `orders.refund_total_cents`/`gross_profit_cents`/`gross_margin`. Phase 9 never writes to `refunds` — only reads it (and `orders.refund_total_cents`) for reporting.

## 5. Existing purchasing / COGS flow (recap)

Phase 8's PO lifecycle (`DRAFT → … → RECEIVED`) already tracks `amount_paid_cents`/`payment_status` via `recordPurchasePayment()`, and receiving already applies the weighted-average cost update. Phase 9's "Supplier Payments" page is a finance-flavored read model over these exact rows (`getPurchaseOrder`, `listPurchaseOrders`, `isOverdue`) plus the existing write path, extended with three additive columns (see §1).

## 6. Existing reporting functionality (recap)

`lib/admin/reports.ts` already ships a "profit" report (gross sales → discounts → refunds → net revenue → COGS → gross profit → margin → fees → carrier cost → contribution profit) that is structurally most of a management P&L. Phase 9's `management-pl` report key restructures this into the brief's exact section order with period-over-period comparison, without touching the existing `profit` key (still used elsewhere) or duplicating its query.

## 7. RBAC decision

New area: **`finance`**. Money-adjacent areas in this codebase (`discounts`, `reports`, `settings`, `staff`, `audit`) are consistently OWNER/ADMIN-only or OWNER-only — never broadened to SALES/INVENTORY/VIEWER. The brief's own permission language for expenses ("OWNER/ADMIN: create/edit/approve/… Other roles: follow existing RBAC") matches this exactly, since *existing* RBAC already gives SALES/INVENTORY/VIEWER no `reports:read` at all. `finance` is therefore OWNER + ADMIN read **and** write, nobody else — the same shape as `reports`, not the broader `purchasing`/`marketing` pattern from Phases 7–8.

## 8. Potential conflicts checked

- **Two "profit" numbers on screen at once?** No — `management-pl` and the pre-existing `profit` report key both read `getMetrics()`; they will always agree because they share one query.
- **Double-counting refunds as both a revenue reduction and a cash outflow?** Intentional, per brief §12 — net revenue already subtracts refunds (accrual view); cash flow separately lists refunds as an outflow (cash view). Documented in `docs/CASH_FLOW.md` so the two are never mistaken for the same thing.
- **Operating expenses appearing in the P&L before they're paid?** Intentional — brief §4 defines operating expenses as "SUM approved/posted," not "SUM paid." `expense_date` (accrual) drives the P&L; `paid_at` (cash) drives cash flow. See `docs/FINANCIAL_CALCULATIONS.md`.
- **A new supplier-payments *table* duplicating Phase 8?** Rejected — extended `purchase_payments` instead (§1).
- **A new customer-payments *table* duplicating Phase 4?** Rejected — reads the existing `payments` table (§1).

## 9. Recommended integration approach

1. Extend the schema additively (4 new tables + 3 new columns on `purchase_payments`), never touching an existing column's meaning.
2. One new business-logic directory, `lib/finance/`, mirroring the per-phase convention (`lib/marketing/`, `lib/purchasing/`) — `expenses.ts`, `summary.ts`, `cash-flow.ts`, `reconciliation.ts`, `snapshots.ts`, `tax.ts`.
3. Extend `lib/admin/reports.ts`'s existing `REPORT_KEYS`/`buildReport`/exporters rather than building a second reporting engine.
4. One new permission area (`finance`), OWNER/ADMIN only.
5. New pages under `/admin/finance/*`, using the exact same `guard()`/`safe()`/`PageHeader`/`Card`/`DataTable`/`KPICard`/`StatusBadge` components every prior phase used — no new design language.

# Finance architecture (Phase 9)

This is an **operational management finance system**, not a certified accounting system. It reuses the
sales, payment, refund, purchasing and inventory engines built in Phases 1-8; it does not rebuild or
duplicate any of them. See docs/FINANCE_AUDIT.md for the full reuse-vs-new audit this phase started from.

## Layers

```
/admin/finance/*                  pages (server components, guard("finance:read"/"finance:write"))
        │
app/admin/actions.ts               server actions: validate (zod) → call a lib/finance/* function → revalidate
        │
lib/finance/
  summary.ts        the one authoritative financial calculation service (brief §14)
  expenses.ts        expense CRUD + approval workflow (DRAFT→...→PAID/REJECTED/CANCELLED)
  expense-categories.ts  configurable category vocabulary
  cash-flow.ts       bucketed cash-in/cash-out/net/cumulative series
  reconciliation.ts  compares a payments row against Stripe (live) or a manual entry
  tax.ts             tax settings (settings.key='tax') + real tax report from orders
  snapshots.ts        save/read a reproducible copy of a generated report
  customer-payments.ts, supplier-payments.ts, refunds.ts, product-profitability.ts, inventory-value.ts
        │                                    (finance-flavored read models over existing tables)
        ▼
Existing Phase 1-8 tables: orders, order_items, payments, refunds, purchase_orders, purchase_payments,
inventory, inventory_movements, suppliers — plus four new Phase 9 tables (expense_categories, expenses,
reconciliation_records, financial_report_snapshots) and three additive columns on purchase_payments.
```

## The central rule

**Every dollar figure on every finance page comes from `lib/finance/summary.ts` (or a function it calls),
never from a page component recomputing a formula.** This is the brief's own requirement (§14: "All
dashboards and reports should use these centralized functions") and it's what makes the Financial Overview,
the Management P&L, and every report export agree with each other by construction rather than by coincidence.

## Why no new "financial transactions" ledger

The brief (§26-27) offers a unified `financial_transactions` table as one option. This build does not have
one. Cash flow, the P&L, and every report are built by reading the four tables that already record each
kind of money movement (`payments`, `purchase_payments`, `expenses`, `refunds`) directly — via `UNION ALL`
in `lib/finance/cash-flow.ts`, or via separate summed queries in `lib/finance/summary.ts`. The brief itself
warns against this exact trap: "Never duplicate the source transaction as an independent fake record."
A `financial_transactions` table populated by copying rows from `orders`/`payments`/`purchase_payments`/
`expenses` would be exactly that — a second, driftable copy of numbers the real tables already hold.

## Why no new "supplier payments" or "customer payments" table

Both are read models (`lib/finance/supplier-payments.ts`, `lib/finance/customer-payments.ts`) over the
existing `purchase_payments`/`purchase_orders` (Phase 8) and `payments` (Phase 4) tables. The one write path
for a supplier payment remains `recordPurchasePayment()` (Phase 8, unchanged) — Phase 9 extends its
underlying table with three additive columns (`payment_method`, `reference_number`, `attachment_url`)
rather than building a second write path.

## Reused UI conventions

Every finance page uses the same `guard()` / `safe()` / `PageHeader` / `Card` / `DataTable` / `KPICard` /
`StatusBadge` / `DateRangePicker` components every prior phase used — there is no new design language.
`FinanceNav` (`components/admin/finance-nav.tsx`) is the finance-section tab bar, structurally identical to
the pre-existing `AnalyticsNav`.

## Currency

Every finance figure is integer cents in `USD`, the store's only configured currency (`STORE.currency`,
`lib/config.ts`). Formatting reuses the existing, shared `money()`/`moneyKpi()` helpers (`lib/format.ts`),
which format as USD like every other admin page — no second money-formatting helper was added for finance.
Those helpers are hardcoded to USD (a pre-existing Phase 1 choice, not something Phase 9 changes); expenses,
purchase orders and refunds do carry their own `currency` column, kept for display and preserved across
this phase's tables, but nothing converts between currencies. Multi-currency reporting is out of scope —
documented here, not silently assumed — see docs/FINANCIAL_CALCULATIONS.md.

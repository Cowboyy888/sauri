# Financial reports (Phase 9, brief §18-24)

## One export engine, not two

`/admin/finance/reports` extends the exact same report engine Phase 1/2 built (`lib/admin/reports.ts`:
`REPORT_KEYS`, `REPORT_META`, `buildReport()`, `toCsv()`/`toXlsx()`/`toPdf()`) and the same API route
(`/api/admin/reports/[key]`) — it does not build a second reporting pipeline. Ten new `ReportKey`s were
added: `management-pl`, `expenses`, `cash-flow`, `customer-payments`, `supplier-payments`, `refunds`,
`tax-summary`, `purchases`, `product-profitability`, `sales-channel`. Every report therefore already
supports CSV, Excel and PDF export, date filtering (where date-bound), and the same on-screen preview table
as every pre-existing report — for free, by construction.

## The brief's 14 named reports

| # | Report | Report key used |
|---|---|---|
| 1 | Management P&L | `management-pl` (also its own page, `/admin/finance/reports/profit-loss`, with period comparison) |
| 2 | Revenue Report | `daily-sales` (existing Phase 1 report — reused, not duplicated) |
| 3 | COGS Report | `profit` (existing Phase 1 report already has a COGS line) |
| 4 | Gross Profit Report | `profit` (same report — gross profit is the very next line) |
| 5 | Expense Report | `expenses` |
| 6 | Cash Flow Report | `cash-flow` |
| 7 | Customer Payment Report | `customer-payments` |
| 8 | Supplier Payment Report | `supplier-payments` |
| 9 | Refund Report | `refunds` |
| 10 | Tax Summary | `tax-summary` (also its own page, `/admin/finance/reports/tax`) |
| 11 | Inventory Valuation Report | `inventory` (existing Phase 8 report already has stock/cost/price/value per variant) |
| 12 | Purchase Report | `purchases` |
| 13 | Product Profitability Report | `product-profitability` (also its own page, `/admin/finance/reports/product-profitability`, sortable) |
| 14 | Sales Channel Report | `sales-channel` |

Reports 3, 4 and 11 deliberately point at an **existing** report rather than a near-duplicate one — they
already contain exactly the requested figures, and generating a second, subtly-different query for the same
numbers is the duplication the brief explicitly warns against (§37: "do not create duplicate... reporting
engines").

## Dedicated pages

Three reports get their own route beyond the shared preview/export list, because they need something the
generic flat-table preview doesn't provide:

- **Management P&L** (`/profit-loss`) — full brief §13 structure (Revenue → COGS → Gross Profit → Operating
  Expenses, by category → Operating Profit) with **current vs. previous period, amount, % of revenue, change
  and change %** — the period-comparison columns the brief explicitly asks for. The plain `management-pl`
  export stays a single-period flat table (consistent with every other exportable report in this engine, none
  of which currently export a period comparison), so the richer comparison view is a page, not a duplicate
  export format.
- **Tax Summary** (`/tax`) — adds the "Tax configuration required" empty state and the editable rate/label
  form; the export stays a flat 3-line table.
- **Product Profitability** (`/product-profitability`) — sortable by revenue/profit/margin/units, per brief
  §19, with a genuinely different (and more informative) refund-allocation methodology than the pre-existing
  per-product analytics — see the file header of `lib/finance/product-profitability.ts`.

## Financial report snapshots (brief §24)

`financial_report_snapshots` stores the **already-computed** `Report` (its columns, rows and totals) at save
time, not a pointer to re-run later. Reading a snapshot (`/admin/finance/reports/snapshots/[id]`) therefore
shows exactly what was true when it was saved, even if orders, refunds or expenses have since changed —
"historical management reports remain reproducible" (brief §24), verified by never calling `buildReport()`
again for a saved snapshot.

## Search, sort, pagination (brief §18)

The shared preview table (used by every flat report) shows the first 100 rows on screen with a note that
exports include everything — the same bar the pre-existing Phase 1/2 Reports page already set. Product
Profitability additionally supports column sorting via the standard `DataTable` sort-link convention (units,
net revenue, gross profit, margin). A dedicated search box was not added beyond this, matching the existing
Reports page's own scope — date-range filtering is the primary axis every report already supports.

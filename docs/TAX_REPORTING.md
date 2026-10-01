# Tax reporting foundation (Phase 9, brief §17)

## What already existed

Checkout has charged sales tax since Phase 1: `STORE.taxRateBp` (`lib/config.ts`, 8.00%) via
`calculateTax()` (`lib/orders/tax.ts`), applied inside `computeTotals()` and stored per order as
`orders.tax_total_cents` — a real, exact figure, never estimated after the fact.

## What Phase 9 adds

1. **A real report** (`lib/finance/tax.ts#getTaxReport`, `/admin/finance/reports/tax`): taxable sales, tax
   collected, tax-exempt sales, and order count for a period — read directly from `orders.subtotal_cents −
   discount_total_cents` and `orders.tax_total_cents`, never recomputed from the *current* rate. A historical
   order placed under a different configured rate would still report its own real, stored number — a rate
   change here never rewrites history.
2. **Explicit, configurable settings** (`settings.key = 'tax'`, the same key/value mechanism every other
   phase's settings use — see docs/FINANCE_AUDIT.md §1): a label, an enabled flag, and a rate — editable
   from the tax report page by anyone with `finance:write`. Before Phase 9, the rate lived only as a code
   constant with no staff-facing control at all.

## What Phase 9 deliberately does not do

**It does not rewire `calculateTax()`/checkout to read from this new settings row.** `calculateTax()` is a
pure, synchronous, database-free function, called from deep inside `computeTotals()` — itself called from
`quoteCart()`, `placeOrder()`, and every price-quoting path across Phases 1-4's checkout. Making it
database-backed would mean making the entire pricing pipeline async, a genuine rebuild of tested,
foundational checkout code with no requirement in this brief ("do NOT rebuild previous systems"). The
`settings.tax` row is therefore **reporting context for the rate already applied**, seeded to match
`STORE.taxRateBp` exactly, editable so the finance section can display an accurate label/rate without a code
deploy — not a live input to checkout math.

## "Tax configuration required" (brief §17)

`getTaxSettings()` returns `null`, never a fallback default, if the `settings.tax` row is ever missing (it
is seeded by `upsertReferenceData()` and therefore never missing in practice, but the code path is real: the
tax report page and the `tax-summary` export both check `report.configured` and render the literal text
"Tax configuration required" instead of a number when it's false). No function in this phase invents a tax
rate or a tax amount when configuration is absent.

## No tax-exempt sales, and that's honestly reported as $0

Nothing in this schema currently models a tax-exempt customer, product, or order — every recognized order is
taxed at the one configured rate regardless of channel (even Wholesale). "Tax-exempt sales" therefore always
reports `$0`, not a fabricated estimate. The column exists so the report's shape matches the brief and so
that adding real exemption rules later is a report-only change, not a new report.

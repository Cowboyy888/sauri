# Product management (Phase 8)

`/admin/products`, `/admin/products/[id]`, `lib/catalog/service.ts`. Most of what the brief asks for here
(brief §2-5) was already built in Phase 2 — see docs/PHASE_8_AUDIT.md for the full inventory of what
existed. This document covers what Phase 8 actually added.

## Already there (Phase 2, unchanged)

Product list with product/SKU/category/collection/variants/price/cost/stock/available/reserved/reorder
level/status; Add/Edit/Duplicate/Archive; independent per-variant stock/cost/price/SKU/barcode/reorder
level (via the 1:1 `inventory` table); image upload-by-URL with reorder (drag position) and an implicit
"primary" (position 0); a per-product **Analytics tab** already covering most of brief §39's margin analysis
(units sold, revenue, COGS, gross profit, margin).

## New fields (brief §3-4)

| Field | Table | Notes |
|---|---|---|
| Brand | `products.brand` | Free text, optional |
| Care Instructions | `products.care_instructions` | Free text, optional |
| Canonical URL | `products.canonical_url` | For a duplicate/variant listing to point SEO credit elsewhere; empty = this product's own page |
| Style | `product_variants.style` | Alongside the existing Size/Color/Material/Gemstone |

Material stays a variant-level attribute only (it already was, correctly — a ring in yellow gold and white
gold are different variants of the same product, not two different products) — no redundant product-level
material field was added.

## Bulk actions (brief §6)

`/admin/products` gained a collapsible "Bulk actions" panel: select any number of products from the current
page, then Archive, Activate, set Category, set Collection, or set Reorder Level for all of them at once
(`lib/catalog/service.ts`'s `bulkSetProductStatus`/`bulkSetCategory`/`bulkSetCollection`/`bulkSetReorderLevel`,
each one transaction, each audited). **Bulk price changes are deliberately not offered at all** — the
brief's own instruction ("do not allow dangerous bulk price changes without confirmation") is satisfied most
safely by not building the feature this phase, rather than adding a confirmation dialog around something
that could still mass-mutate every price in the catalog from one click.

## CSV import (brief §7)

`lib/catalog/import.ts`. Upload → validate → preview → show errors → confirm → apply, exactly the flow the
brief asks for, with a hand-written RFC-4180-ish CSV parser (no new dependency):

1. **Validate**: every row is checked with the *same rules* `createProduct`/`addVariant` already enforce
   (SKU format, positive price, non-negative cost/stock/reorder level) — never a second, looser validation
   path. Every error across every row is collected and returned together, not one-at-a-time.
2. **Preview**: the parsed rows and a per-row error list are shown before anything touches the database.
3. **Apply**: only runs if there are **zero** errors, and the entire import is **one database transaction**
   — brief §7's "never partially modify data without clear transaction behavior" is satisfied literally: it
   is either all applied, or none of it is.

Columns: `Product Name, SKU, Category, Collection, Variant, Cost, Price, Stock, Reorder Level` (the brief's
own list), plus optional `Material, Color, Size, Gemstone, Barcode` — the brief's column list has no material
column, but every variant needs one (a controlled `yg`/`wg`/`vm`/`ss` enum); a row without one defaults to
`yg` (this catalog's most common material) rather than failing, and the optional column lets an import be
precise when it matters. A SKU that already exists updates that variant's cost/price/reorder level (and
stock, via a real `ADJUSTMENT` movement — never a raw overwrite); a new SKU creates a variant, and a new
product name (within its category) creates the product too.

## Product export (brief §8)

No new export mechanism — the existing "Inventory" report (`lib/admin/reports.ts`, already covering
SKU/variant/cost/price/stock/reserved/available/reorder level) gained `Category`, `Collection` and the
product's own `Product Status` (draft/active/archived — distinct from the report's pre-existing stock-status
column) as three additional columns. CSV/Excel/PDF export all come from the same `buildReport()` call the
screen preview uses, so an export can never disagree with what's on screen (docs/ANALYTICS.md's own
"consistency guarantees" principle).

## Cost history and price history (brief §37-38)

Two new tabs on the existing product detail page (`cost-history`, `price-history`) rather than the brief's
literal separate routes — see docs/PHASE_8_AUDIT.md for why. Cost history reads the *existing*
`inventory_movements` ledger (every `RESTOCK`/`PURCHASE`-type row already has date, supplier, unit cost and
quantity) — not a new, second cost log that could disagree with it. Price history is genuinely new
(`product_price_history`, written automatically from inside `updateVariant()` whenever price or compare-at
price actually changes) — nothing previously recorded a price *change*, only the current price.

## Suppliers tab (brief §12, §40)

A third new tab lists every supplier offering any variant of this product (price, MOQ, lead time, last
purchase, preferred flag) and lets an authorized user add another — see docs/SUPPLIERS.md.

## Archiving preserves history (brief §44)

Unchanged from Phase 2: archiving a product only ever changes its `status`; a product that has ever been
sold or has any stock-movement history can never be hard-deleted (`deleteProduct()`'s existing guard) and
remains fully visible in historical orders, purchase records, inventory movements and every analytics report
— Phase 8 adds purchase-order line items to that same "never orphaned" category (a `purchase_order_items`
row keeps its `product_id`/`variant_id` foreign keys regardless of the product's current status).

## Barcode (brief §45)

`product_variants.barcode` already existed (Phase 1) and is unchanged — every variant can already carry one.
No hardware scanning integration was added (explicitly out of scope this phase); the foundation (a plain
text field, searched by the existing admin search) is already sufficient for a future scanner that just
types the barcode into a search box.

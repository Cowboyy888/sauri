# Phase 8 audit

What already exists, what Phase 8 reuses unchanged, and every scope decision made building purchasing and
supplier management on top of it. See docs/PRODUCT_MANAGEMENT.md, docs/SUPPLIERS.md, docs/PURCHASING.md,
docs/INVENTORY_COSTING.md, docs/REORDERING.md, docs/STOCKTAKE.md and docs/PURCHASE_WORKFLOW.md for the
systems themselves.

## Already existed — reused, not rebuilt

- **Product CRUD** (Phase 2, `lib/catalog/service.ts`): `createProduct`, `updateProduct`, `addVariant`,
  `updateVariant`, `duplicateProduct`, `setProductArchived`, `deleteProduct` (soft-delete-by-archiving unless
  never stocked/sold — already exactly brief §44's "archive, never delete history"), `addProductImage`,
  `removeProductImage`. The admin product list (`/admin/products`) and detail page
  (`/admin/products/[id]`, tabs: general/variants/images/inventory/seo/**analytics**/reviews) already cover
  brief §2-4 almost entirely — image reordering/set-primary via `position`, per-variant independent stock/
  cost/price/SKU/barcode/reorder level (via the 1:1 `inventory` table), and a **per-product analytics tab**
  (units sold, revenue, COGS, gross profit, margin, sales trend, recent orders, recent stock movements) that
  already satisfies most of brief §39's margin analysis. Phase 8 **extends** this — new product fields,
  bulk actions, CSV import/export, two new tabs — rather than rebuilding any of it.
- **Inventory movements and the weighted-average cost method** (Phase 1, `lib/inventory/service.ts`):
  `applyMovement()` (the only function that ever writes `stock_quantity`, always paired with a movement
  row), `lockInventory()` (row-locked, sorted, deadlock-safe), `restock()` (already does supplier-tagged
  stock increases with a **weighted-average cost update** — `(old cost × stock + new cost × qty) ÷ (stock +
  qty)` — exactly the brief §27 "preferred initial approach," already implemented since Phase 1, not new
  this phase). `restock()`'s behavior and signature are **untouched** — it's used by three existing surfaces
  (`/admin/products`, `/admin/inventory`, the dashboard's low-stock widget) that must keep working exactly as
  they do. The new purchase-receiving flow (docs/PURCHASING.md) is a **separate** function that calls the
  same low-level `applyMovement()`/`lockInventory()` primitives directly and reuses the identical
  weighted-average formula (factored into one shared helper so the method can never drift between the two
  call sites) — never a second, divergent costing implementation.
- **The `variant_stock` view, `lib/admin/inventory.ts` and `lib/admin/products.ts`**: stock/value/status
  (`IN_STOCK`/`LOW_STOCK`/`OUT_OF_STOCK`), the existing low-stock/out-of-stock pages, the existing (and only)
  reorder-suggestion formula (`avgDailySales × 45 + reorderLevel − available`, rounded up to 5), and the
  "inventory"/"low-stock" CSV reports. `/admin/inventory/reorder` (brief §30-31) is a **read-only extension**
  of this exact formula — never a second one — adding supplier/lead-time/last-cost columns from the new
  supplier-product relationship.
- **`suppliers` table** (Phase 1): existed already, but with only `name` (unique), `email`, `phone` — no
  address, status, payment terms, lead time, or notes, and the **only** thing that ever wrote to it was
  `restock()`'s free-text "supplier name" field (an idempotent upsert-by-name). Phase 8 **extends** this
  table with the richer fields brief §11 asks for, rather than creating a second suppliers table — the
  restock dialog's existing free-text field and the new full Suppliers CRUD both write the same rows.
- **`inventory_locations`** (Phase 5): reused as-is for stocktake location selection (brief §46) — no new
  location table.
- **The `movement_reference` enum's `"purchase_order"` value** (Phase 1): already existed, previously used
  only as a free-text tag (e.g. `reference_id = "PO-4210"`, never an enforced format or a real linked row).
  Phase 8's real `purchase_orders.po_number` now fills that exact slot with a genuine, unique, sequence-backed
  number — the tag's *meaning* doesn't change, it just now points at something real.
- **Audit logging, RBAC enforcement layers, `pg_notify` events, notifications** — all reused via the existing
  `audit()`/`assertCan()`/`emit()`/`notify()` helpers; no new mechanism.
- **Reports architecture** (`lib/admin/reports.ts`): the "inventory" report already covers stock/reserved/
  available/reorder/cost/price/value per variant (brief §8's product export). Phase 8 adds `category`,
  `collection` and the product's own `status` (draft/active/archived, distinct from stock status) to it,
  and extends the underlying `variant_stock` view with a collection join — rather than building a second
  export mechanism.

## New in Phase 8

- **Suppliers** (extended table) + **`supplier_products`** (new: the many-to-many supplier↔variant
  relationship with per-relationship price/MOQ/lead time — brief §12).
- **`purchase_orders`** / **`purchase_order_items`** — the PO entity the `"purchase_order"` reference tag
  never actually had a row behind it for. PO numbers (`PO-2026-000001`) use the exact same pattern as order
  numbers (`orderNumberSeq` → a sequence-backed default expression), just with the year embedded, per brief
  §15's example.
- **`purchase_receipts`** / **`purchase_receipt_items`** — the goods-receiving event and its per-line
  accepted/damaged/rejected breakdown (brief §19-25). Receiving calls the same inventory primitives
  `restock()` already uses, under the hood, but only for the **accepted** quantity — damaged/rejected units
  never touch `stock_quantity` at all (see "Quality control" below).
- **`purchase_documents`** — PO attachments (brief §42), stored as URL text fields validated to be `https://`,
  the same convention Phase 5's return-photo fields and every product image already use (this project has
  never had a binary file-upload provider configured; adding one is out of scope here, consistent with that
  established precedent).
- **`purchase_order_sends`** — a log of PO-email attempts (brief §18): `sent_at`/`sent_by`/`recipient`/
  `status`. Sends go through the existing `lib/email/provider.ts` stub, exactly like every other email in
  this codebase — never auto-sent, always an explicit staff action.
- **`purchase_payments`** — a minimal payment log against a PO (brief §41): amount, date, note. Deliberately
  **not** a general ledger/accounts-payable system — just enough to compute `UNPAID`/`PARTIALLY_PAID`/`PAID`,
  with `OVERDUE` derived at read time (due date passed and not fully paid), never stored as a flag that could
  drift out of sync with the date.
- **`product_price_history`** — genuinely new: nothing previously recorded a selling-price change (Phase 2
  simply overwrote `product_variants.selling_price_cents` in place). Written automatically from inside the
  existing `updateVariant()` whenever price or compare-at price actually changes — one write path, not two.
- **`stocktakes`** / **`stocktake_items`** — full cycle-count workflow (brief §46-48), with a configurable
  significant-discrepancy threshold before an adjustment can be applied.

## "Cost history" is not a new table

Brief §37 asks for a per-product cost-history view (date, supplier, unit cost, quantity, purchase order,
currency) "to identify supplier price changes." Every one of those fields **already exists** on
`inventory_movements` (`created_at`, `supplier_id`, `unit_cost_cents`, `quantity`, `reference_id` for
`purchase_order`-tagged rows) for `RESTOCK`/`PURCHASE`-type movements. `/admin/products/[id]` gains a **Cost
History tab** (see below) that is a read-only query over the existing ledger — not a new, second log that
could disagree with it.

## Cost/price history are tabs, not new routes

The brief names literal paths, `/admin/products/[id]/cost-history` and `/admin/products/[id]/price-history`.
The product detail page already has seven tabs on one route (`?tab=general|variants|images|inventory|seo|
analytics|reviews`) — adding two more routes would fragment a pattern that already works and is already
bookmarked/linked to from elsewhere (e.g. `?tab=analytics` links from `/admin/analytics/products`). Both are
implemented as two additional tabs (`cost-history`, `price-history`) on the existing page instead, for
consistency with the other seven.

## RBAC (brief §50)

A new `purchasing` permission area — suppliers, purchase orders, and their approval:

| Role | `purchasing:read` | `purchasing:write` |
|---|---|---|
| OWNER | ✓ | ✓ |
| ADMIN | ✓ | ✓ (brief: "Products, suppliers, purchasing") |
| INVENTORY | ✓ | – |
| SALES | ✓ | – |
| VIEWER | ✓ | – |

**Receiving and stocktake stay on the existing `inventory:write`** (already held by OWNER/ADMIN/INVENTORY) —
the brief's own role table lists them separately from "purchasing" for INVENTORY ("Receiving, stocktake,
inventory," not "purchasing"), and they're physical-stock operations, not commercial/supplier decisions.
This means INVENTORY can receive against an already-approved PO and run stocktakes, but cannot create a
supplier or approve a PO — exactly the separation the brief draws. SALES and VIEWER's "read product and
stock information" (brief §50) is satisfied by the pre-existing `products:read`/`inventory:read` grants they
already have (VIEWER) or by the new `purchasing:read` (SALES, which still has no direct `products:read`/
`inventory:read` — unchanged from Phase 2's deliberate scoping of that role to orders/customers/sales); this
phase does not reopen that Phase 2 boundary.

Cost changes, PO approval, and inventory adjustments remain gated exactly as sensitively as before
(`purchasing:write` or `inventory:write`, both OWNER/ADMIN(-only for purchasing) territory) — brief §50's
"only authorized users can approve PO / change cost / adjust inventory / modify purchase data" was already
true before this phase for cost/inventory, and is now true for PO approval too.

## Final acceptance checklist mapping

Every checkbox in the brief's §61 has a corresponding page, function or test named in
docs/PRODUCT_MANAGEMENT.md, docs/SUPPLIERS.md, docs/PURCHASING.md, docs/INVENTORY_COSTING.md,
docs/REORDERING.md, docs/STOCKTAKE.md and docs/PURCHASE_WORKFLOW.md — see the Phase 8 STOP CONDITION report
for the full file-by-file mapping.

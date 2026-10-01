# Suppliers (Phase 8)

`lib/purchasing/suppliers.ts`, `/admin/suppliers`, `/admin/suppliers/[id]`. Extends the Phase 1 `suppliers`
table (which only ever had `name`/`email`/`phone`, populated lazily by the restock dialog's free-text field)
rather than creating a second supplier system — see docs/PHASE_8_AUDIT.md.

## Fields (brief §11)

Name (unique), Company, Contact Person, Email, Phone, Address (line 1/2, city, postal code, country),
Website, Payment Terms, Currency (default USD), Lead Time (days), Minimum Order (a money amount — the
overall minimum spend for a PO with this supplier, distinct from a per-product minimum order *quantity*,
below), Notes, Status (`ACTIVE` / `INACTIVE` / `BLOCKED`, default `ACTIVE`). Only `name` is required — every
other field is optional, per the brief's "do not require fields that are not needed."

## Supplier-product relationships (brief §12)

`supplier_products` — a many-to-many table between `suppliers` and `product_variants`:

| Field | Meaning |
|---|---|
| `supplier_sku` | The supplier's own SKU for this item (may differ from ours) |
| `purchase_price_cents` / `currency` | What this supplier charges, in their currency |
| `minimum_order_quantity` | Their MOQ for this specific item (distinct from the supplier-level minimum order value above) |
| `lead_time_days` | Item-specific lead time (falls back to the supplier's general lead time if not set) |
| `preferred_supplier` | A flag, never an automatic choice (brief §40: "let authorized users choose") |
| `last_purchase_price_cents` / `last_purchase_date` | Updated automatically when a PO against this pairing is received — never edited by hand |

A variant can have several suppliers; a supplier can supply several variants. Marking one relationship
`preferred_supplier = true` automatically un-marks any other for the *same variant* (there is only ever one
preferred supplier per product), enforced in `upsertSupplierProduct()` — never two preferred suppliers
silently coexisting.

## Supplier profile (brief §10)

`/admin/suppliers/[id]` shows: contact/address/terms, every linked product with its price/MOQ/lead time/last
purchase, every purchase order against this supplier, and three computed figures — Total Spend, Average
Purchase Cost, Last Purchase — all read from real `purchase_orders`/`purchase_order_items` rows (never a
cached or estimated figure), scoped to non-cancelled orders.

## Supplier price comparison (brief §40)

For a variant with multiple suppliers, `listSuppliersForVariant()` returns every offer (price, MOQ, lead
time, last purchase, currency), sorted preferred-first then cheapest-first — a **read-only comparison**. No
code path ever auto-selects a supplier for a purchase order; a human always picks one when creating a PO.

## RBAC (brief §50)

`purchasing:write` (OWNER, ADMIN) to create/edit a supplier, change its status, or add/remove a
supplier-product relationship. `purchasing:read` (also INVENTORY, SALES, VIEWER) to view the supplier list
and profile — see docs/PHASE_8_AUDIT.md for the full RBAC table and why receiving (a different,
`inventory:write` permission) doesn't require the ability to manage suppliers.

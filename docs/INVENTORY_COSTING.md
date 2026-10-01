# Inventory costing (Phase 8)

The one costing method this store uses, and has used since Phase 1 — this document didn't exist before
Phase 8 because the brief's own instruction was to inspect existing financial architecture first, and only
document (never silently change) whatever method already exists (brief §27).

## Method: weighted average

```
new cost = (old cost × units on hand + new cost × units received) ÷ (units on hand + units received)
```

Example (brief §54): 100 units already on hand at $50, then 100 more units received at $60:

```
(50 × 100 + 60 × 100) / (100 + 100) = 11,000 / 200 = $55
```

`product_variants.cost_price_cents` always holds this running weighted-average figure — never a FIFO/LIFO
queue of individual cost lots. It is the **only** cost figure the rest of the system reads: COGS, gross
profit, margin and inventory value (docs/ANALYTICS.md) all read this one column, on the order/inventory
snapshot taken at the moment of sale or valuation. There is no second costing method anywhere in the
codebase.

## Implementation: one formula, two call sites

`weightedAverageCost(oldCostCents, oldQty, newCostCents, newQty)` (`lib/inventory/service.ts`) is a small,
pure, exported function — extracted in Phase 8 so the method can never drift between:

1. **`restock()`** (Phase 1, `lib/inventory/service.ts`) — the simple, single-line admin "Restock" dialog
   used from `/admin/products` and `/admin/inventory`. Unchanged behavior; it now calls the shared function
   instead of repeating the formula inline.
2. **`receivePurchaseOrder()`** (Phase 8, `lib/purchasing/receiving.ts`) — the new structured
   goods-receiving flow. Only the **accepted** quantity from a receipt updates the cost — damaged/rejected
   units were never real inventory and never touch the average (see docs/PURCHASING.md's "Quality control"
   section).

Both call sites also write the same `inventory_movements` row shape (`unit_cost_cents`, `supplier_id`,
`quantity`) and the same audit-log entry ("Changed cost price (weighted average)") — one code path, one
audit trail, whichever way stock arrived.

## What Phase 8 did *not* change

- **COGS is still computed independently of purchasing** (brief §28), exactly as before: `orders.cost_total_cents`
  is a snapshot of `product_variants.cost_price_cents` **at the moment a sale happens** (`lib/orders/pricing.ts`),
  never recalculated retroactively when a later purchase changes the running average. This is why the docs/ANALYTICS.md
  COGS/profit numbers for a March sale never move because of an April purchase.
- **Historical unit costs are preserved.** A `purchase_order_items.unit_cost_cents` value, and the snapshot
  copied onto its `purchase_receipt_items` row, are never overwritten when the supplier's price changes
  later or when the variant's running average moves — see docs/PURCHASING.md's "Cost history" section for
  how this is exposed to the admin.
- **Inventory value** (`variant_stock.inventory_value_cents = available stock × current cost`) already
  existed and is unchanged; it simply now reflects whatever the weighted average currently is, from whichever
  source updated it.

# The purchasing workflow (Phase 8)

The end-to-end pipeline the brief opens with:

```
PRODUCT → SUPPLIER → PURCHASE ORDER → APPROVAL → GOODS RECEIVED → QUALITY CHECK
  → INVENTORY UPDATED → COST UPDATED → INVENTORY VALUE UPDATED → PROFIT ANALYTICS UPDATED
```

Each stage is documented in depth elsewhere; this page is the map. See docs/PRODUCT_MANAGEMENT.md,
docs/SUPPLIERS.md, docs/PURCHASING.md, docs/INVENTORY_COSTING.md, docs/REORDERING.md and
docs/STOCKTAKE.md.

## The receiving workflow specifically (brief §20)

```
Purchase Order (status: APPROVED / ORDERED / PARTIALLY_RECEIVED)
   ↓
Receive Shipment       — /admin/purchases/receiving lists every PO eligible to receive against
   ↓
Count Items            — per line: Ordered, Previously Received, Remaining (brief §21)
   ↓
Quality Check          — per line: Accepted / Damaged / Rejected (brief §24)
   ↓
Confirm Receipt        — one server transaction, `lib/purchasing/receiving.ts`'s `receivePurchaseOrder()`
   ↓
Inventory Updated       — stock_quantity += accepted (only)
   ↓
Inventory Movement Created — one PURCHASE movement, referencing the PO number
   ↓
Purchase Order Updated  — received_quantity per line, and the PO's overall status recomputed
```

### One transaction, every time

`receivePurchaseOrder()` runs entirely inside one database transaction, row-locking every affected variant's
inventory (`lockInventory()`, the same primitive every other stock change in this codebase uses). If
anything fails partway — an invalid quantity, a line that doesn't belong to this PO — **nothing** is written:
no partial stock update, no orphaned receipt row. This is the same "all or nothing" guarantee `placeOrder()`
already gives orders (docs/BUSINESS_LOGIC.md).

### Validation (brief §21)

`received quantity ≤ remaining quantity` is checked twice: in application code (a clear, per-line error
naming exactly which SKU and how much is left) and by a database CHECK constraint on
`purchase_order_items.received_quantity` (`0 ≤ received_quantity ≤ quantity`) — the same defense-in-depth
pattern as everywhere else in this schema.

### Partial receiving (brief §23)

A PO for 100 units, received as 60 then later 40:

1. First receipt: `+60` to inventory, one `purchase_receipts` row, `purchase_order_items.received_quantity`
   becomes 60, PO status recomputed to `PARTIALLY_RECEIVED` (60 < 100 ordered).
2. Second receipt: `+40` more, `received_quantity` becomes 100, PO status recomputed to `RECEIVED` (100 ≥
   100 ordered).

The PO's status is **recomputed from the real per-item totals on every receipt**, never assumed or
incremented — so it's impossible for it to drift out of sync with what was actually received, and two
receipts against the same PO can never double-count (`received_quantity` is a running total updated exactly
once per receipt, inside the same transaction that inserts the receipt's own line rows).

## Quality control (brief §24-25)

Every receipt line records three numbers: **Accepted**, **Damaged**, **Rejected** — not just a single
"received" count. Example: received 100, accepted 96, damaged 3, rejected 1.

**Only the accepted quantity ever becomes sellable stock.** Damaged and rejected units are recorded — on the
`purchase_receipt_items` row, permanently — but **never** generate an inventory movement, because they were
never in sellable inventory to begin with (this receipt is the *first* time these units ever touched the
system; there is nothing to "subtract" from). This is deliberately different from the pre-existing `DAMAGED`
movement type, which is for stock that *was* sellable and later turned out to be damaged (e.g. found during a
stocktake, docs/STOCKTAKE.md) — that case genuinely does need a movement, because real stock is being
removed. A unit damaged in transit, caught at receiving, was never real stock — recording it on the receipt
line is the correct, complete record (brief §25's own "receiving record with damaged quantity" alternative),
and avoids a confusing movement that would claim stock decreased when it never increased in the first place.

No double counting: `accepted + damaged + rejected` is exactly what was physically received on this receipt,
and only `accepted` reaches `inventory.stock_quantity`.

## Cost and value (brief §26-29)

- **Cost updated**: the accepted quantity's unit cost updates the variant's weighted-average cost — see
  docs/INVENTORY_COSTING.md for the exact formula and why receiving and the older "Restock" dialog share one
  implementation.
- **Inventory value updated**: `variant_stock.inventory_value_cents` (available stock × current cost) is a
  live view, not a stored/cached figure — it reflects the new stock and new cost immediately, with no
  separate "recalculate" step.
- **Incoming ≠ current stock** (brief §29): a PO's un-received quantity is tracked separately
  (`/admin/inventory/incoming`, docs/REORDERING.md) and is never added to `inventory.stock_quantity` until it
  is actually received and accepted. The admin dashboard's inventory-value figures are always the
  **available/current** figure; incoming inventory value is reported as its own, separate number.

## Profit analytics (brief §28)

**Purchasing never computes COGS.** `lib/orders/pricing.ts` still snapshots `cost_price_cents` onto an
`order_item` only at the moment of sale — completely unchanged by this phase. A purchase changes the *going
forward* weighted-average cost; it does not, and cannot, retroactively change the COGS already recorded for
a March sale. See docs/ANALYTICS.md for the full profit/margin pipeline this phase feeds into without
touching.

# Reorder suggestions and incoming inventory (Phase 8)

`lib/admin/purchasing.ts`, `/admin/inventory/reorder`, `/admin/inventory/incoming`. See
docs/PHASE_8_AUDIT.md for why this is a **second, purpose-built formula** alongside the pre-existing
sales-velocity one, not a replacement for it.

## Two reorder estimates, for two different questions

| | Where | Formula | Question it answers |
|---|---|---|---|
| **Sales-velocity suggestion** (Phase 2, unchanged) | `/admin/inventory` (low/out-of-stock views), `lib/admin/inventory.ts` | `round up to 5 of (avg daily sales × 45 days + reorder level − available)` | "Given how fast this sells, how much should I buy to cover the next ~45 days?" |
| **Target-stock suggestion** (Phase 8, new) | `/admin/inventory/reorder`, `lib/admin/purchasing.ts` | `max(0, target stock level − available − incoming)` | "Given a stock target I've set, and everything already on order, how much more do I need to order right now?" |

The brief's own worked example (§55) is the second formula: Available = 8, Reorder Level = 10, Incoming = 0,
Target Stock = 50 → Suggested = 50 − 8 − 0 = **42**. Building this as a second formula rather than changing
the existing one avoids silently changing numbers the Phase 2 low-stock dashboard already relies on, while
still giving the brief's exact test case a real, correct implementation.

## Target stock level (brief §31)

`inventory.target_stock_level` — a new, optional, per-variant column (parallel to the pre-existing
`reorder_level`). Set from `/admin/inventory/reorder` (`setTargetStockLevel()`, `inventory:write`). When
unset, the formula falls back to `reorder_level × 5` — a reasonable default, clearly distinguishable in the
UI (the "Target" button shows "—" until a real value is set) from an intentionally configured target.

## Incoming stock (brief §29, §33)

A variant's incoming quantity is `Σ (quantity − received_quantity)` across every `purchase_order_items` row
whose PO is `APPROVED`, `ORDERED`, or `PARTIALLY_RECEIVED`. A `DRAFT` or `PENDING_APPROVAL` order isn't
counted — it isn't a real commitment yet (an unapproved order could be edited or never submitted at all);
`RECEIVED` and `CANCELLED` are excluded because there's nothing left pending. `/admin/inventory/incoming`
lists every such line with its supplier, product, remaining quantity and expected delivery date.

**Incoming stock is never counted as available/sellable stock** — it only ever appears as its own column
(`incomingQuantity`) subtracted in the reorder formula, and as its own KPI
(`getIncomingInventoryValueCents()`, valued at each PO line's own unit cost, never the variant's current
cost) on `/admin/analytics/purchases`. `inventory.stock_quantity` itself is untouched until goods are
actually received and accepted (docs/PURCHASE_WORKFLOW.md).

## Never automatic (brief §31)

Nothing here creates a purchase order. `/admin/inventory/reorder` is a **review-and-approve** screen: it
surfaces every variant at or below its reorder level, with the supplier, last cost, lead time and suggested
quantity an authorized user needs to decide — but placing the order is always a deliberate,
separate action (`/admin/purchases/new`).

## Low-stock dashboard (brief §32)

The existing `/admin/inventory` Critical/Low/Out-of-stock views (Phase 2) are unchanged and still the
primary "what's running low" surface, including their own (sales-velocity) suggested-reorder estimate. Phase
8 doesn't duplicate this dashboard — it adds the purchasing-aware view as a distinct page for a distinct
purpose (docs/PHASE_8_AUDIT.md).

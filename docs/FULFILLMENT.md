# Fulfillment (Phase 5)

The operational workflow between a paid order and a shipped one. See docs/ORDER_STATUS.md for how
`fulfillment_status` fits into the three-dimension status model, and docs/SHIPPING.md for what happens
after a package exists.

## Flow

```
PAID order
  ↓ advanceFulfillmentStage(..., "processing")   — lazily creates one fulfillment_items row per order line
  ↓ advanceFulfillmentStage(..., "picking")
  |   setPickStatus(orderItemId, "picked" | "missing" | "damaged", pickedQuantity)   — per line
  ↓ advanceFulfillmentStage(..., "packing")
  ↓ advanceFulfillmentStage(..., "ready_to_ship")
  ↓ createPackage({ items: [{orderItemId, quantity}], carrier?, trackingNumber?, ... })   — one or more
  ↓ setPackageStatus(packageId, "shipped" | "in_transit" | ... | "delivered")   — per package
ORDER FULFILLMENT ROLLUP — recomputeOrderFulfillmentStatus() after every package status change
```

Every write here is in `lib/fulfillment/service.ts` and requires `inventory:write`. Every transition is
recorded to `fulfillment_events` (order-level) or `shipping_events` (per-package), both same shape as the
Phase 1 `order_events`, merged into one combined timeline for the admin order page — see "Timeline" below.

## Picking (brief §5)

`fulfillment_items` is a table **separate from `order_items`**, on purpose: `order_items` is an immutable
financial/snapshot record (price, cost, discount at the moment of sale — brief §42); picking state
(pick_status, picked_quantity, location) is mutable operational state with its own lifecycle. Mixing the
two would mean either bolting mutable columns onto a financial snapshot, or duplicating price/cost data
into an operational table. One row is created per order line the first time an order enters `processing`,
`onConflictDoNothing()` so it's safe to call for orders placed before Phase 5 existed too.

Each line can be marked `pending` (default) → `picked` / `missing` / `damaged`, with an optional
`location_id` (see docs/INVENTORY_LOCATIONS.md) and a picked quantity that can differ from the ordered
quantity (partial picks, e.g. only 1 of 2 in stock at that location). The picking list UI is
`PickingList` in `components/admin/fulfillment-panel.tsx`.

## Packing & packages — multi-package support (brief §40)

One order can produce more than one `packages` row. A package is a unit that ships: it carries its own
carrier, tracking number/URL, label URL, weight/dimensions, and its own `shipment_status` timeline
(`shippingEvents`). `createPackage()`:

- only accepts orders whose `fulfillment_status` is `ready_to_ship` or `partially_shipped`,
- validates every line item belongs to the order,
- and — critically — never lets a package claim more of a line's quantity than remains unpackaged
  (`packedQuantities()` sums what earlier packages already took; the remainder is what's left).

This is what makes partial shipment safe: order for 3 rings, ship 2 now and 1 later in a second package,
and neither package can accidentally double-claim a unit.

## The rollup: how the *order's* fulfillment_status is derived from *packages*

`recomputeOrderFulfillmentStatus()` runs after every `setPackageStatus()` call:

1. Sum, per order line, how many units are in a package whose status is `shipped` or later.
2. If not every line is fully covered yet → `partially_shipped`.
3. If every line is covered → take the **least advanced** package's status (a `shipped` order with one
   package still `in_transit` and another already `delivered` stays `in_transit` — the order isn't done
   until all of it is), mapped through `RANK_TO_ORDER_STATUS`.
4. If the result didn't change, do nothing (this function is a pure re-derivation, safe to call
   redundantly — it does not increment anything).

Reaching `shipped` or `delivered` this way also syncs `orders.status` at those two milestones — see
docs/ORDER_STATUS.md for why that sync deliberately does **not** go through the Phase 1 `statusFields()`
helper.

## Customer notifications (brief §13-§14, §38)

`setPackageStatus()` compares the package's status *before* the call to what's being set
(`wasAlready = pkg.status === status`). Customer emails (`shippingConfirmationEmail` /
`deliveryConfirmationEmail`, `lib/email/provider.ts`) fire only on the actual transition into
`shipped`/`delivered` — calling this again with the same status is a no-op for notifications even though
the write itself is harmless. This is the same idempotency pattern Phase 4 used for webhook processing;
no separate dedup table needed.

## Timeline (brief §33)

The admin order page's "Timeline" card is not a single table — it's `order_events` (lifecycle),
`fulfillment_events` (stage advances), `shipping_events` (per-package, joined through `packages`), and
`return_events` (through `return_requests`), unioned and sorted by timestamp in
`getOrderFulfillmentDetail()` (`lib/admin/fulfillment.ts`). Keeping four separate tables rather than one
shared "events" table matches the proven Phase 1 `order_events` shape and keeps each dimension's writers
independent — a package status change never has to reach into an unrelated order-level table.

## Reused vs. new (why no new "fulfillment order" table)

Reused: `orders.fulfillment_status` (extended with new enum values, not replaced), `order_items` (read-only
here), `inventory_movements`/`applyMovement` (untouched — fulfillment itself never moves stock; stock was
already deducted at the sale), `audit_logs`, `notifications`, RBAC (`assertCan(actor, "inventory:write")`
on every write). New: `fulfillment_items`, `packages`, `package_items`, `fulfillment_events`,
`shipping_events` — five tables, each answering a question the existing schema had no place for.

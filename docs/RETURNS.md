# Returns (Phase 5)

Customer-initiated returns, staff review, physical receipt, inspection-gated restocking, and refund.
Everything lives in `lib/returns/service.ts`; see docs/EXCHANGES.md for the (architecture-only) exchange
path and docs/INVENTORY_LOCATIONS.md for where returned goods conceptually land.

## Flow

```
CUSTOMER: createReturnRequest(orderId, items[])           — requested
STAFF:    updateReturnStatus(..., "under_review")          — optional
STAFF:    updateReturnStatus(..., "approved" | "rejected")
CUSTOMER ships the item back; STAFF: setReturnShipping(trackingNumber, carrier)
STAFF:    updateReturnStatus(..., "return_shipped")
STAFF:    updateReturnStatus(..., "received")
STAFF:    updateReturnStatus(..., "inspecting")
STAFF:    recordInspection(returnItemId, { condition, disposition })   — per item
STAFF:    updateReturnStatus(..., "approved_for_refund")
STAFF:    refundReturn(returnRequestId)                     — refunded
STAFF:    closeReturn(returnRequestId)                      — closed
```

`RETURN_TRANSITIONS` is a strict allow-list graph (same pattern as Phase 1's order `TRANSITIONS`), enforced
in `updateReturnStatus()` — a return "under_review" cannot jump straight to "received", etc.

## Eligibility (brief §19, §26)

`createReturnRequest()` checks, in order: the return policy allows refunds at all
(`getReturnPolicy().refundEnabled`), the order belongs to this customer, the order's `fulfillment_status`
is `delivered` or `completed`, the return window hasn't closed (`policy.returnWindowDays` measured from
`paidAt`), every requested line actually belongs to the order, and — per line — the requested quantity does
not exceed what's left to return (already-requested quantities across *every* non-rejected return request
for that line are summed and subtracted, so a customer can't return the same 2 units twice across two
separate requests). `getReturnEligibleItems()` additionally flags a line as ineligible when the product
carries a final-sale tag or its category is outside `eligibleCategorySlugs` — both read from the same
configurable policy, never hardcoded (see "Policy configuration" below).

## Partial returns (brief §23)

A return request covers specific `(order_item_id, quantity)` pairs, not the whole order. Only those lines
and quantities are affected anywhere downstream: `requestedQuantities()` tracks remaining-returnable
quantity per line (not per order), inspection and disposition are recorded per `return_item`, and
`refundReturn()`'s amount is the proportional share of each *returned line's* total
(`line.lineTotalCents / line.quantity * returnedQuantity`), summed — never the whole order's total.

## Inspection-gated restocking — the critical rule (brief §24)

`recordInspection()` is the **only** place a return can affect inventory, and even then, only for one
disposition:

| Disposition | Inventory effect |
|---|---|
| `restock` | `applyMovement()` — a `RETURN` movement, `+quantity`, referencing the return request. **Only this row makes the unit sellable again.** |
| `repair`, `damaged`, `dispose`, `return_to_customer` | **No movement at all.** |

This is deliberate, not an oversight: the unit was already deducted from stock at the time of sale (a
`SALE` movement). Not writing a movement for a non-restock disposition **is** "don't increase sellable
inventory" — there is nothing to reverse, because nothing about physical sellable stock changed. A damaged,
defective, or unsellable item can never become sellable stock through this code path; the inventory ledger
enforces this too, structurally — its `movement_non_zero` check constraint would reject a zero-quantity
movement outright, so there was never a "restock zero units" row to write in the first place. Every
inspection is recorded at most once per item (`return_inspections.return_item_id` is unique) — re-inspecting
means the earlier bug would be a second Restock movement doubling stock, which is why
`recordInspection()` explicitly rejects a second call for the same item.

## Refund integration (brief §25, §42)

`refundReturn()` computes the amount, then calls the **existing** Phase 4 `refundOrder()`
(`lib/orders/refunds.ts`) with a `returnRequestId` tag — it does not duplicate refund logic. `refunds` was
extended with a nullable `return_request_id` column so a return-driven refund and an ad-hoc admin refund
share one code path and one audit trail, distinguishable by whether that column is set. See
docs/ORDER_STATUS.md for why a refund — return-driven or not — never overwrites the order's
`fulfillment_status`, a bug found and fixed during this phase's end-to-end verification.

## Return shipping cost (brief §27)

`return_requests.return_shipping_cost_cents` / `return_shipping_paid_by` record who pays and how much, but
the *default* payer comes from the configurable policy (`returnShippingPolicy`: `customer` / `company` /
`free`) — see "Policy configuration" below. No payment logic beyond recording this exists yet; charging or
refunding the return-shipping cost itself is out of scope for Phase 5.

## Policy configuration (brief §26)

`settings` row keyed `"returns"`, shape `DEFAULT_RETURN_POLICY` (`lib/db/reference-data.ts`):
`returnWindowDays`, `exchangeEnabled`, `refundEnabled`, `returnShippingPolicy`, `finalSaleTags`,
`eligibleCategorySlugs` (`null` = all categories eligible). Read via `getReturnPolicy()`, written via
`setReturnPolicy()` (owner-only, `settings:write`) at `/admin/settings/returns`. `/pages/returns` renders
this exact configuration — window length, refund/exchange availability, who pays return shipping,
final-sale/category exclusions — so the customer-facing policy page can never say something the actual
eligibility check doesn't enforce.

## Reused vs. new

Reused: `refundOrder()`, `applyMovement()`/`lockInventory()`, `audit()`/`notify()`, RBAC, the
`order_events`-shaped timeline pattern (as `return_events`), `settings` (for policy, same table Phase 1's
content settings already use). New: `return_requests`, `return_items`, `return_inspections`,
`return_events` — one table per concern (the request itself, its lines, their inspection outcome, its
timeline), mirroring how orders/order_items/order_events are already split.

## Security (brief §43)

Every return-request read/write checks `order.customerId === customerId` (never trust an ID in a URL);
`createReturnRequest` throws `ForbiddenError` otherwise. Staff actions (`updateReturnStatus`,
`recordInspection`, `refundReturn`) require `orders:write` or `inventory:write` via `assertCan()`, enforced
server-side inside the service functions themselves — never only in the UI.

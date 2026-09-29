# Order lifecycle

Unchanged three-dimension model from Phase 1 (`docs/DATABASE_SCHEMA.md`), now with a payment provider
actually driving the transitions instead of only staff/manual actions.

## The three fields

| | Values | Who changes it |
|---|---|---|
| `status` | `pending → paid → processing → shipped → delivered`, or `→ cancelled` / `→ refunded` | `statusFields()` sets all three together; see `TRANSITIONS` in `lib/orders/service.ts` for the allowed graph |
| `payment_status` | `unpaid → paid`, or `failed`, `refunded`, **`partially_refunded`** (new in Phase 4) | `markOrderPaid` (webhook), `refundOrder` (admin, partial or full) |
| `fulfillment_status` | Phase 5 extends this considerably — see docs/ORDER_STATUS.md, the current source of truth for this column | staff, via `lib/fulfillment/service.ts` (Phase 5) or `updateOrderStatusAction` (legacy direct path, only before Phase 5's workflow has started on that order) |

`partially_refunded` is the one new enum value. It is reachable **only** from `refundOrder` (a money-only
adjustment) and never changes `status` or `fulfillment_status` — an order can be `delivered` and
`partially_refunded` at the same time, which is exactly the real-world case (a partial return after
delivery). A refund that reaches the full remaining balance flips `payment_status` to `refunded` and, if a
transition exists from the current `status`, also moves `status` to `refunded` (see `refundOrder` in
`lib/orders/refunds.ts`).

`READY_TO_SHIP`, `PAYMENT_PENDING`, `COMPLETED` and the rest of the brief's "suggested" flat list are
deliberately **not** added as new `status` values — seeing why is the point of the table above: each one is
already a combination of the three existing fields (e.g. "payment pending" = `status=pending,
payment_status=unpaid`). Adding a second, overlapping status vocabulary on top would be the "duplicate
order system" the brief says not to build, and Postgres enum values can't be removed once added.

## What's new in Phase 4

- **`orders.tracking_number` / `orders.carrier`** — set by staff via `setTracking()` (`lib/orders/fulfillment.ts`),
  shown to the customer on `/account/orders/[id]` once set.
- **`orders.internal_notes`** — staff-only free text, appended (not overwritten) by `addOrderNote()`, each
  entry timestamped and attributed. Never selectable by the customer role (not in the RLS column grant),
  and not the same column as the customer's own checkout `notes`.
- **`orders.shipping_method_id`** → `shipping_methods` — which of the (admin-configurable) shipping options
  the order used; `express_shipping` (Phase 1's boolean) is kept for orders placed before this existed.
- **`orders.reservation_expires_at`** — see docs/INVENTORY_RESERVATION.md.
- **Customer-visible order timeline** (`/account/orders/[id]`) was, in Phase 4, a fixed five-stage visual
  derived only from `status`. **Replaced in Phase 5** by a real 7-stage timeline driven by the order's
  actual `fulfillment_status` and its packages' actual shipment statuses — see docs/SHIPPING.md.
  `order_events` remains the detailed, timestamped audit trail shown in `/admin/orders/[id]`, now merged
  there with three more Phase 5 event tables — see docs/FULFILLMENT.md's "Timeline" section.

## What's new in Phase 5

- **`fulfillment_status`** goes from a coarse three-stage field to a full pick/pack/ship/deliver workflow
  with multi-package support — see docs/FULFILLMENT.md and docs/ORDER_STATUS.md (which supersedes the
  `fulfillment_status` row in the table above).
- **Returns** are now a first-class workflow (`return_requests` and friends), not just a value of
  `fulfillment_status` — see docs/RETURNS.md.
- **A refund no longer overwrites `fulfillment_status`** — see "Refunds" below and docs/ORDER_STATUS.md.
- **Customer self-cancellation** (`lib/orders/cancellation.ts`) reuses `updateOrderStatus(..., "cancelled")`
  under a `SYSTEM_ACTOR`, after checking the order belongs to the requesting customer and is still in an
  eligible status (`pending`/`paid`/`processing` — never after shipment).

## Refunds

Two separate, intentionally different paths:

1. **Full refund tied to cancelling/returning an order** — `updateOrderStatus(..., "cancelled" | "refunded",
   { restock })`, unchanged from Phase 1 except that (Phase 5) it no longer overwrites `fulfillment_status`
   with a coarse `returned`/`cancelled` value once real fulfillment progress exists. Optionally restocks
   (writes a `RETURN` movement).
2. **Partial (or full, standalone) refund** — `refundOrder()`, new in Phase 4, extended in Phase 5 with an
   optional `returnRequestId` tag (set when the refund came from the formal returns workflow —
   docs/RETURNS.md). Money-only: adjusts `refund_total_cents`, `gross_profit_cents`, `gross_margin`,
   `payment_status`. Never touches inventory — restocking (if any) happens separately, either through
   Inventory directly or, for a return, only after inspection approves it (docs/RETURNS.md). See
   `docs/DATABASE_SCHEMA.md` for the `order_refund_bounds` constraint that makes over-refunding impossible
   even if application code has a bug.

Both write a `refunds` row, an `order_events` entry, and an audit log entry — there's no separate
"financial adjustment" ledger.

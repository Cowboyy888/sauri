# Order Status Model (Phase 5)

Three independent dimensions on `orders`, unchanged in principle since Phase 1, extended in Phase 5:

| Column | Meaning | Values |
|---|---|---|
| `status` | The financial/lifecycle milestone | `pending → paid → processing → shipped → delivered`, or `cancelled` / `refunded` |
| `payment_status` | What the payment provider says | `unpaid → paid → refunded` / `partially_refunded` / `failed` |
| `fulfillment_status` | The warehouse's granular operational state | see below |

These are never conflated. A `shipped` order's `payment_status` can still be `partially_refunded`; a
`paid` order's `fulfillment_status` can be `picking`.

## `fulfillment_status` (extended in Phase 5)

```
unfulfilled → processing → picking → packing → ready_to_ship ─┬→ partially_shipped → shipped → in_transit → delivered → completed
                                                                └→ shipped → in_transit → delivered → completed
                                                          (also: returned, cancelled — terminal, reached only via the paths below)
```

- **`unfulfilled` → `ready_to_ship`**: a strict linear staff checklist, one stage at a time, enforced by
  `STAGE_TRANSITIONS` in `lib/fulfillment/service.ts`'s `advanceFulfillmentStage()`. Skipping a stage
  (`processing → ready_to_ship`) or moving backward is rejected.
- **`ready_to_ship` → `completed`**: not a checklist but a **rollup** of every package's shipment status,
  recomputed by `recomputeOrderFulfillmentStatus()` every time a package's status changes:
  - not fully shipped yet → `partially_shipped`
  - fully shipped → the *lowest-progress* package's status (shipped/in_transit/delivered), so one package
    still in transit keeps the whole order at `in_transit` even if another already arrived
  - `completed` is manual only (`markCompleted()`), never automatic — see "Why completed is manual" below
- **`cancelled`**: set when the order is cancelled (customer or staff), regardless of what fulfillment
  stage it was in — cancellation always wins.
- **`returned`**: reserved for a bulk/whole-order return outside the per-item Phase 5 return workflow; the
  granular return system tracks individual return requests in `return_requests.status` instead (see
  docs/RETURNS.md) and does **not** set this value.

## `orders.status` sync — the two-milestone rule

`orders.status` only cares about two of the above stages: **shipped** and **delivered**. When the
fulfillment rollup reaches one of those for the first time, `recomputeOrderFulfillmentStatus()` also
writes `orders.status` directly — but **not** through `statusFields()` (the Phase 1 helper that maps a
lifecycle status to a *coarse* fulfillment status). Reusing `statusFields()` here would immediately
overwrite the fine-grained rollup with its own hardcoded `"shipped"` / `"delivered"` mapping, undoing the
whole point of Phase 5. This is the one deliberate exception to "always go through the shared status
helper" in the codebase — documented in `lib/fulfillment/service.ts`.

## Refunds never touch `fulfillment_status`

`statusFields("refunded", prev)` used to always coerce `fulfillment_status` to `"returned"` (or
`"cancelled"` if nothing had shipped). That is a *money* event overwriting *operational* history — the
same order that was properly delivered, then formally returned and refunded through the Phase 5 workflow,
would lose that history and show a contradictory "Fulfillment: Returned" badge. Fixed: a refund now only
downgrades `fulfillment_status` when it was still `"unfulfilled"` (nothing had happened yet); otherwise it
is left exactly as it was. `return_requests.status` is the real source of truth for "was this actually
returned" — see `tests/returns.test.ts`'s "a full refund never overwrites the order's real fulfillment
progress" for the regression test, and `tests/orders.test.ts`.

## Two "shipped/delivered" paths, never both at once

An order's detail page (`/admin/orders/[id]`) offers the old Phase 1/4 direct "Mark as shipped" / "Mark as
delivered" buttons (`OrderStatusControl`) **only** while `fulfillment_status` is still `"unfulfilled"` —
i.e., before the Phase 5 workflow has been used on that order at all. The moment `advanceFulfillmentStage`
is called once, those two transitions disappear from the direct control, and shipped/delivered can only be
reached through packages from then on. Cancelling and refunding remain available through the direct control
regardless — those are not superseded by Phase 5.

## Why `completed` is manual, not automatic

`delivered` does not auto-advance to `completed`. Staff mark an order completed once there is nothing left
to do — commonly once the return window has closed — via `markCompleted()`. This is deliberate: an
automatic timer would need to know the (configurable, per-policy) return window and would fire even for
orders customers are actively trying to return. See docs/RETURNS.md for the return window itself.

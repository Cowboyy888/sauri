# Phase 5 audit — shipping, fulfillment & returns

## 1. What already exists

| Need | Already exists | Where |
|---|---|---|
| Order lifecycle | `orders.status` (pending→paid→processing→shipped→delivered→cancelled→refunded), `TRANSITIONS`, `statusFields()` | `lib/orders/service.ts` |
| Fulfillment status | `orders.fulfillment_status` enum — but only 6 coarse values (`unfulfilled, processing, shipped, delivered, returned, cancelled`), no picking/packing/in-transit granularity | `lib/db/schema.ts` |
| Payment status incl. partial refund | `orders.payment_status`, `partially_refunded` (Phase 4) | same |
| Tracking (single, whole-order) | `orders.tracking_number`, `orders.carrier` (Phase 4) | same |
| Cancellation + restock | `updateOrderStatus(..., "cancelled" | "refunded", { restock })` — locks inventory, writes a `RETURN` movement, refunds, audits. Already prevents double-restock (`TRANSITIONS` rejects a second cancel) | `lib/orders/service.ts` |
| Full/partial refund | `refundOrder()` (Phase 4) — money-only, bounded by `order_refund_bounds` | `lib/orders/refunds.ts` |
| Inventory movements | `applyMovement()` — row-locked, always paired with a movement row; `RETURN`, `DAMAGED`, `RESTOCK` movement types already exist | `lib/inventory/service.ts` |
| Order timeline (lifecycle) | `order_events` (status, note, user, timestamp) | `lib/db/schema.ts` |
| Audit log | `audit_logs` — generic (actor, action, entity, entity_id, before, after) | `lib/audit.ts` |
| Admin notifications | `notifications` table + `notify()`, fired from inside `markOrderPaid`/`applyMovement`/`refundOrder` | `lib/audit.ts` |
| Customer email (stub) | `lib/email/provider.ts` (Phase 4) — logs what would be sent; no real provider selected | same |
| RBAC | `permissions.ts` — role × area matrix, enforced at route + service layer | `lib/auth/permissions.ts` |
| Customer order ownership | `getCustomerOrder(db, customerId, orderId)` — filters by `customerId`, not just `orderId` | `lib/storefront/account.ts` |
| Shipping methods | `shipping_methods` table (Phase 4) — flat price, estimated window, one method per order | `lib/db/schema.ts` |
| Order number, snapshots | `order_number_seq`, `order_items` snapshot columns | Phase 1, unchanged |

**Conclusion:** cancellation, restocking, refunds, and the audit/notification plumbing are Phase 1/4 business logic that Phase 5 *drives from new UI and new states*, not logic to rebuild. What's genuinely missing is (a) granular, staff-facing fulfillment stages (picking/packing) with per-line detail, (b) a shippable *package* as its own entity (an order can have more than one), and (c) the entire customer-return / inspection / restock-decision workflow.

## 2. What must be added (schema)

New tables: `inventory_locations`, `fulfillment_items` (per-line picking state — kept separate from `order_items`, whose columns are an immutable financial snapshot per brief §42, not a place for mutable operational flags), `packages` + `package_items` (multi-package support, brief §40), `shipping_events` (per-package carrier-status timeline), `fulfillment_events` (per-order fulfillment-status timeline, mirroring `order_events`'s existing shape for the *other* status dimension), `return_requests`, `return_items`, `return_inspections`, `return_events` (mirrors `order_events` again, for the return dimension).

Reused, not duplicated: `refunds` (a return's refund is a normal `refundOrder()` call, now taggable with `return_request_id`), `inventory_movements` (`RETURN`/`DAMAGED` types already exist), `audit_logs`, `notifications`, `order_events` (still the lifecycle timeline).

Enum additions: `fulfillment_status` gains `picking, packing, ready_to_ship, partially_shipped, in_transit, completed`. New enums: `shipment_status`, `return_status`, `return_reason`, `return_shipping_paid_by`, `return_condition`, `return_disposition`, `pick_status`.

## 3. Scope decisions (disclosed up front, not discovered later)

- **`order_status_history`** (brief §39's suggestion) is not a new table — `order_events` already is this, for the lifecycle dimension. The two *new* per-dimension timelines (`fulfillment_events`, `return_events`, `shipping_events` per package) follow the exact same proven shape rather than inventing a different one.
- **Return photos** are stored as plain HTTPS URLs (a `jsonb` text array on `return_items`), the same pattern `product_images.url` already uses — no file-upload/storage provider exists anywhere in this project yet, and provisioning one is a bigger decision than this optional field warrants. A real upload endpoint (Vercel Blob, e.g.) is a clean follow-up; the schema doesn't need to change for it.
- **Exchanges** get the architecture the brief asks for (`return_items.exchange_requested`, `replacement_variant_id`) but not a full replacement-order flow or automatic price-difference charging — the brief explicitly says not to build complicated exchange payment logic "unless necessary," and a price difference can be handled today as a manual admin refund/charge until real demand justifies automating it.
- **Carrier APIs / real label generation** are out of scope, exactly as §9 asks — labels are admin-entered (carrier, tracking number, service, optional label URL).
- **Inventory locations** are a reference table plus an optional column on `fulfillment_items`, not a rewrite of the stock model into per-location ledgers.

## 4. What must NOT change

Nothing in Phase 1–4's pricing, checkout, webhook, or existing `updateOrderStatus`/`refundOrder` call signatures changes. Phase 5 adds new functions (`advanceFulfillment`, package/shipment functions, return-workflow functions) that call the existing ones where the existing ones already do the job (restock, refund) rather than reimplementing them.

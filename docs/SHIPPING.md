# Shipping (Phase 5)

Covers the shopper-facing shipping method configuration and the package-level shipment lifecycle. See
docs/FULFILLMENT.md for how a package comes to exist in the first place.

## Shipping methods — configurable, not hardcoded (brief §15)

`shipping_methods` (extended in Phase 5 with `country_code`, `region`, `min_order_cents`,
`max_order_cents` — all nullable, meaning "no restriction"). Admin CRUD lives in
`lib/admin/shipping-methods.ts` (`createShippingMethod`, `updateShippingMethod`,
`setShippingMethodActive`), gated on `settings:write` (owner-only, same as every other store-wide
setting), at `/admin/settings/shipping`.

The storefront never writes this table — it only reads through `lib/storefront/shipping.ts`:

- `getActiveShippingMethods()` — every active method, for a simple listing (e.g. `/pages/shipping`).
- `getEligibleShippingMethods(db, { subtotalCents, countryCode?, region? })` — narrows to what a
  *specific* shopper may even choose from, given their destination and order value.
- `calculateShipping(db, { ...eligibility input, shippingMethodId })` — resolves one chosen method into a
  price and delivery estimate. The free-shipping waiver (`waivableAboveThreshold` + the order total against
  `STORE.freeShippingThresholdCents`) is decided *here and only here* on the storefront read path; the
  final total-money computation still happens once, in `lib/orders/pricing.ts`'s `computeTotals()` — this
  file only narrows the menu and previews a price, it never re-derives the checkout total.

`placeOrder()`'s `loadShippingMethod()` (`lib/orders/service.ts`) re-validates the *chosen* method against
this same eligibility (country/region/min/max) at the moment of order placement — never trust that a method
shown to the browser five minutes ago is still valid for this address and this cart.

## Packages and shipment status

A package's `shipment_status`:

```
label_created → ready_to_ship → shipped → in_transit → out_for_delivery → delivered
                                        ↘ delivery_failed → return_to_sender
```

`setPackageStatus()` (`lib/fulfillment/service.ts`) is the only writer; it stamps `shipped_at` the first
time a package reaches `shipped` and `delivered_at` the first time it reaches `delivered` (never
overwritten by a later re-fetch of the same status). See docs/FULFILLMENT.md for how package statuses roll
up into the order's own `fulfillment_status`.

## Tracking URLs (brief §14)

`trackingUrlFor(carrier, trackingNumber, customUrl?)` generates a tracking link for UPS, FedEx, USPS and
DHL by matching the carrier name (case-insensitive substring); any other carrier falls back to an
admin-entered custom URL, or `null` if none was given. This is intentionally just URL templating — no
carrier API integration exists yet. The architecture is ready for one: `createPackage()`'s
`labelUrl`/`trackingUrl` fields are already free-form, so a future carrier-API integration would only need
to populate them programmatically instead of from a form, with no schema change.

## Customer-facing tracking (brief §12)

The account order page (`/account/orders/[id]`) shows every package's carrier, tracking number (linked,
via `trackingUrlFor`) and a **real** 7-stage timeline (`OrderTimeline`,
`components/storefront/account/order-timeline.tsx`): Order Confirmed → Processing → Packed → Shipped → In
Transit → Out for Delivery → Delivered. The stage is derived from the order's actual `fulfillment_status`
plus its packages' actual `shipment_status` values (`currentStageIndex()`) — never a fixed mapping off the
payment/lifecycle status alone, which is what the pre-Phase-5 version of this component did.

## Shipping analytics (brief §35)

`/admin/analytics/shipping` (`lib/analytics/shipping.ts`):

- **Fulfillment time** = `shipped_at − paid_at`, averaged over orders with both timestamps present.
- **Delivery time** = `delivered_at − shipped_at`, same rule.

Both timestamps come from `order_events` (the moment the order-level status actually flipped — the same
event `recomputeOrderFulfillmentStatus()` writes), not from a package's own `shipped_at`/`delivered_at` —
an order can have several packages with different timestamps, and the order-level event is the single
authoritative moment the *order* itself became shipped/delivered. An order missing either timestamp is
excluded from that average rather than treated as zero, per the brief's explicit requirement never to
compute a duration from a missing timestamp. Per-carrier delivery time and delivery-failure counts are
broken out separately, from `packages` directly.

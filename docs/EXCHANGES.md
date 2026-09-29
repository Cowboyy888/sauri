# Exchanges (Phase 5 — architecture only)

The brief explicitly does not require complex payment logic for exchanges ("no complex payment logic
required unless necessary"), so Phase 5 ships the **data model and eligibility flag** for an exchange
request, not a working replacement-shipment workflow. This document records what exists and what a future
phase would need to add.

## What exists today

- `settings."returns".exchangeEnabled` — a store-wide toggle (brief §26), checked by
  `createReturnRequest()` alongside `refundEnabled`; if both are false, no return request of any kind can
  be created.
- `return_items.exchange_requested` (boolean) and `return_items.replacement_variant_id` (nullable FK to
  `product_variants`) — a customer can flag, per returned line, that they want a replacement variant
  (typically a different size) instead of a refund, and say which variant.
- `assertVariantExists()` (`lib/returns/service.ts`) validates that a chosen replacement variant actually
  exists, so a request can't reference a deleted or made-up variant id.
- The customer return request form (`ReturnRequestForm`,
  `components/storefront/account/return-request-form.tsx`) accepts `exchangeRequested` /
  `replacementVariantId` in its payload type, so the plumbing from browser → `createReturnRequest()` is
  already wired.

## What a future phase would need to add

An exchange is not "a return plus a new order" for free — it needs its own decisions this phase
deliberately left open:

1. **Replacement inventory**: reserving/deducting stock for the replacement variant, and what happens if
   it's out of stock (waitlist? auto-refund instead? partial exchange?).
2. **Replacement shipment**: a new `packages` row (or reuse of the returns workflow) to actually ship the
   replacement, with its own tracking, and a decision on whether it can go out before or only after the
   original item is received and inspected.
3. **Money delta**: if the replacement variant's price differs from the original (a different size is
   usually free, a different metal or gemstone might not be), whether to charge/refund the difference and
   through which payment flow.
4. **Admin UI**: `/admin/returns/[id]` today shows `exchangeRequested` as a flag on each line but has no
   action to actually fulfill an exchange — that action, and the shipment it creates, is what a future
   phase adds.

Until then, staff handle an exchange request manually: reject or complete the return as a refund, and place
a new manual order for the replacement (`channel: "MANUAL_ORDER"`, the same path phone/in-person orders
already use).

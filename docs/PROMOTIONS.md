# Promotions (Phase 7)

`lib/marketing/promotions.ts`, `/admin/marketing/promotions`. See docs/COUPONS.md for the code-usage/revenue
view of the same data, and docs/PHASE_7_AUDIT.md for why promotions and coupons are one system.

## One discount engine, extended — not a second one

Every "promotion" the brief describes (§13: percentage, fixed, free shipping, product/collection-scoped,
minimum spend, first-order, customer-segment, loyalty reward) is a row in the pre-existing `discounts`
table (Phase 1/2, extended by Phase 6 for loyalty-issued codes). There is no automatic, codeless, cart-level
promotion — every discount in this store requires a code, because building an automatic one would mean
changing how checkout prices a cart, which is out of scope for this phase. `createPromotion()` /
`updatePromotion()` are richer versions of the Phase 2 `createDiscount()`, adding the fields below; they are
gated on the new `marketing:write` permission, not the legacy OWNER-only `discounts:write` (docs/PHASE_7_AUDIT.md).

## Eligibility rules (brief §14)

| Rule | Column(s) | Checked in |
|---|---|---|
| Eligible / excluded products | `eligible_product_ids[]` / `excluded_product_ids[]` (uuid arrays) | `eligible()` in `lib/orders/pricing.ts` (pure, used for both validation and proration math) |
| Eligible / excluded collections | `eligible_collection_ids[]` / `excluded_collection_ids[]` | same |
| Eligible customer segments | `eligible_segments[]` (text[], values from `lib/crm/segments.ts`'s `SEGMENT_KEYS` — reused, never redefined) | `validateDiscount()` (`lib/discounts/service.ts`), via `getCustomerSegments()` |
| First-order only | `first_order_only` (boolean) | `validateDiscount()` — queries whether the customer has any prior order with `paid_at` set |
| Minimum order / maximum discount / dates / usage limit / per-customer limit | pre-existing columns | pre-existing checks, unchanged |

The legacy single `category_id`/`product_id` columns (Phase 2) still work — `eligible()` treats them as a
one-element case of the new arrays, so the old `/admin/discounts` page keeps functioning unchanged.
Eligibility for the *pricing math* (which lines a discount applies to, and how it's prorated across lines)
only ever needs product/category/collection scope, which is why that logic stays in the pure, DB-free
`orders/pricing.ts`; segment and first-order eligibility need a database read and are checked earlier, in
`validateDiscount()`, as a yes/no gate before pricing ever runs.

## Server-side validation only (brief §14, §39)

Every rule above — plus the pre-existing dates/limits/minimum — is checked in `validateDiscount()`, which
runs inside the same transaction as `placeOrder()`. The browser never sees or influences this: it only sends
a code string. A discount can never exceed the eligible subtotal (`Math.min` in `computeTotals`), can never
push a line negative, and (because checkout accepts exactly one code) can never combine with another
discount by accident — see "Discount stacking" below.

## First-order promotion (brief §18)

`firstOrderOnly` is **never auto-enabled** — an admin explicitly sets it when creating a promotion. Validated
by checking `orders.paid_at is not null` for that customer, using the same "recognized order" definition as
every other financial figure in this codebase (docs/ANALYTICS.md) — a pending or cancelled prior order does
not disqualify someone.

## Discount stacking (brief §40)

Checkout accepts exactly **one** discount code per order — true before this phase and unchanged by it. That
single fact already is the strictest possible stacking policy: a loyalty-reward code and a marketing
promotion/coupon can never be combined, because both are the same kind of row (`discounts`) competing for the
same one slot. The three settings the brief asks for
(`settings.marketing.stacking.{allowLoyaltyWithCoupon,allowRewardWithPromotion,allowFreeShippingRewardWithCoupon}`)
are stored and OWNER/ADMIN-editable (`/admin/marketing`), so the business's intent is recorded and visible —
but none of them can currently be turned on, since doing so would require a multi-discount checkout. This is
disclosed in the settings form itself, not a silent limitation.

## Promotion safety (brief §17, §39)

- A discount can never exceed the eligible subtotal.
- Two discounts can never combine (see above) — "incompatible discounts" is structurally impossible.
- Usage limits are enforced atomically: `consumeDiscount()` does a conditional `UPDATE ... WHERE used_count <
  usage_limit` and only proceeds if a row was actually updated, so two concurrent checkouts can never both
  claim the last use.
- Expired/inactive codes, and codes outside their eligible segment or already used by that customer, are all
  rejected with the same clear, customer-safe error message pattern the Phase 1 discount engine already used.
- Promotions never bypass stock: `placeOrder()` re-validates stock in the same transaction regardless of any
  discount applied (brief §39) — unchanged Phase 1 behavior.

## RBAC (brief §44)

`marketing:write` (OWNER, ADMIN) for creating/editing/pausing/deleting a promotion. A promotion that has ever
been used (`used_count > 0`) cannot be deleted — pause it instead — so historical `discount_usages` rows
never point at a missing code.

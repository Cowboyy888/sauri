# Coupons (Phase 7)

`/admin/marketing/coupons`, `lib/marketing/promotions.ts`'s `getCouponAnalytics()`/`listCouponUsages()`. See
docs/PROMOTIONS.md for the rules engine — a "coupon" here is exactly a `discounts` row with a code, viewed
through a usage/revenue lens rather than a rules-authoring one.

## Lifecycle (brief §15)

Create / activate / pause / expire / view usage / delete are all thin wrappers over the same functions
`/admin/marketing/promotions` uses (`createPromotion`, `setPromotionActive`, `deletePromotion`) — there is
one CRUD surface, not two. "Expire" is not a separate action: a coupon expires automatically once
`ends_at` passes or its usage limit is reached (`state` is computed, never a stored "expired" flag that could
drift out of sync with the dates). Codes are unique (`discounts_code_uq`, case-insensitive) — enforced by the
database, not just application code.

## Fields (brief §15)

Code, Type (percent/fixed/free shipping), Value, Minimum Spend, Maximum Discount, Start/End, Usage Limit,
Per-Customer Limit, Active — all pre-existing `discounts` columns (Phase 1/2).

## Coupon analytics (brief §16)

`getCouponAnalytics(db, discountId)` joins `discount_usages ⋈ orders` (the same join every discount-cost
figure in this codebase uses — never a duplicated total) to report, for the *recognized* (paid) orders that
used the code:

| Metric | Definition |
|---|---|
| Usage Count | rows in `discount_usages` for this code |
| Orders | distinct orders that used it |
| Revenue | Σ (subtotal − discount − refund) on those orders — net revenue, same definition as docs/ANALYTICS.md |
| Discount Cost | Σ `discount_usages.amount_cents` — what the code actually cost, not its face value |
| Average Order Value | Revenue ÷ Orders |
| New Customers | of the customers who used it, those with no earlier paid order *before* the order that used the code |
| Returning Customers | the complement |

This is exactly the "did this promotion generate incremental sales" question the brief asks (§16) — revenue
and cost side by side, plus whether it reached new or already-loyal customers, using only real order and
usage data.

## Safety (brief §17)

See docs/PROMOTIONS.md's "Promotion safety" section — identical enforcement, since a coupon and a promotion
are the same underlying row validated by the same `validateDiscount()`.

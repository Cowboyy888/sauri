# Reviews (Phase 6)

`lib/reviews/service.ts` (submission, eligibility, moderation) plus `lib/storefront/catalog.ts`'s
`getReviews()` (display — unchanged from earlier phases). See docs/PHASE_6_AUDIT.md for what already
existed before this phase.

## What already existed

Rating average, review count, the 1-5 star distribution, and a `verifiedPurchase` flag
(`order_id is not null`) were **already** computed by `getReviews()` before Phase 6 — display was solved.
`/admin/reviews` already listed reviews with a status filter and approve/hide actions. The actual gap was
that **customers could not submit a review at all**, there was no `rejected` status distinct from `hidden`,
and there was no structured moderation history (only a generic audit-log entry).

## Submission & eligibility (brief §20)

`createReview()` is customer-facing (not gated by staff `assertCan` — ownership *is* the check): a review
requires a real order that belongs to the submitting customer, that order's `status` must be `delivered`,
and the product must actually be a line on that order. `getReviewableProducts()` lists exactly the
(order, product) pairs a customer is currently eligible to review — every delivered order's products, minus
ones already reviewed.

**Duplicate prevention is enforced by the database**, not just application code: `reviews_one_per_order_product_uq`
is a partial unique index on `(customer_id, order_id, product_id)` (only where both are non-null, so
legacy/seeded reviews with no customer attached are exempt). A second `createReview()` call for the same
order and product fails the same way any other duplicate-key violation would.

## Moderation (brief §22)

`review_status` gained a fourth value, `rejected`, distinct from `hidden`: rejected means a moderator
declined it outright (never published); hidden means it was published and later taken down. `published` is
kept as the name for the approved state — renaming a live enum value is an unnecessary risk for a cosmetic
change.

`moderateReview()` enforces a strict allow-list of valid transitions (`pending → published | rejected`,
`published → hidden`, `rejected | hidden → published`) and writes every change to
`review_moderation_events` (`from_status`, `to_status`, `note`, `actor_user_id`, `created_at`) —
**parallel** to the generic `audit_logs` entry it also writes, but queryable per-review without joining
against the whole audit log. The review's own `rating`/`title`/`body` are never edited by any moderation
action — only its status ever changes (brief: "never silently modify customer review content").

Approving a review (`pending → published`) sends the customer a real email (`reviewApprovedEmail`) — the
one place review moderation triggers a notification.

## RBAC

Moderation requires `reviews:write` (unchanged permission, OWNER-only per the existing role matrix).
Submission requires only a signed-in customer session and eligibility — no staff permission is checked,
since it's the customer's own review.

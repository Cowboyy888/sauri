# Loyalty (Phase 6)

`lib/loyalty/service.ts`. Points, tiers and rewards, all configurable — none of the numbers below are the
final business rule, they are the seeded defaults. See docs/CRM.md for how this fits the wider CRM and
docs/PHASE_6_AUDIT.md for the "what counts as a completed order" scope decision this file also explains.

## Schema

`loyalty_accounts` (one per customer, the cached `points_balance` + lifetime earned/redeemed counters),
`loyalty_transactions` (every change, ever — see "Never a silent balance change" below), `loyalty_tiers`
(name, minimum spend, a `benefits` jsonb blob), `loyalty_rewards` (name, points cost, a discount
type+value), `loyalty_redemptions` (which reward, how many points, which `discounts` row it issued).

## Never a silent balance change (brief §25)

`writeLoyaltyTransaction()` (private) is the **only** function that ever updates
`loyalty_accounts.points_balance`, and it always does so in the same statement as inserting the
`loyalty_transactions` row that explains the change — `balance_before`, `balance_after`, `type`, `points`
(signed), a `reference_type`/`reference_id`, and a `reason`. A database check constraint
(`loyalty_transaction_balance_math`) enforces `balance_after = balance_before + points` — even a
application-code bug cannot silently desync the ledger from the cached total.

Transaction types: `EARN` (a paid order), `REDEEM` (a reward), `REFUND_REVERSAL` (a refund), `ADJUSTMENT`
(a manual admin change, or a merge folding in another account's balance), `EXPIRATION` (reserved — no
expiration policy is implemented yet), `BONUS` (reserved for a future promotional-points feature).

A reversal or redemption is **clamped** so the balance never goes negative: if a customer already spent
points that a later refund would otherwise reverse, the reversal is capped at whatever remains. The
customer isn't made to owe points for ones already spent — the same "sunk cost" logic real loyalty
programs use.

## Earning (brief §24)

Configurable via `settings."loyalty"` (`enabled`, `pointsPerDollar`) at `/admin/loyalty`. Points are earned
on **net merchandise revenue** (subtotal − discount, excluding tax and shipping), multiplied by the
customer's **current tier's** bonus multiplier — computed from their lifetime spend *before* this order, so
the same order can't retroactively bump itself into a richer multiplier. `earnPointsForOrder()` is called
from two places: `markOrderPaid()` (the Stripe webhook path) and `placeOrder()`'s direct-to-paid branch
(manual/in-person/wholesale orders) — both are "a paid order," and both should earn points. It's idempotent
against being called twice for the same order (checks for an existing `EARN` transaction referencing that
order id first).

**"Completed order" here has a specific, intentional meaning.** This codebase's `orders.status` has no
`completed` value — only `fulfillment_status` does, and only once staff mark it, sometimes long after
payment (docs/ORDER_STATUS.md). Per the brief's own instruction to use "the project's existing financial
rules," points are earned the moment revenue is recognized everywhere else in this codebase: `paid_at` set,
order not cancelled — the same definition `customer_stats`/`getMetrics()` already use. Gating points on the
Phase 5 fulfillment-completion milestone instead would mean a customer's points show up an unpredictable,
staff-dependent number of days after they paid, which the brief's own LTV formula (§7) explicitly avoids by
using the same "paid, not cancelled" rule.

Refunds reverse a **proportional** share of the order's earned points (`reversePointsForRefund()`, hooked
into both `updateOrderStatus(..., "cancelled" | "refunded")` and the standalone `refundOrder()`) — a half
refund reverses half the points that order earned, not all of them and not none.

## Tiers (brief §26)

A customer's tier is **derived** from lifetime net spend every time it's read (`getCustomerTier()`), never
stored on the customer row — a threshold change in `/admin/loyalty` takes effect for everyone immediately,
with nothing to migrate. `benefits` is a free-form jsonb blob today interpreted for exactly two things: a
`bonusPointsMultiplier` (used at earning time) and `earlyAccess`/`freeShipping` flags (informational only —
no code path currently enforces early access or waives shipping based on tier; adding that is future work,
not silently half-built here).

## Rewards & redemption (brief §27, §29)

Redeeming a reward **reuses the existing discount engine** rather than building a second one:
`redeemReward()` inserts a `discounts` row with the reward's type/value, `usageLimit: 1`,
`perCustomerLimit: 1`, and the new `restricted_to_customer_id` column set to the redeeming customer —
`validateDiscount()` (`lib/discounts/service.ts`) rejects the code for anyone else, so a leaked code is
useless. Redemption and the points deduction happen in one transaction; the generated code is emailed to
the customer and shown immediately on `/account/loyalty`.

## Where it's shown

- `/account/loyalty` — points, tier, progress to next tier, available rewards (redeemable in place),
  transaction history.
- `/admin/loyalty` — program KPIs (members, points issued/redeemed/outstanding), tier and reward
  configuration, the earning rule, and top loyalty customers by balance.
- A customer's own admin profile (`/admin/customers/[id]`) shows their balance and tier and lets staff make
  an audited manual adjustment (`adjustPoints()`, `loyalty:write`).

# Business logic

All of this lives in `src/lib` and runs on the server. The browser sends only variant ids, quantities, a discount code and addresses. The quote API rejects anything else with a 400.

## 1. Pricing (`orders/pricing.ts`, pure functions)

For a set of lines, each with a price and cost read **from the database**:

```
subtotal          = Σ quantity × unit price
discount_total    = code rule applied to eligible lines (category or product scope), capped at max_discount
line discount     = discount_total split across eligible lines pro rata (largest remainder, so it sums exactly)
line_total        = quantity × unit price − line discount
line_cost         = quantity × unit cost
line_profit       = line_total − line_cost
shipping_total    = 0 if the channel doesn't charge shipping; else the chosen shipping_methods row's price
                    (waived if that method is `waivable_above_threshold` and net ≥ $150, or a free-shipping
                    code) — falls back to the old flat $20 express / $8 standard only when no method id is
                    given (admin manual orders, the seed script; see lib/orders/pricing.ts)
tax_total         = calculateTax() in lib/orders/tax.ts — currently 8% of (subtotal − discount); a seam
                    for real jurisdiction-based tax later, not a second place the rate is hardcoded
total             = subtotal − discount + shipping + tax
cost_total        = Σ line_cost
gross_profit      = (subtotal − discount) − cost_total
gross_margin      = gross_profit ÷ (subtotal − discount) × 100
payment_fee       = channel fee (Website 2.9% + 30¢ · Physical store 2.6% + 10¢ · Manual/Wholesale 0)   ← internal cost
shipping_cost     = what we pay the carrier ($6.50 standard, $14 express, 0 in store)                    ← internal cost
```

Store rules live in `lib/config.ts`: tax rate, thresholds, carrier costs, time zone.

## 2. The order → inventory transaction (brief §13)

`placeOrder()` runs **one database transaction**. If any step throws, everything rolls back: no order, no movement, no reservation, no discount use, no notification.

1. Load the sales channel. Upsert the customer by lower-cased email.
2. **Lock the stock rows** for every variant in the cart (`SELECT … FOR UPDATE`, sorted by id so two concurrent orders can't deadlock).
3. **Re-price** every line from the database while holding the lock. Reject inactive products or variants.
4. **Validate stock:** available = stock − reserved. If short, reject with a clear message such as *"Only 2 units of Aurora Ring (14K Yellow Gold / Size 6) available."*
5. **Validate the discount** on the server: exists, active, date window, usage limit, minimum, scope, per-customer limit.
6. Compute totals (§1). Insert the **order** with its profit snapshot.
7. Insert the **order items** as snapshots: product name, SKU, variant (material, size, color, gemstone, label), unit price, unit cost, line discount, line total, line cost, line profit.
8. **Paid orders** (in-store, manual, or confirmed): deduct stock and write a **SALE movement** per line (`stock_before`, `stock_after`, reference `order` / `ORD-…`).
   **Pending orders** (web checkout awaiting Stripe): **reserve** the stock instead. Available drops, stock does not, and no movement is written yet.
9. **Consume the discount** atomically (`used_count < usage_limit` checked in the UPDATE itself) and record the usage.
10. Write the order timeline (`order_events`) and the payment record (provider + reference, never card data).
11. For a paid order: a **notification** (new order, or large order ≥ $500) and an **event** on `pg_notify('sauri_events')`. It is delivered only on commit, so the dashboard updates without a refresh.
12. **Low and out-of-stock notifications** fire if this order pushed a variant across its reorder level or to zero, once per crossing and not on every sale.
13. An **audit log** entry, if a staff member created the order.

Customer statistics (step 9 in the brief) are not stored; the `customer_stats` view derives them from these rows. Revenue, COGS and profit (steps 6–8 in the brief) are written as the order snapshot in step 6 of the list above.

### Payment (Stripe, live in Phase 4 — see docs/CHECKOUT.md, docs/PAYMENTS.md, docs/WEBHOOKS.md)

- `markOrderPaid(orderId, { providerRef, feeCents })`, called by the Stripe webhook (`/api/webhooks/stripe`), converts the reservation into a SALE movement, sets `paid_at`, and moves all three statuses to paid. **Idempotent:** a repeated webhook finds the order no longer pending and changes nothing.
- `recordPaymentFailure()` marks payment failed, keeps the order pending so the shopper can retry, and notifies staff. (A checkout session that expires or fails asynchronously instead cancels the order outright, releasing its reservation — see docs/INVENTORY_RESERVATION.md.)
- **The storefront cannot create a paid order.** Only staff (for in-person sales) or the webhook can.
- `refundOrder(orderId, { amountCents, reason })` (`lib/orders/refunds.ts`) is the new partial-refund path — see docs/ORDER_LIFECYCLE.md for how it differs from the full-refund-via-cancellation path above.

### Status changes (`updateOrderStatus`)

Allowed transitions: pending → paid | cancelled · paid → processing | cancelled | refunded · processing → shipped | cancelled | refunded · shipped → delivered | refunded · delivered → refunded. Anything else is rejected.

| Change | Stock | Money |
|---|---|---|
| pending → cancelled | reservation released, no movement | nothing was charged |
| paid/processing → cancelled, or → refunded | **RETURN** movement per line (unless `restock: false`) | `refund_total = subtotal − discount`. `cost_total` becomes 0 if restocked; otherwise the cost stays and the loss shows. `gross_profit` and `gross_margin` are recomputed. A `refunds` row is written. |

Every change writes `order_events`, an audit entry, and an event. Refunds also notify staff. Refunds are currently **full** refunds of the merchandise; partial refunds are planned (see the report).

**Phase 5 correction**: `→ refunded` used to also coerce `fulfillment_status` to `returned`/`cancelled`
via `statusFields()`. Since Phase 5 made `fulfillment_status` an operationally meaningful field (it drives
packages, the customer tracking timeline, and admin queues), that side effect was actively harmful — a
refund is a money event and shouldn't overwrite real fulfillment history. Fixed so a refund only touches
`fulfillment_status` if nothing had happened yet (still `unfulfilled`); see docs/ORDER_STATUS.md and
docs/FULFILLMENT.md, docs/SHIPPING.md and docs/RETURNS.md for the fulfillment/shipping/returns systems
this section's `updateOrderStatus`/`refundOrder` now interact with.

## 3. Inventory (`inventory/service.ts`)

- `available_stock = stock_quantity − reserved_quantity`, and status is OUT_OF_STOCK (≤ 0), LOW_STOCK (≤ reorder level) or IN_STOCK.
- **No silent changes.** The only function that writes `stock_quantity` is `applyMovement()`. It runs inside the caller's transaction, holding the row lock, and always inserts the movement row alongside.
- **Never below zero:** checked in code with a clear message, and again by the database constraint.
- **Restock** (`RESTOCK` movement): supplier, quantity, unit cost, reference (purchase order), notes. A different unit cost updates the variant's cost as a **weighted average**: `(old cost × stock + new cost × qty) ÷ (stock + qty)`. Both the stock change and the cost change are audited.
- **Adjust** to a counted level with a reason: ADJUSTMENT, DAMAGED, LOST, TRANSFER or MANUAL. The movement type records the reason.
- **Opening stock** is written as a PURCHASE movement (reference `opening_balance`), so on-hand stock always equals the sum of a variant's movements. The demo seed verifies this for all 142 variants.

## 4. Discounts (`discounts/service.ts`)

The code is matched case-insensitively. Checks: active, `starts_at` ≤ now ≤ `ends_at`, `used_count < usage_limit`, subtotal ≥ minimum, at least one eligible line for scoped codes, and per-customer uses below the limit (cancelled orders don't count). A quote shows a friendly error and keeps the rest of the cart. Placing an order with an invalid code fails the whole order.

## 5. The business test (brief §12)

`tests/business.test.ts`: Aurora Ring, cost $50, price $100, stock 100, customer buys 3. The test runs **twice**, once as a manual order and once through the real web flow (pending → payment confirmed). Both pass: stock 97, revenue $300, COGS $150, gross profit $150, margin 50%, inventory value $4,850, one SALE movement 100 → 97, and the order and line snapshots carry the same numbers.

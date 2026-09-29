# Inventory reservation

There is no `inventory_reservations` table — a reservation **is** a `pending` order. This was already true
in Phase 1 (`docs/BUSINESS_LOGIC.md` §2, step 8: *"Pending orders … reserve the stock instead"*); Phase 4
puts a real payment provider in front of the exact same mechanism rather than building a parallel one.

## Lifecycle

```
placeOrder(status: "pending")          stock_quantity unchanged, reserved_quantity += qty   (lib/inventory/service.ts: reserve())
        │
        ├─ webhook: payment confirmed → markOrderPaid()      reserved_quantity -= qty, stock_quantity -= qty, SALE movement
        │
        ├─ webhook: checkout.session.expired / async_payment_failed → updateOrderStatus("cancelled")   reserved_quantity -= qty, no movement
        │
        └─ nothing arrives (network issue, customer never returns) → reservation_expires_at passes
                    │
                    └─ released by whichever runs first: the next checkout's opportunistic sweep,
                       or the /api/cron/release-reservations schedule
```

`available_stock = stock_quantity − reserved_quantity` (unchanged Phase 1 formula, `lib/inventory/service.ts`).
Every step above runs inside a transaction holding the row lock (`SELECT … FOR UPDATE`, variant ids sorted
first) — unchanged Phase 1 locking, so a race for the last unit still produces exactly one winner regardless
of which of these code paths is deducting or releasing.

## Expiration (brief §30)

`orders.reservation_expires_at` is set only on `pending` web orders, to `STORE.reservationMinutes` (60)
after creation — the same window the Stripe Checkout Session's own `expires_at` uses, so the two expire
together.

`releaseExpiredReservations(db)` (`lib/orders/reservations.ts`) finds every `pending` order past that time
and cancels it. It is:

- **Idempotent / safe to run repeatedly** — cancelling an order that's already `cancelled` (a race with the
  webhook) is caught and skipped per-order, so one already-handled order never stops the rest.
- Called from two places: opportunistically at the top of every `startCheckout` (cheap, best-effort, never
  blocks the current checkout on its own failure), and from `GET /api/cron/release-reservations`, which
  `vercel.json` schedules every 15 minutes as the actual safety net (protected by `CRON_SECRET`, which
  Vercel Cron sends automatically as a bearer token once the env var is set).

In the common case, a reservation never reaches this sweep at all — the webhook releases it immediately
when Stripe reports `checkout.session.expired` or `async_payment_failed`. The sweep exists for the case
where that webhook never arrives.

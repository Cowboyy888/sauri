# Webhooks

`POST /api/webhooks/stripe` (`src/app/api/webhooks/stripe/route.ts`) is the **only** thing that ever marks
an order paid. The frontend's `onComplete` callback after Stripe's embedded Checkout is UX only — see
docs/PAYMENTS.md.

## Events handled

| Event | Action |
|---|---|
| `checkout.session.completed` | If `payment_status !== "unpaid"`, calls `markOrderPaid`. If it *is* `"unpaid"` (a delayed-notification payment method still processing), does nothing yet — waits for `async_payment_succeeded`. |
| `checkout.session.async_payment_succeeded` | Calls `markOrderPaid`. |
| `checkout.session.async_payment_failed` | Cancels the order (`updateOrderStatus(..., "cancelled")`), releasing its reservation. |
| `checkout.session.expired` | Same as above — the shopper never completed payment within the session window. |
| anything else | Recorded in `payment_events` (so a redelivery is still a fast no-op) and otherwise ignored. |

Every branch reads `session.metadata.orderId` — the order was already created (as `pending`) by
`startCheckout` before the Stripe session ever existed; the webhook only ever *transitions* it.

## Signature verification

```ts
event = stripe.webhooks.constructEvent(rawBody, req.headers.get("stripe-signature"), STRIPE_WEBHOOK_SECRET);
```

Missing header, missing secret, or a bad signature → `400` before the body is ever parsed as JSON. `POST`
reads the body with `req.text()` (the raw bytes Stripe signed), not `req.json()` — App Router route
handlers don't parse the body automatically, so no special config is needed (unlike the old Pages Router's
`bodyParser: false`).

## Idempotency (brief §12)

```
select 1 from payment_events where provider = 'stripe' and provider_event_id = $1
```

runs **before** any side effect. A match → `{ ok: true, duplicate: true }` immediately, nothing else runs.
On a new event, the handler processes it and **then** inserts the `payment_events` row (`onConflictDoNothing`
as a second line of defense against a near-simultaneous redelivery).

This is defense in depth on top of `markOrderPaid`'s own idempotency (an order that isn't `pending`
anymore short-circuits to `{ alreadyProcessed: true }` inside its own row-locked transaction) and
`updateOrderStatus`'s transition guard (`TRANSITIONS`, e.g. you can't cancel an order twice). Either
mechanism alone would already prevent a duplicate order, a double inventory deduction, or counting revenue
twice — see `tests/webhooks.test.ts` ("even if delivered twice").

## Local development

`stripe login`, then:

```
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired \
  --forward-to localhost:3000/api/webhooks/stripe
```

prints a `whsec_…` — put it in your own `.env` as `STRIPE_WEBHOOK_SECRET` and restart `npm run dev`. This
was used to verify the real end-to-end flow (a genuine Stripe test-mode payment, a genuine webhook
delivery) during Phase 4 development — see the "Commands used for validation" section of the final report.

## Failure handling

If the handler throws, the route returns `500` and Stripe retries with backoff (its documented at-least-once
delivery). Because the `payment_events` row is only written on success, a failed attempt is safe to retry —
nothing was marked "already processed" that didn't actually happen.

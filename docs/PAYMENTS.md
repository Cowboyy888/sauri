# Payments

## Provider

Stripe, provisioned as a real Vercel Marketplace **sandbox** resource (test mode) —
`vercel integration add stripe`, connected to the `sauri` Vercel project. No payment provider existed
before Phase 4. `.env.local` (Vercel-managed, gitignored) holds `STRIPE_SECRET_KEY` and
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, both `sk_test_…` / `pk_test_…`. Nothing in this codebase uses a live
key, and `lib/payments/stripe.ts` is the only file that reads `STRIPE_SECRET_KEY`.

## Integration surface

**Stripe Checkout Sessions**, `ui_mode: "embedded_page"`, `mode: "payment"`, `redirect_on_completion:
"never"`. This is Stripe's own recommended integration surface for a one-time payment inside your own
page (as opposed to redirecting to `checkout.stripe.com`), and matches Stripe's Vercel integration guide
and the `stripe-best-practices` skill installed alongside it.

- `payment_method_types` is **never** passed — Stripe's dashboard-configured dynamic payment methods
  decide what the shopper sees (skill guidance: this maximizes conversion and needs no code change to add
  a new payment method later).
- One line item per order line (its exact `line_total_cents`, after its share of any discount), plus a
  "Shipping — <method name>" line and an "Estimated tax" line **only when their amount is above zero** —
  all amounts come straight from the order Phase 1's `computeTotals` already computed and persisted;
  Stripe is never asked to compute a total itself.
- `metadata: { orderId, orderNumber }` is how the webhook finds the order again.
- `expires_at` is set to match `STORE.reservationMinutes` (60 minutes) from creation, so an abandoned
  checkout's Stripe session and our own stock reservation expire together.

## Client

`@stripe/react-stripe-js`'s `EmbeddedCheckoutProvider` / `EmbeddedCheckout`, mounted in
`components/storefront/checkout/checkout-flow.tsx` once `/api/checkout/session` returns a `clientSecret`.
`loadStripe(NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)` is called once at module scope (Stripe's own guidance —
never inside a render). The `options.onComplete` callback (not a redirect) clears the local cart and
navigates to `/checkout/success`.

No card data, card number, or CVV ever reaches our server, is logged, or is stored — the iframe is
Stripe's own origin.

## Confirmation is server-driven, never client-driven

The frontend's `onComplete` callback is **UX only** (it moves the shopper to the success page). It does
**not** mark anything paid. The only thing that ever calls `markOrderPaid` is the webhook handler
(`app/api/webhooks/stripe/route.ts`) — see docs/WEBHOOKS.md. This is deliberate: a shopper who closes the
tab the instant they click "Pay" still gets a correctly fulfilled order, because fulfillment never waited
for their browser.

## Local development

1. `.env.local` already has the Marketplace-provisioned test keys (from `vercel env pull`).
2. For a webhook signing secret locally: `stripe login`, then `stripe listen --forward-to
   localhost:3000/api/webhooks/stripe`, and copy the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET` in
   your own `.env`.
3. Test cards: `4242 4242 4242 4242`, any future expiry, any CVC, any postal code. Stripe's other
   [test cards](https://docs.stripe.com/testing) exercise declines, 3-D Secure, and delayed payment
   methods.

## Production

After the app is deployed, create a webhook endpoint in the Stripe Dashboard pointed at
`https://<your-domain>/api/webhooks/stripe`, subscribed to at least `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and
`checkout.session.expired`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET` as a production
environment variable (never committed). When ready for real charges, claim the sandbox resource
(`vercel integration resource claim stripe-cobalt-anchor`) and switch to live keys — everything else in
this document is unchanged.

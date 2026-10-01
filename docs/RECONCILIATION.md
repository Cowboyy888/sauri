# Payment reconciliation (Phase 9, brief §15)

## Purpose

Compare an internal `payments` row against what the payment provider actually recorded. This is a real
check against a real provider, not a mocked comparison: for `provider = 'stripe'` payments, `lib/finance/
reconciliation.ts#runStripeReconciliation()` calls the same Stripe client checkout already uses
(`lib/payments/stripe.ts#getStripe()`, test-mode) and retrieves the actual `PaymentIntent` the order's
`providerRef` points to (set by the webhook — docs/WEBHOOKS.md), comparing its `amount_received` against
what this system recorded.

## Why other payments start `IGNORED`, not `UNMATCHED`

`UNMATCHED` means a provider *was* checked and no record was found there (or the check hasn't run yet for a
Stripe payment). `IGNORED` means there is no electronic provider to check in the first place — cash,
in-store card-terminal, bank-transfer and manual payments. A manager can still reconcile these by hand
(`recordManualReconciliation()`, e.g. against a bank statement or till reconciliation), which reclassifies
the row based on the entered amount.

## Classification (`lib/finance/reconciliation.ts#classify`, pure and unit-tested)

| Internal | External | Result |
|---|---|---|
| any | not yet checked (`null`) | `UNMATCHED` |
| X | X | `MATCHED` |
| X | `0 < Y < X` | `PARTIAL` |
| X | anything else (`Y > X`, or `Y ≠ X` in a way that isn't a partial capture) | `DISCREPANCY` |

## One row per payment, not a growing ledger

`reconciliation_records.payment_id` is unique. Re-running a check (Stripe or manual) overwrites the same
row's `external_amount_cents`/`status`/`checked_at` rather than inserting a new one — this is a **current
comparison state**, not a transaction history. The history of *who* re-checked *when* lives in the audit
log (`audit_logs`, entity `reconciliation_record`), which is append-only by design.

## Review

`markReconciliationReviewed()` sets `reviewed_by_user_id`/`reviewed_at` and writes an audit entry — the
brief's "allow authorized users to mark records as reviewed... every manual reconciliation action must
create an audit log," satisfied by the same generic `audit()` helper every other Phase 9 write path uses.

## Permissions

`finance:write` (OWNER/ADMIN) for running a check, recording a manual entry, or marking reviewed.
`finance:read` for viewing the list.

## What this does not do

It does not automatically refund, adjust, or otherwise mutate an order or payment based on a discrepancy —
a human reviews the row and takes whatever action is appropriate (e.g. investigating with the customer or
the provider) through the existing, unchanged refund/order tools. Reconciliation is observation, not a
second write path into orders/payments.

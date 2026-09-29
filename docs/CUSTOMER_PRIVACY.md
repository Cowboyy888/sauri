# Customer Privacy & Data Security (Phase 6)

Covers consent, the anonymization/merge architecture (brief §36-37), and the ownership checks that keep one
customer from ever reaching another's data (brief §41). See docs/CRM.md for where consent/merge/anonymize
live in the broader CRM.

## Consent — never assumed (brief §16)

`customers.marketing_opt_in` / `sms_marketing_consent` hold current state; every change is also appended to
`customer_consents` (type, granted/withdrawn, source, timestamp) by the same `setConsent()` call — there is
no code path that flips the current-state column without logging why. Consent defaults to `false` for both
channels on a brand-new customer row; nothing opts a customer in silently. A guest checkout customer (no
account) has never had an opportunity to consent to anything beyond what they explicitly checked, and the
schema reflects that (`marketing_opt_in` defaults false at row creation regardless of channel).

## Anonymization vs. deletion (brief §37)

A customer with financial history (orders, refunds, audit-log entries, loyalty transactions) is **never**
blindly deleted — those records must survive for accounting and dispute-resolution purposes, and deleting
the customer row would either cascade-delete them (destroying required history) or leave orphaned foreign
keys. Instead, `anonymizeCustomer()` (OWNER-only):

- replaces `name`, `email` (with a `anonymized-<id>@deleted.invalid` placeholder), and `phone` in place,
- deletes `customer_addresses`, `customer_notes`, `customer_communications` — genuinely personal and not
  needed for any financial record,
- **leaves untouched**: `orders`, `order_items`, `payments`, `refunds`, `return_requests`,
  `loyalty_transactions`, `audit_logs` — every legally/financially relevant record, with the customer's
  identity now anonymized wherever those rows reference it by id,
- sets `anonymized_at`, a marker every read path can check to know this is no longer a live, contactable
  person (rather than inferring it from the placeholder email string).

This is a *reversible-in-principle* record (the historical rows are all intact) but *irreversible-in-
practice* (the original name/email are gone) — matching a real "right to be forgotten" request while
keeping what compliance actually requires.

## Merge (brief §36)

`previewMerge()` shows both customers' order/address/wishlist/review/loyalty/note counts side by side
before anything happens — no merge executes without this preview being shown first in the admin UI.
`mergeCustomers()` reassigns every row that references the "loser" customer id to the "survivor," folds the
loser's loyalty balance into the survivor's via an audited `ADJUSTMENT` transaction (never a silent balance
overwrite), and marks the loser row `merged_into_customer_id` rather than deleting it — anything that still
holds the loser's id by surprise resolves to a real, readable (if inert) row instead of a dangling
reference. The whole operation is one transaction: either everything moves, or nothing does. Every merge is
audit-logged with both customers' emails.

## Ownership checks (brief §41) — a customer must never reach another customer's data

Every customer-facing function takes the session's own `customerId` and checks it against the row being
accessed, inside the same transaction that reads or writes it — never inferred from a client-supplied id:

| Data | Check |
|---|---|
| Orders | `getCustomerOrder()` — `orders.customer_id = session customerId` (Phase 3/4) |
| Addresses | `getAddresses()`/`addAddress()`/`removeAddress()` — scoped to `customerId` (Phase 3) |
| Wishlist | `getWishlist()`/`addToWishlist()`/`removeFromWishlist()` — scoped to `customerId` (Phase 3) |
| Returns | `createReturnRequest()` — `order.customerId !== customerId` throws `ForbiddenError` (Phase 5) |
| Reviews | `createReview()` — same ownership check as returns, plus the order must be the customer's own |
| Loyalty account | `redeemReward()`/`getLoyaltySummary()` — scoped to `customerId`; RLS additionally
  restricts `loyalty_accounts`/`loyalty_transactions`/`loyalty_redemptions` reads to `customer_id in (select
  id from customers where user_id = auth.uid())` for any future direct Supabase-client read |
| Communication history | staff-only (`customers:write`) — a customer never reads this table at all, by
  design; there is no customer-facing endpoint for it |

RLS is enabled on every new Phase 6 table (a repo-wide test fails otherwise); tables a customer legitimately
reads directly (`loyalty_accounts`, `loyalty_transactions`, `loyalty_redemptions`, `customer_consents`) have
an explicit own-row policy exactly like `packages`/`return_requests` from Phase 5, and tables that are
staff-only (`customer_tags`, `customer_notes`, `customer_communications`, `abandoned_carts`,
`stock_notifications`, `review_moderation_events`, `wishlist_events`) have RLS enabled with **no** policy —
the same "enabled, no policy, so anon/authenticated see nothing" pattern every internal table in this
codebase already uses.

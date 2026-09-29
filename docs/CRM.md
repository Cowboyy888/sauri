# CRM (Phase 6)

Turns the existing customer system into a CRM without duplicating it. See docs/PHASE_6_AUDIT.md for what
already existed and every scope decision made along the way; this file covers the architecture itself.

## Reused, not rebuilt

`customers`, `customer_addresses`, `customer_stats` (view), `wishlists`, `reviews`, `discounts`, `settings`,
`audit_logs`, `notifications`, RBAC — all Phase 1-5. `lib/admin/customers.ts`'s `listCustomers()` /
`getCustomer()` (Phase 2) are **extended**, not replaced: search/sort/pagination and the favorite-category/
recent-products/wishlist/addresses sections were already there; Phase 6 adds phone, acquisition source, a
segment filter, product-affinity by material/size, order history with return status, tags, notes,
communications, consent history, RFM, segments and loyalty summary to the same two functions.

## New tables

`customer_tags` / `customer_tag_assignments` (brief §10), `customer_notes` (§11), `customer_communications`
(§12), `customer_consents` (§16), `wishlist_events` (§18), `abandoned_carts` (§19), `stock_notifications`
(§40), `review_moderation_events` (§22). Loyalty's five tables are documented separately in docs/LOYALTY.md.

## Customer acquisition & attribution (brief §8-9)

`sales_channels` describes how an *order* was transacted (fee %, ships/charges shipping) — it is **not**
reused for acquisition source, a different concept (how the *customer* found the brand, captured once).

- `components/storefront/attribution-capture.tsx` — a client component mounted once in the shop layout.
  It copies `document.referrer` and `?utm_*`/`?ref` into a cookie (`sauri_attribution`), but does **no**
  interpretation — it only overwrites the cookie when the current page load carries a fresh, meaningful
  signal (a UTM param, or a referrer from a different site), so browsing the store afterward never erases
  the original attribution.
- `lib/storefront/attribution.ts`'s `classifyAttribution()` maps that raw data into one of the fixed
  `acquisition_source` enum values (WEBSITE/INSTAGRAM/FACEBOOK/TIKTOK/GOOGLE/REFERRAL/PHYSICAL_STORE/
  WHOLESALE/DIRECT/OTHER), server-side, at read time — `readAttribution()` reads the cookie from the
  request in `/api/checkout/session`.
- `upsertCustomer()` (`lib/orders/service.ts`) sets `first_touch_source`/`first_touch_details` **only if
  not already set**, and always updates `last_touch_source`/`last_touch_details` — the exact first-touch/
  last-touch split the brief asks for. The newsletter signup route does the same on its own path.

## Tags, notes, communications (brief §10-12)

All three are plain CRUD in `lib/crm/customer-management.ts`, gated on `customers:write` (the same
permission SALES already has for "customer profiles and communication," per brief §42). Tags are
many-to-many (`customer_tag_assignments`) against a configurable vocabulary (`customer_tags`, seeded with
a starting set, never hardcoded elsewhere). Communications are **always manually logged** — there is no
code path that sends a message and then logs it; logging a call/email/SMS is something staff do after the
fact, exactly as the brief requires ("do not automatically send messages without explicit configured
automation").

## Consent & email preferences (brief §16-17)

`customers.marketing_opt_in` (repurposed as "email marketing consent" — it already meant exactly this via
the newsletter signup box) and the new `sms_marketing_consent` hold *current* state for fast reads;
`customer_consents` is an append-only log of every change, written by the same `setConsent()` call that
updates the current-state columns — never one without the other. `customers.email_preferences` (jsonb)
holds the four *marketing* categories (promotions, new arrivals, back-in-stock, loyalty); order/shipping/
return emails are transactional and never gated by any of this, matching the brief's explicit requirement
that transactional and marketing mail stay separate.

## Wishlist CRM (brief §18)

`wishlists` remains the single source of truth for a customer's *current* wishlist (Phase 3). Every add/
remove now also appends a row to `wishlist_events` — pure logging alongside it, never a second "wishlist."
`lib/analytics/wishlist.ts`'s conversion rate is defined precisely: of every (customer, product) ever
wishlisted, the share where that customer later bought that product (any order, any time after adding it).

## Abandoned carts (brief §19)

The cart is client-only (`localStorage`) — there is no server-side anonymous cart to mirror. Scoped to
signed-in customers only: the cart provider debounced-POSTs to `/api/cart/sync`, which re-prices every line
server-side and no-ops for anyone not signed in. `abandoned_carts` holds one row per customer (upserted),
marked `recovered` the moment that customer's order is paid (`markCartRecovered()`, hooked into
`markOrderPaid`). "Abandoned" itself is never a stored transition — `listAbandonedCarts()` computes
`effectiveStatus` from `last_activity_at` at read time, the same "derive it live" approach segments use, so
no sweep/cron is needed to flip a flag. No recovery email is ever sent from here.

## Back-in-stock (brief §40)

`stock_notifications` (customer or guest email + variant, one row per pair, not touched again until
`notified_at` is cleared by never — a second subscribe is a no-op). `notifyBackInStock()` fires inside
`applyMovement()` (`lib/inventory/service.ts`) the moment a variant's *available* stock crosses from ≤0 to
positive — the same movement pipeline every stock change already goes through. Unlike abandoned-cart
recovery, this **does** send a real email (`backInStockEmail`): it's a specific, single-product opt-in, not
marketing automation.

## Export, merge, and privacy

- **Export** (brief §33) extends the *existing* "customers" CSV report (`lib/admin/reports.ts`) with phone,
  acquisition source and tags — one export mechanism, not a second one.
- **Merge** (brief §36) — `lib/crm/customer-management.ts`'s `previewMerge()`/`mergeCustomers()`. Every
  order, address, wishlist row, review, note, communication, consent record, return request and loyalty
  redemption is reassigned to the survivor; the loser's loyalty balance is folded in via an audited
  `ADJUSTMENT` transaction (never a silent balance overwrite); the loser row is marked
  `merged_into_customer_id`, never deleted. Segment queries exclude merged-away rows
  (`c.merged_into_customer_id is null`).
- **Anonymization** (brief §37) — `anonymizeCustomer()`, OWNER-only. Replaces name/email/phone and deletes
  addresses/notes/communications (genuinely personal, not needed for financial history), but never touches
  `orders`, `refunds`, `audit_logs` or `loyalty_transactions` — those are the legally-relevant records that
  must survive. `anonymized_at` marks the row so it stops being treated as a live, contactable person.
- **Customer import**: not built this phase (not in the brief's Final Acceptance Criteria, unlike export
  and merge). Fields would be Name/Email/Phone; validation would need to check duplicate/invalid emails and
  missing required data, with a preview → validate → import → error-report flow, matching how the export
  side already works, before overwriting any existing customer record.

## RBAC (brief §42)

No new permission area beyond `loyalty` (docs/ROLES_AND_PERMISSIONS.md has the full mapping). Every CRM
write (tags, notes, communications, consent settings, export, merge, anonymize) requires `customers:write` —
OWNER, ADMIN, and SALES already have it. A signed-in customer's own reach is enforced the same way returns/
orders already are: every customer-facing function takes the *session's* customerId as an argument and
checks ownership inside the transaction (`createReview`, `redeemReward`, `setConsent`, …) — never a
client-supplied id.

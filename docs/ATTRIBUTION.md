# Attribution (Phase 7)

How a visit becomes a UTM-tagged touch, how that touch becomes a campaign, and how attribution is frozen
onto an order so campaign revenue never silently changes later. See docs/PHASE_7_AUDIT.md for what this
extends from Phase 6, and docs/CRM.md for the pre-existing acquisition-source capture this builds on.

## Capture (brief §4)

`components/storefront/attribution-capture.tsx` (unchanged mechanism, Phase 6) copies `utm_source`,
`utm_medium`, `utm_campaign`, `utm_term` (added Phase 7), `utm_content`, `ref` and `document.referrer` into
the `sauri_attribution` cookie — no interpretation happens client-side. It only overwrites the cookie when
the current page load carries a fresh, meaningful signal, so browsing the store afterward never erases the
original touch. `landing_page` is the page the cookie was first set on (available as `path` on the very
first `page_view` event for that session — see docs/EVENT_TRACKING.md); `session_id` is a separate, shorter
rolling cookie (`sauri_session`, 30 minutes idle) used only for session/funnel counting, never for
attribution.

## Classification (brief §8)

`lib/storefront/attribution.ts`'s `classifyAttribution()` maps the raw cookie into one of the fixed
`acquisition_source` enum values, server-side, at read time. Phase 7 adds one rule ahead of everything else:
`utm_medium = email` always classifies as `EMAIL`, regardless of what `utm_source` says (an email send's
source is often the campaign name itself, not a recognizable platform) — this is also how the new `EMAIL`
acquisition-source value is populated for channel analytics (docs/MARKETING_ANALYTICS.md).

## First-touch vs. last-touch (brief §4)

Unchanged from Phase 6: `customers.first_touch_source`/`first_touch_details` are set once, on a customer's
first order, and never overwritten; `last_touch_source`/`last_touch_details` update on every order that
carries acquisition data. Both are still exactly what they were — the new part is what Phase 7 does with
them at the moment of a purchase.

## The problem Phase 7 solves: attribution that doesn't drift

`customers.last_touch_*` keeps changing every time that customer visits again. If campaign revenue for an
order placed in March were computed by reading the customer's *current* `last_touch_*` in September, a
sale from a since-forgotten campaign would silently get reattributed to whatever the customer clicked most
recently — or the campaign's own numbers would keep moving after the fact. Neither is acceptable for
"campaign X made $Y," a number a business owner needs to stay true.

**`marketing_attributions`** is the fix: one immutable row per order, written inside the same transaction as
`placeOrder()` (`lib/orders/service.ts`), the instant the order is created. It stores:

- `first_touch_source` / `first_touch_details` — copied from the customer's row *as of that moment* (their
  true, permanent first touch — this never changes on a re-snapshot because first touch itself never changes).
- `last_touch_source` / `last_touch_details` — copied from *this specific request's* acquisition data (or, if
  the request carried none — e.g. a returning customer without a fresh referrer/UTM — the customer's current
  last-known touch, so the order still gets a real, honest attribution rather than none at all).
- `first_touch_campaign_id` / `last_touch_campaign_id` — resolved once, at write time, via
  `resolveCampaignId()` (`lib/marketing/campaigns.ts`), which matches `utm_campaign` to a `marketing_campaigns.slug`
  case-insensitively. Storing the id (not re-matching the string later) keeps every campaign-analytics query a
  plain join, and means renaming or deleting a campaign afterward can't retroactively change historical
  attribution.

No row is written at all when there is no known touch anywhere (a brand-new customer with a genuinely
direct/manual order) — never a fabricated attribution.

## Attribution models (brief §5)

`settings.key = 'marketing'` → `attributionModel: "FIRST_TOUCH" | "LAST_TOUCH"` (`lib/marketing/settings.ts`),
editable from the Marketing settings form (`/admin/marketing`). Every campaign/channel analytics query
(`lib/analytics/marketing.ts`) reads whichever `*_touch_campaign_id` / `*_touch_details` column the current
setting points to — switching the model is instant and retroactive (both snapshots already exist on every
order), no backfill needed.

`LINEAR` and `POSITION_BASED` are in the `attribution_model` enum (so the schema won't need another
migration later) but are **not implemented** — both require a customer's entire touch history across many
sessions, not just first/last. `marketing_events` (docs/EVENT_TRACKING.md) is exactly the raw material a
future phase would aggregate to compute them; the settings form only offers the two models this phase
actually computes, and visibly labels the other two "not yet implemented."

## Qualified sessions (brief §9)

A **session** is the `sauri_session` cookie value; a **qualified session** is a distinct session id that
produced at least one `page_view` event in the period — a real storefront visit, not a bare API hit.
`Conversion Rate = Completed (paid) Orders ÷ Qualified Sessions × 100`, `null` (shown as "—") when qualified
sessions is zero — never a fabricated `0%`.

# Marketing (Phase 7)

Where customers come from, which campaigns and promotions generate sales, and how well the storefront
converts — on top of the existing catalog, orders, CRM and loyalty systems, without rebuilding any of them.
See docs/PHASE_7_AUDIT.md for the full audit and every scope decision. The other Phase 7 docs cover one
system each:

- **docs/ATTRIBUTION.md** — UTM capture, first/last touch, the per-order attribution snapshot, attribution models.
- **docs/CAMPAIGNS.md** — campaign CRUD, status, spend, the URL builder.
- **docs/PROMOTIONS.md** — the extended discount engine (eligibility, first-order, stacking policy).
- **docs/COUPONS.md** — the code-usage/revenue view of the same discounts.
- **docs/MARKETING_ANALYTICS.md** — every KPI, campaign/channel table, and the funnel/conversion math.
- **docs/EVENT_TRACKING.md** — the centralized event log, capture, dedup, privacy, performance.

## Admin surface

| Page | Purpose |
|---|---|
| `/admin/marketing` | Overview KPIs, campaign performance, channel performance, marketing settings |
| `/admin/marketing/campaigns` | Campaign CRUD, status, spend logging, URL builder |
| `/admin/marketing/promotions` | Full promotion authoring (eligibility rules, dates, limits) |
| `/admin/marketing/coupons` | Code-focused usage/revenue/cost view of the same promotions |
| `/admin/marketing/email` | Email campaign creation, audiences, send |
| `/admin/marketing/abandoned-carts` | Tracking (Phase 6) + recovery analytics + manual "send now" (Phase 7) |
| `/admin/marketing/calendar` | Campaigns, promotions and email sends on a month/week grid |
| `/admin/analytics/marketing` | Campaign ROI table with date/campaign/source/medium filters |
| `/admin/analytics/funnel` | Sessions → Views → Cart → Checkout → Purchases |
| `/admin/analytics/collections` | Funnel + revenue per editorial collection |
| `/admin/analytics/search` + `/zero-results` | What customers search for, and what they can't find |
| `/admin/analytics/products` | Extended (Phase 2) with Views/Wishlist/Cart/Conversion columns |

## Email campaigns (brief §22-25)

`lib/marketing/email-campaigns.ts`, `email_campaigns` / `email_campaign_recipients`. Not a full enterprise
provider — reuses the Phase 6 `lib/email/provider.ts` abstraction, still a console-logging stub (no real
provider is configured; implementing one means writing `send()` there, nothing here changes). Audiences
(`resolveAudience()`) are resolved **live**, at send time, from existing data:

- **Segment** — any of Phase 6's `SEGMENT_KEYS` (New, Returning, High-Value, Inactive, …), reused verbatim.
- **Loyalty members** — customers with a `loyalty_accounts` row.
- **Bought a category** — customers with a paid order containing a product in that category.
- **Has wishlist items** — customers with at least one `wishlists` row.

Every audience query filters to `marketing_opt_in = true and anonymized_at is null` — **checked again at send
time**, not just when the campaign was created, so a later opt-out is always honored (brief §24: "never send
marketing email without valid consent"). Sent/Delivered are real counts (every recipient really gets a call
through `emailProvider.send()`); **Opened/Clicked/Unsubscribed are always reported as unavailable** — this
provider genuinely cannot supply that data, and the brief is explicit: don't invent it (§25). An email
campaign may optionally link to a `marketing_campaigns` row, in which case its Orders/Revenue figures come
from that campaign's own attribution query — the same one every other campaign uses, not a second,
per-recipient tracking system the current stub provider can't actually support.

## Abandoned-cart recovery automation (brief §20)

Tracking, KPIs and the customer-facing cart itself are unchanged from Phase 6 (docs/CRM.md). Phase 7 adds:

- **Recovery analytics** (Recovery Rate, Recovered/Net Recovered Revenue) — docs/MARKETING_ANALYTICS.md.
- **A manual "send now"** action (`sendAbandonedCartRecoveryNow()`) — a staff member explicitly triggers one
  real recovery email for one cart, through the same email provider abstraction.
- **A configurable (default off) automation schedule** — `settings.marketing.abandonedCartAutomation =
  { enabled: false, steps: [{afterHours:1},{afterHours:24},{afterHours:72}] }`. **No scheduled sender was
  built**: the Vercel Hobby plan's one daily cron slot is already used by `release-reservations`
  (docs/ORDER_LIFECYCLE.md), and the brief is explicit that automation must never run until the business
  turns it on. Turning `enabled` on today changes nothing by itself — wiring a scheduler to call
  `sendAbandonedCartRecoveryNow()` on a timer is a small, well-defined follow-up once a cron slot (or a
  higher Vercel plan) is available. This is disclosed here rather than silently half-built.

## Marketing calendar (brief §41)

`/admin/marketing/calendar` — a month or week grid built from real dates already on campaigns
(start/end), promotions (starts/ends) and email campaigns (scheduled/sent), no separate "calendar events"
table. Every entry links back to the page that manages it (brief: "allow admin to click an event to view
details").

## RBAC (brief §44) and audit logging (brief §43)

See docs/CAMPAIGNS.md's RBAC section for the full breakdown. Every mutation (campaign, promotion, coupon,
cost entry, email campaign, marketing settings, abandoned-cart send) writes an `audit_logs` row through the
existing `audit()` helper.

## Database (brief §45)

New tables: `marketing_campaigns`, `campaign_costs`, `marketing_attributions`, `marketing_events`,
`email_campaigns`, `email_campaign_recipients`. Extended: `discounts` (eligibility arrays, `first_order_only`,
`campaign_id`, `name`), `acquisition_source` enum (added `EMAIL`). See docs/DATABASE_SCHEMA.md for the full
table-by-table reference and docs/EVENT_TRACKING.md for why there's one event table, not several.

No `promotion_rules`, `coupon_codes`, `coupon_usages` or `search_events` tables exist separately from what's
listed above — the brief's own table list (§45) is a menu of *possible* tables, and each of those four is
already covered by an existing or extended table (`discounts`/`discount_usages` for the first three,
`marketing_events` for the fourth) rather than a duplicate.

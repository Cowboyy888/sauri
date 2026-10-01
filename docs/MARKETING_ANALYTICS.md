# Marketing & conversion analytics (Phase 7)

`lib/analytics/marketing.ts`. Every figure is a real aggregate query — behavioral counts come from
`marketing_events`, every dollar figure comes from `orders`/`order_items` (docs/ANALYTICS.md's existing
conventions: "recognized order" = paid, money in cents, zero-safety throughout). See docs/ATTRIBUTION.md for
how an order is matched to a campaign/channel.

## `/admin/marketing` — overview KPIs (brief §3)

`getMarketingOverview(db, range)`. "Marketing" here means orders whose resolved campaign (per the configured
attribution model) is not null — i.e., came through a tracked campaign, as opposed to organic/direct traffic.

| KPI | Definition |
|---|---|
| Marketing Revenue / Orders / Customers | Net revenue / order count / distinct customers, restricted to orders with a known campaign |
| Conversion Rate | Marketing orders ÷ qualified sessions × 100 — `null` when there are no qualified sessions (docs/ATTRIBUTION.md) |
| Average Order Value | Marketing revenue ÷ marketing orders |
| Discount Amount | Σ `discount_total_cents` on marketing-attributed orders |
| New / Returning Customer Revenue | Net revenue split by whether that order was the customer's first recognized order — brief §32 |

## Campaign performance (brief §8, §28-29)

`getCampaignPerformance(db, range)` — one row per campaign, joining `marketing_events` (funnel: sessions,
product views, add-to-cart, checkout starts, all `WHERE campaign_id = …`) with `orders ⋈ marketing_attributions`
(orders, revenue, units, discounts, new/returning customers) and `campaign_costs` (spend):

- **ROAS** = revenue ÷ spend.
- **ROI** = (revenue − spend) ÷ spend × 100.
- **CAC** = spend ÷ new customers acquired.

All three report **`null` ("N/A"), never `0`**, when no spend has been logged for that campaign — a
campaign with real revenue and no spend is not "infinite ROAS," it's "we don't know the cost," and the UI
says so. ROAS and ROI are never confused with each other (brief's own worked example — $500 spend, $2,000
revenue → ROAS 4.0x, ROI 300% — is a regression test, `tests/campaigns.test.ts`). Campaigns are never ranked
"best"/"worst" — the table presents the numbers and lets the reader judge (brief §29).

## Channel performance (brief §26-27, §30)

`getChannelPerformance(db, range)` classifies traffic into Organic Search / Google Ads / Direct / Instagram /
Facebook / TikTok / Referral / Email / Other from `utm_source`/`utm_medium` (falling back to the
`acquisition_source` enum for the Direct/Referral defaults) — the same classification rule
(`channelCase()`) is applied identically to orders, sessions and ad spend, so a channel's numbers are never
computed three inconsistent ways. Google Ads vs. Organic Search is the one place this phase reads
`utm_medium` (`cpc`/`ppc`/`paid` vs. anything else) rather than just `utm_source`, per the brief's explicit
ask to distinguish them (§27). **Ad spend and ROAS are `null` for a channel with no `campaign_costs` logged
against a campaign of that source/medium** — never a fabricated cost, and platform-level impressions are
never claimed since no ad platform is actually connected (brief §26-27).

## Funnel (brief §33)

`getMarketingFunnel(db, range)` reports **Sessions → Product Views → Add to Cart → Checkout Started →
Purchases** as five **independent counts** in the period (distinct sessions with a `page_view`; count of
`product_viewed`; count of `cart_added`; count of `checkout_started`; count of paid orders) — not a strict
per-visitor waterfall, because a guest session can't be reliably joined all the way through to an order. Each
rate (View/Cart/Checkout/Purchase Rate) is the ratio of one stage to the one before it; the page states this
definition next to the numbers, per the brief's "make definitions visible."

## Product & collection conversion (brief §10-12)

- `/admin/analytics/products` (extended, Phase 2) gained Views, Wishlist Adds (reusing Phase 6's
  `wishlist_events` — not a duplicate), Add to Cart, and Conversion Rate (units sold ÷ views) columns,
  computed by `getProductFunnelExtras()`.
- `/admin/analytics/collections` (new) reports the same funnel shape for actual `collections` rows (the
  editorial groupings like "Celestial") — category pages and virtual storefront nav entries ("All Jewelry")
  are out of scope here; see docs/PHASE_7_AUDIT.md.

Both let the owner spot "high traffic, low sales" (a merchandising or price problem), "high sales" (what's
working), "high wishlist, low purchase" (desire without conversion — a price or stock-timing signal), and
"low stock, high demand" (cross-referencing `/admin/analytics/products` against `/admin/inventory`).

## Search analytics (brief §36-38)

`getSearchAnalytics()` / `getZeroResultSearches()` / `getSearchConversion()` read `marketing_events` rows of
type `search` (query + `results_count`, captured by the storefront search page). Zero-result searches
(`/admin/analytics/search/zero-results`) surface demand the catalog can't currently satisfy — the page is
explicit that nothing here creates a product automatically (brief §37). Search-driven product clicks/orders/
revenue are not implemented this phase (would need a click-through id linking a search session to a later
purchase, which the current event shape doesn't carry) and are visibly zero rather than guessed at.

## Back-in-stock demand (brief §38)

`getBackInStockDemand()` extends Phase 6's `stock_notifications` with current available stock and purchases
placed after the first notification for that variant went out — a real cross-reference between "who's
waiting" and "did restocking actually convert," for inventory planning.

## Recovery analytics (brief §21)

`getRecoveryAnalytics()` (used on `/admin/marketing/abandoned-carts`) — `Recovery Rate = Recovered Carts ÷
Eligible Abandoned Carts × 100` (eligible = carts old enough to count as abandoned, or already recovered, in
the period), plus Recovered Revenue, Discount Cost and **Net** Recovered Revenue (revenue minus the discount
given on the recovering order) — see docs/MARKETING.md for the abandoned-cart system itself.

## New vs. returning revenue (brief §32)

`getNewVsReturningRevenue()` — same "was this the customer's first recognized order" split used throughout,
reported as both revenue and order counts, restricted to recognized (paid) orders.

## Device & landing page analytics (brief §34-35)

`getDeviceAnalytics()` groups sessions/orders/revenue by the coarse device class (docs/EVENT_TRACKING.md);
`getLandingPageAnalytics()` reports sessions by each session's *first* `page_view` path in the period. Both
are read-only reporting helpers with no dedicated nav page this phase (available for a future dashboard
addition) — exposed as functions, not left unbuilt, so nothing here is architecture-only.

## Consistency

Every one of the above reads the *same* `orders`/`order_items`/`marketing_attributions` tables the headline
sales dashboard does — a campaign's reported revenue and the main dashboard's net revenue for the same period
can never disagree, because there is exactly one source of truth for money (docs/ANALYTICS.md).

# RFM Analysis (Phase 6)

`lib/crm/segments.ts`'s `getCustomerRFM()` / `getRFMDistribution()`. See docs/CUSTOMER_SEGMENTS.md for the
separate (but related) segment system these functions sit alongside.

## The three metrics — exact definitions

| Metric | Definition |
|---|---|
| **Recency** | Days since the customer's last *recognized* order (`customer_stats.last_order_at`) |
| **Frequency** | `customer_stats.total_orders` — count of recognized orders, all time |
| **Monetary** | `customer_stats.total_spent_cents` — net customer revenue (subtotal − discount − refund), all time |

All three are read straight from the same `customer_stats` view every other financial figure in this
codebase uses — there is no separate RFM computation path that could drift from it.

## Labels — only what the metrics support

The brief explicitly warns against subjective labels beyond what the metrics support. Recency is the one
metric turned into a label, because it is what most directly predicts churn risk in a repeat-purchase
business — frequency and monetary stay as plain numbers, shown alongside the recency label rather than
folded into one invented "RFM score":

```
recencyDays ≤ recencyRecentMaxDays   → "Recent"
recencyDays ≥ recencyInactiveMinDays → "Inactive"
recencyDays ≥ recencyAtRiskMinDays   → "At Risk"
otherwise                            → "Active"
no recognized order at all           → "Inactive"
```

`isFrequent` (`frequency >= frequencyFrequentMinOrders`) and `isHighValue`
(`monetaryCents >= monetaryHighValueCents`) are exposed as separate booleans a caller can use, rather than
combined into the recency label — a customer can be simultaneously "Recent" and high-value, and showing
both facts plainly is more honest than compressing them into one word.

## Configurable thresholds

All five thresholds (`recencyRecentMaxDays`, `recencyAtRiskMinDays`, `recencyInactiveMinDays`,
`frequencyFrequentMinOrders`, `monetaryHighValueCents`) live in the `rfm` sub-object of the same `"crm"`
settings row segments use (docs/CUSTOMER_SEGMENTS.md), editable at `/admin/customers/segments`. The business
owner can move what counts as "at risk" without a code change or a data migration.

## Where it's shown

- A customer's own profile (`/admin/customers/[id]`) shows their raw recency (days)/frequency (orders)/
  monetary (net spend) figures plus the recency label as a badge.
- `/admin/analytics/customers` shows the **distribution** across the whole customer base — how many
  customers are Recent / Active / At Risk / Inactive right now (`getRFMDistribution()`) — a single, cheap
  in-memory pass over every buyer's `last_order_at`, not a per-customer round trip.

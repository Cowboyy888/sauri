# Customer Segments (Phase 6)

`lib/crm/segments.ts`. Every segment is a SQL predicate evaluated live against `customers`/`customer_stats`/
`orders` — there is no table of segment membership to keep in sync, and none can ever go stale. See
docs/CRM.md for the wider CRM architecture and docs/RFM.md for the related but distinct RFM analysis.

## The eight segments (brief §2, §4)

| Key | Definition | SQL predicate (`segmentWhere()`) |
|---|---|---|
| `new` | Registered within the configured period | `customers.created_at >= now() - newCustomerDays` |
| `first_time` | Exactly one completed order | `customer_stats.total_orders = 1` |
| `returning` | Two or more completed orders | `customer_stats.total_orders >= 2` |
| `high_value` | Lifetime spend above the configured threshold | `customer_stats.total_spent_cents >= highValueThresholdCents` |
| `inactive` | Has ordered before, but not within the configured period | `total_orders > 0 and (last_order_at is null or last_order_at < now() - inactiveDays)` |
| `frequent` | Multiple purchases within the configured recent window | `count(orders in the last frequentBuyerDays) >= frequentBuyerMinOrders` |
| `never_purchased` | Registered, zero completed orders | `customer_stats.total_orders = 0` |
| `recent_purchasers` | Ordered within the configured recent window | `last_order_at >= now() - recentPurchaserDays` |

"Completed order" here means the same "recognized" order every other financial figure in this codebase
uses: `paid_at is not null`, `status <> 'cancelled'` — never a separate definition invented for segments.
A customer marked `merged_into_customer_id` (docs/CRM.md's merge feature) is excluded from every segment
query and count — a merged-away row is not a live customer.

## Thresholds are configurable, never hardcoded

`settings` row keyed `"crm"` (`DEFAULT_CRM_SETTINGS`, `lib/db/reference-data.ts`): `newCustomerDays`,
`inactiveDays`, `highValueThresholdCents`, `recentPurchaserDays`, `frequentBuyerDays`,
`frequentBuyerMinOrders`, plus the RFM sub-object (docs/RFM.md). Read via `getCrmSettings()`, written via
`setCrmSettings()` (`customers:write`), editable at `/admin/customers/segments`. Changing a threshold takes
effect immediately for every customer — there is nothing to migrate or recompute.

## Where segments show up

- `/admin/customers` — a segment filter dropdown, reusing `listCustomers()`'s existing search/sort/
  pagination rather than a separate query path.
- `/admin/customers/segments` — one card per segment with its live count, and (when a segment is selected)
  a paginated member list (`listSegmentMembers()`).
- A customer's own profile (`/admin/customers/[id]`) shows every segment it currently belongs to
  (`getCustomerSegments()`), computed in one query so the badges and the filtered list can never disagree.


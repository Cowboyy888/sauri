/** Shipping performance (brief §35): fulfillment time = shipped_at − paid_at, delivery time = delivered_at
 *  − shipped_at. Both timestamps come from `order_events` (the moment the order-level status actually
 *  flipped, set once by `recomputeOrderFulfillmentStatus`) — never fabricated, and an order missing either
 *  timestamp is excluded from that average rather than treated as zero. */
import "server-only";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import type { Range } from "./service";
import { n, rows } from "../admin/sql";

export type ShippingMetrics = {
  ordersShipped: number; ordersDelivered: number;
  avgFulfillmentHours: number | null; avgDeliveryHours: number | null;
  byCarrier: { carrier: string; packages: number; avgDeliveryHours: number | null; deliveryFailures: number }[];
};

export async function getShippingMetrics(db: DbOrTx, r: Range): Promise<ShippingMetrics> {
  const [row] = await rows<Record<string, string | null>>(db, sql`
    with milestones as (
      select o.id, o.paid_at,
        (select min(e.created_at) from order_events e where e.order_id = o.id and e.status = 'shipped') as shipped_at,
        (select min(e.created_at) from order_events e where e.order_id = o.id and e.status = 'delivered') as delivered_at
      from orders o where o.paid_at >= ${r.from.toISOString()} and o.paid_at < ${r.to.toISOString()}
    )
    select
      count(*) filter (where shipped_at is not null) as orders_shipped,
      count(*) filter (where delivered_at is not null) as orders_delivered,
      avg(extract(epoch from (shipped_at - paid_at)) / 3600.0) filter (where shipped_at is not null and paid_at is not null) as avg_fulfillment_hours,
      avg(extract(epoch from (delivered_at - shipped_at)) / 3600.0) filter (where delivered_at is not null and shipped_at is not null) as avg_delivery_hours
    from milestones`);

  const byCarrier = await rows<Record<string, string | null>>(db, sql`
    select coalesce(p.carrier, 'Unknown') as carrier, count(*) as packages,
      avg(extract(epoch from (p.delivered_at - p.shipped_at)) / 3600.0) filter (where p.delivered_at is not null and p.shipped_at is not null) as avg_delivery_hours,
      count(*) filter (where p.status = 'delivery_failed') as delivery_failures
    from packages p join orders o on o.id = p.order_id
    where o.paid_at >= ${r.from.toISOString()} and o.paid_at < ${r.to.toISOString()}
    group by coalesce(p.carrier, 'Unknown') order by count(*) desc`);

  return {
    ordersShipped: n(row?.orders_shipped), ordersDelivered: n(row?.orders_delivered),
    avgFulfillmentHours: row?.avg_fulfillment_hours != null ? Number(row.avg_fulfillment_hours) : null,
    avgDeliveryHours: row?.avg_delivery_hours != null ? Number(row.avg_delivery_hours) : null,
    byCarrier: byCarrier.map((c) => ({ carrier: c.carrier!, packages: n(c.packages), avgDeliveryHours: c.avg_delivery_hours != null ? Number(c.avg_delivery_hours) : null, deliveryFailures: n(c.delivery_failures) })),
  };
}

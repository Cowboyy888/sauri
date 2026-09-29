/** Read-side queries for the admin fulfillment dashboard and the fulfillment section of an order page
 *  (brief §3-11). All writes go through `lib/fulfillment/service.ts` — this file only reads. */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { n, rows } from "./sql";

export type QueueRow = { id: string; orderNumber: string; customer: string; items: number; placedAt: Date; paidAt: Date | null };

const QUEUE_STAGES = ["processing", "picking", "packing", "ready_to_ship", "partially_shipped", "shipped", "delivered"] as const;
export type QueueStage = (typeof QUEUE_STAGES)[number];

/** One row per stage of the admin fulfillment queue (brief §3): counts plus the oldest few orders, so the
 *  dashboard never loads every order in a stage into the browser. */
export async function listFulfillmentQueues(db: DbOrTx, limitPerStage = 8): Promise<Record<QueueStage, { count: number; rows: QueueRow[] }>> {
  const out = {} as Record<QueueStage, { count: number; rows: QueueRow[] }>;
  for (const stage of QUEUE_STAGES) {
    const res = await rows<Record<string, string | null>>(db, sql`
      select o.id, o.order_number, c.name as customer, o.placed_at, o.paid_at,
        (select coalesce(sum(i.quantity),0) from order_items i where i.order_id = o.id) as items, count(*) over () as total
      from orders o join customers c on c.id = o.customer_id
      where o.fulfillment_status = ${stage}
      order by coalesce(o.paid_at, o.placed_at) asc
      limit ${limitPerStage}`);
    out[stage] = {
      count: n(res[0]?.total),
      rows: res.map((r) => ({ id: r.id!, orderNumber: r.order_number!, customer: r.customer!, items: n(r.items), placedAt: new Date(r.placed_at!), paidAt: r.paid_at ? new Date(r.paid_at) : null })),
    };
  }
  return out;
}

export async function listInventoryLocations(db: DbOrTx) {
  return rows<{ id: string; name: string; code: string }>(db, sql`select id, name, code from inventory_locations where active order by position, name`);
}

export type PickRow = {
  id: string; orderItemId: string; productName: string; sku: string; variant: string; quantity: number;
  pickStatus: string; pickedQuantity: number; locationId: string | null; locationName: string | null;
};
export type PackageRow = {
  id: string; packageNumber: number; status: string; carrier: string | null; service: string | null; trackingNumber: string | null; trackingUrl: string | null;
  weightGrams: number | null; shippedAt: Date | null; deliveredAt: Date | null;
  items: { orderItemId: string; productName: string; sku: string; quantity: number }[];
};
export type TimelineRow = { at: Date; source: "order" | "fulfillment" | "shipping" | "return"; status: string; note: string | null; user: string | null; extra?: string };

/** Everything the order detail page's fulfillment section needs: the picking list, existing packages
 *  (with their items), how much of each line remains unpackaged, and a combined timeline merging the
 *  three Phase 5 event tables with the Phase 1 order_events (brief §33). */
export async function getOrderFulfillmentDetail(db: DbOrTx, orderId: string) {
  const [items, packagesRes, timeline] = await Promise.all([
    rows<Record<string, string | null>>(db, sql`
      select fi.id, fi.order_item_id, fi.pick_status, fi.picked_quantity, fi.location_id, il.name as location_name,
             oi.product_name_snapshot, oi.sku_snapshot, oi.variant_snapshot, oi.quantity
      from fulfillment_items fi join order_items oi on oi.id = fi.order_item_id left join inventory_locations il on il.id = fi.location_id
      where oi.order_id = ${orderId} order by oi.created_at`),
    rows<Record<string, string | null>>(db, sql`select id, package_number, status, carrier, service, tracking_number, tracking_url, weight_grams, shipped_at, delivered_at from packages where order_id = ${orderId} order by package_number`),
    rows<Record<string, string | null>>(db, sql`
      select at, source, status, note, user_name from (
        select e.created_at as at, 'order' as source, e.status::text as status, e.note as note, u.name as user_name from order_events e left join users u on u.id = e.user_id where e.order_id = ${orderId}
        union all
        select e.created_at as at, 'fulfillment' as source, e.status::text as status, e.note as note, u.name as user_name from fulfillment_events e left join users u on u.id = e.user_id where e.order_id = ${orderId}
        union all
        select e.created_at as at, 'shipping' as source, e.status::text as status, e.note as note, u.name as user_name from shipping_events e left join users u on u.id = e.user_id join packages p on p.id = e.package_id where p.order_id = ${orderId}
        union all
        select e.created_at as at, 'return' as source, e.status::text as status, e.note as note, u.name as user_name from return_events e left join users u on u.id = e.user_id join return_requests r on r.id = e.return_request_id where r.order_id = ${orderId}
      ) x order by at, source`),
  ]);

  const packageIds = packagesRes.map((p) => p.id!);
  const packageItemsRes = packageIds.length ? await rows<Record<string, string | null>>(db, sql`
    select pi.package_id, pi.order_item_id, pi.quantity, oi.product_name_snapshot, oi.sku_snapshot
    from package_items pi join order_items oi on oi.id = pi.order_item_id where pi.package_id in (${sql.join(packageIds.map((id) => sql`${id}`), sql`,`)})`) : [];

  const picks: PickRow[] = items.map((i) => ({
    id: i.id!, orderItemId: i.order_item_id!, productName: i.product_name_snapshot!, sku: i.sku_snapshot!,
    variant: (i.variant_snapshot as unknown as { label?: string } | null)?.label ?? "", quantity: n(i.quantity),
    pickStatus: i.pick_status!, pickedQuantity: n(i.picked_quantity), locationId: i.location_id ?? null, locationName: i.location_name ?? null,
  }));
  const packagesOut: PackageRow[] = packagesRes.map((p) => ({
    id: p.id!, packageNumber: n(p.package_number), status: p.status!, carrier: p.carrier ?? null, service: p.service ?? null, trackingNumber: p.tracking_number ?? null, trackingUrl: p.tracking_url ?? null,
    weightGrams: p.weight_grams != null ? n(p.weight_grams) : null, shippedAt: p.shipped_at ? new Date(p.shipped_at) : null, deliveredAt: p.delivered_at ? new Date(p.delivered_at) : null,
    items: packageItemsRes.filter((pi) => pi.package_id === p.id).map((pi) => ({ orderItemId: pi.order_item_id!, productName: pi.product_name_snapshot!, sku: pi.sku_snapshot!, quantity: n(pi.quantity) })),
  }));
  const packedByItem = new Map<string, number>();
  for (const p of packagesOut) for (const it of p.items) packedByItem.set(it.orderItemId, (packedByItem.get(it.orderItemId) ?? 0) + it.quantity);

  return {
    picks, packages: packagesOut,
    unpackaged: picks.map((p) => ({ orderItemId: p.orderItemId, productName: p.productName, sku: p.sku, remaining: p.quantity - (packedByItem.get(p.orderItemId) ?? 0) })).filter((x) => x.remaining > 0),
    timeline: timeline.map((t) => ({ at: new Date(t.at!), source: t.source as TimelineRow["source"], status: t.status!, note: t.note, user: t.user_name })) as TimelineRow[],
  };
}

/** Order-level KPIs for the admin dashboard (brief §32): how many orders sit in each pre-ship stage right now. */
export async function fulfillmentKpis(db: DbOrTx) {
  const [row] = await rows<Record<string, string>>(db, sql`
    select
      count(*) filter (where fulfillment_status = 'processing') as processing,
      count(*) filter (where fulfillment_status = 'picking') as picking,
      count(*) filter (where fulfillment_status = 'packing') as packing,
      count(*) filter (where fulfillment_status = 'ready_to_ship') as ready_to_ship,
      count(*) filter (where fulfillment_status = 'partially_shipped') as partially_shipped
    from orders`);
  return { processing: n(row?.processing), picking: n(row?.picking), packing: n(row?.packing), readyToShip: n(row?.ready_to_ship), partiallyShipped: n(row?.partially_shipped) };
}

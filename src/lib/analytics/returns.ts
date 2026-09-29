/** Returns analytics (brief §34): return rate = returned orders ÷ completed orders × 100, dividing by
 *  zero only when there are zero completed orders — reported as null so the page can say "no data" rather
 *  than a meaningless 0% or division error. */
import "server-only";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import type { Range } from "./service";
import { n, rows } from "../admin/sql";

export type ReturnMetrics = {
  completedOrders: number; returnedOrders: number; returnRatePct: number | null;
  totalReturnItems: number; refundedCents: number;
  byReason: { reason: string; count: number }[];
  byDisposition: { disposition: string; count: number }[];
};

export async function getReturnMetrics(db: DbOrTx, r: Range): Promise<ReturnMetrics> {
  const [row] = await rows<Record<string, string | null>>(db, sql`
    with completed as (
      select o.id from orders o where o.paid_at >= ${r.from.toISOString()} and o.paid_at < ${r.to.toISOString()} and o.fulfillment_status in ('delivered', 'completed')
    )
    select
      (select count(*) from completed) as completed_orders,
      (select count(distinct rr.order_id) from return_requests rr join completed c on c.id = rr.order_id where rr.status <> 'rejected') as returned_orders,
      (select count(*) from return_items ri join return_requests rr on rr.id = ri.return_request_id join completed c on c.id = rr.order_id) as total_return_items,
      (select coalesce(sum(f.amount_cents), 0) from refunds f join return_requests rr on rr.id = f.return_request_id join completed c on c.id = rr.order_id) as refunded_cents`);

  const byReason = await rows<Record<string, string | null>>(db, sql`
    select ri.reason, count(*) as count from return_items ri join return_requests rr on rr.id = ri.return_request_id
    where rr.requested_at >= ${r.from.toISOString()} and rr.requested_at < ${r.to.toISOString()} group by ri.reason order by count(*) desc`);
  const byDisposition = await rows<Record<string, string | null>>(db, sql`
    select insp.disposition, count(*) as count from return_inspections insp join return_items ri on ri.id = insp.return_item_id join return_requests rr on rr.id = ri.return_request_id
    where rr.requested_at >= ${r.from.toISOString()} and rr.requested_at < ${r.to.toISOString()} group by insp.disposition order by count(*) desc`);

  const completedOrders = n(row?.completed_orders), returnedOrders = n(row?.returned_orders);
  return {
    completedOrders, returnedOrders, returnRatePct: completedOrders > 0 ? Math.round((returnedOrders / completedOrders) * 1000) / 10 : null,
    totalReturnItems: n(row?.total_return_items), refundedCents: n(row?.refunded_cents),
    byReason: byReason.map((x) => ({ reason: x.reason!, count: n(x.count) })), byDisposition: byDisposition.map((x) => ({ disposition: x.disposition!, count: n(x.count) })),
  };
}

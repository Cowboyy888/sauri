/**
 * Refund reporting (brief §11) — reads the existing `refunds` table and `orders.refund_total_cents`
 * (Phase 1/5's refund engine — `updateOrderStatus`/`lib/orders/refunds.ts#refundOrder`). Never writes a
 * refund record; this module is reporting-only.
 *
 * "Refunds by product/category" (brief §11): a refund in this schema is recorded at the order level, not
 * itemized per line. Since attributing a refund to specific products is still useful for reporting, the
 * amount is allocated pro rata across the order's line net-revenue shares — the same technique
 * `lib/orders/pricing.ts#allocateDiscount` already uses for splitting a discount across lines, applied here
 * for read-only reporting rather than a stored, authoritative figure. This is an estimate and is labeled as
 * such wherever it's shown.
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { n, rows } from "../admin/sql";
import type { Range } from "../analytics/service";

export type RefundListRow = {
  id: string; orderId: string; orderNumber: string; customerName: string; amountCents: number; reason: string | null;
  restocked: boolean; processedBy: string | null; createdAt: Date;
};
export async function listRefunds(db: DbOrTx, opts: { range?: Range; page: number; pageSize: number }): Promise<{ rows: RefundListRow[]; total: number }> {
  const where = opts.range ? sql`where r.created_at >= ${opts.range.from.toISOString()} and r.created_at < ${opts.range.to.toISOString()}` : sql``;
  const res = await rows<Record<string, string | null> & { restocked: boolean }>(db, sql`
    select r.id, o.id as order_id, o.order_number, c.name as customer_name, r.amount_cents, r.reason, r.restocked, u.name as processed_by, r.created_at, count(*) over () as total
    from refunds r join orders o on o.id = r.order_id join customers c on c.id = o.customer_id left join users u on u.id = r.user_id
    ${where} order by r.created_at desc limit ${opts.pageSize} offset ${(opts.page - 1) * opts.pageSize}`);
  return {
    total: n(res[0]?.total),
    rows: res.map((r) => ({
      id: r.id!, orderId: r.order_id!, orderNumber: r.order_number!, customerName: r.customer_name!, amountCents: n(r.amount_cents),
      reason: r.reason ?? null, restocked: r.restocked, processedBy: r.processed_by ?? null, createdAt: new Date(r.created_at!),
    })),
  };
}

export type RefundAnalytics = {
  totalRefundsCents: number; refundCount: number; refundRatePct: number | null;
  byReason: { reason: string; totalCents: number; count: number }[];
  byMonth: { month: string; totalCents: number }[];
  byProduct: { productName: string; totalCents: number }[];
  byCategory: { category: string; totalCents: number }[];
};
export async function getRefundAnalytics(db: DbOrTx, r: Range): Promise<RefundAnalytics> {
  const [totals] = await rows<{ total: string; count: string; orders: string }>(db, sql`
    with rec as (select id from orders where paid_at is not null and paid_at >= ${r.from.toISOString()} and paid_at < ${r.to.toISOString()})
    select coalesce((select sum(amount_cents) from refunds where order_id in (select id from rec)), 0) as total,
           (select count(*) from refunds where order_id in (select id from rec)) as count,
           (select count(*) from rec) as orders`);
  const byReason = await rows<{ reason: string | null; total: string; count: string }>(db, sql`
    select coalesce(reason, 'Not specified') as reason, sum(amount_cents) as total, count(*) as count from refunds
    where created_at >= ${r.from.toISOString()} and created_at < ${r.to.toISOString()} group by 1 order by total desc`);
  const byMonth = await rows<{ month: string; total: string }>(db, sql`
    select to_char(date_trunc('month', created_at), 'YYYY-MM') as month, sum(amount_cents) as total from refunds
    where created_at >= ${r.from.toISOString()} and created_at < ${r.to.toISOString()} group by 1 order by 1`);
  // Pro-rata allocation across each refunded order's line net-revenue shares (see file header).
  // Each refund row is paired with every line item of its own order and given its pro-rata share of that
  // refund (rf.amount_cents, not an order-level total) — correct even when an order has several refunds,
  // since summing per-refund shares equals the share of their combined total.
  const byLine = await rows<{ product_name: string; category: string; alloc: string }>(db, sql`
    select i.product_name_snapshot as product_name, c.name as category,
      sum(rf.amount_cents * i.line_total_cents::numeric / nullif(ord.line_total, 0)) as alloc
    from refunds rf
    join orders o on o.id = rf.order_id
    join order_items i on i.order_id = o.id
    join products p on p.id = i.product_id
    join categories c on c.id = p.category_id
    join (select order_id, sum(line_total_cents) as line_total from order_items group by order_id) ord on ord.order_id = o.id
    where rf.created_at >= ${r.from.toISOString()} and rf.created_at < ${r.to.toISOString()}
    group by i.product_name_snapshot, c.name order by alloc desc`);
  const byProductMap = new Map<string, number>(), byCategoryMap = new Map<string, number>();
  for (const x of byLine) {
    byProductMap.set(x.product_name, (byProductMap.get(x.product_name) ?? 0) + n(x.alloc));
    byCategoryMap.set(x.category, (byCategoryMap.get(x.category) ?? 0) + n(x.alloc));
  }
  const orders = n(totals?.orders);
  return {
    totalRefundsCents: n(totals?.total), refundCount: n(totals?.count), refundRatePct: orders ? Math.round((n(totals?.count) / orders) * 10_000) / 100 : null,
    byReason: byReason.map((x) => ({ reason: x.reason ?? "Not specified", totalCents: n(x.total), count: n(x.count) })),
    byMonth: byMonth.map((x) => ({ month: x.month, totalCents: n(x.total) })),
    byProduct: [...byProductMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([productName, totalCents]) => ({ productName, totalCents: Math.round(totalCents) })),
    byCategory: [...byCategoryMap.entries()].sort((a, b) => b[1] - a[1]).map(([category, totalCents]) => ({ category, totalCents: Math.round(totalCents) })),
  };
}

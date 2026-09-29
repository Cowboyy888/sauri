/** Read-side queries for /admin/returns and /admin/returns/[id] (brief §27-28). Writes go through
 *  `lib/returns/service.ts` — this file only reads. */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { like, n, orderBy, rows, type Page } from "./sql";
import type { Range } from "../analytics/service";

export type ReturnListRow = {
  id: string; orderId: string; orderNumber: string; customer: string; email: string; status: string; itemCount: number; requestedAt: Date;
};

export async function listReturns(db: DbOrTx, o: { q?: string; status?: string; range?: Range; sort?: string; dir?: string; page: number; pageSize: number }): Promise<Page<ReturnListRow>> {
  const q = o.q?.trim();
  const res = await rows<Record<string, string | null>>(db, sql`
    select r.id, r.order_id, o.order_number, c.name as customer, c.email, r.status, r.requested_at,
           (select coalesce(sum(ri.quantity),0) from return_items ri where ri.return_request_id = r.id) as item_count, count(*) over () as total
    from return_requests r join orders o on o.id = r.order_id join customers c on c.id = r.customer_id
    where true
      ${q ? sql`and (o.order_number ilike ${like(q)} or c.name ilike ${like(q)} or c.email ilike ${like(q)})` : sql``}
      ${o.status ? sql`and r.status = ${o.status}` : sql``}
      ${o.range ? sql`and r.requested_at >= ${o.range.from.toISOString()} and r.requested_at < ${o.range.to.toISOString()}` : sql``}
    order by ${orderBy(o.sort, { date: "r.requested_at", customer: "c.name", status: "r.status" }, "date", o.dir)}
    limit ${o.pageSize} offset ${(o.page - 1) * o.pageSize}`);
  return {
    total: n(res[0]?.total), page: o.page, pageSize: o.pageSize,
    rows: res.map((x) => ({ id: x.id!, orderId: x.order_id!, orderNumber: x.order_number!, customer: x.customer!, email: x.email!, status: x.status!, itemCount: n(x.item_count), requestedAt: new Date(x.requested_at!) })),
  };
}

export async function getReturnDetail(db: DbOrTx, id: string) {
  const [meta] = await rows<Record<string, string | null>>(db, sql`
    select r.id, r.status, r.customer_notes, r.internal_notes, r.return_shipping_cost_cents, r.return_shipping_paid_by, r.return_tracking_number, r.return_carrier, r.requested_at,
           o.id as order_id, o.order_number, o.fulfillment_status, o.status as order_status, c.id as customer_id, c.name as customer, c.email
    from return_requests r join orders o on o.id = r.order_id join customers c on c.id = r.customer_id where r.id = ${id}`);
  if (!meta) return null;

  const [items, events, refunds] = await Promise.all([
    rows<Record<string, string | null>>(db, sql`
      select ri.id, ri.order_item_id, ri.quantity, ri.reason, ri.description, ri.photo_urls, ri.exchange_requested, ri.refund_amount_cents,
             oi.product_name_snapshot, oi.sku_snapshot, oi.variant_snapshot, oi.unit_price_cents, oi.line_total_cents, oi.quantity as ordered_quantity,
             insp.condition, insp.disposition, insp.notes as inspection_notes, insp.inspected_at, u.name as inspected_by
      from return_items ri join order_items oi on oi.id = ri.order_item_id
      left join return_inspections insp on insp.return_item_id = ri.id left join users u on u.id = insp.inspected_by_user_id
      where ri.return_request_id = ${id} order by ri.created_at`),
    rows<Record<string, string | null>>(db, sql`select e.status, e.note, e.created_at, u.name as user_name from return_events e left join users u on u.id = e.user_id where e.return_request_id = ${id} order by e.created_at, e.id`),
    rows<Record<string, string | null>>(db, sql`select amount_cents, reason, created_at from refunds where return_request_id = ${id} order by created_at`),
  ]);

  return {
    id: meta.id!, status: meta.status!, customerNotes: meta.customer_notes, internalNotes: meta.internal_notes,
    returnShippingCostCents: n(meta.return_shipping_cost_cents), returnShippingPaidBy: meta.return_shipping_paid_by!,
    returnTrackingNumber: meta.return_tracking_number ?? null, returnCarrier: meta.return_carrier ?? null, requestedAt: new Date(meta.requested_at!),
    order: { id: meta.order_id!, orderNumber: meta.order_number!, fulfillmentStatus: meta.fulfillment_status!, status: meta.order_status! },
    customer: { id: meta.customer_id!, name: meta.customer!, email: meta.email! },
    items: items.map((i) => ({
      id: i.id!, orderItemId: i.order_item_id!, quantity: n(i.quantity), reason: i.reason!, description: i.description,
      photoUrls: (i.photo_urls as unknown as string[] | null) ?? [], exchangeRequested: String(i.exchange_requested) === "true", refundAmountCents: i.refund_amount_cents != null ? n(i.refund_amount_cents) : null,
      productName: i.product_name_snapshot!, sku: i.sku_snapshot!, variant: (i.variant_snapshot as unknown as { label?: string } | null)?.label ?? "",
      unitPriceCents: n(i.unit_price_cents), lineTotalCents: n(i.line_total_cents), orderedQuantity: n(i.ordered_quantity),
      inspection: i.condition ? { condition: i.condition, disposition: i.disposition!, notes: i.inspection_notes, inspectedAt: new Date(i.inspected_at!), inspectedBy: i.inspected_by } : null,
    })),
    events: events.map((e) => ({ status: e.status!, note: e.note, at: new Date(e.created_at!), user: e.user_name })),
    refunds: refunds.map((r) => ({ amountCents: n(r.amount_cents), reason: r.reason, at: new Date(r.created_at!) })),
  };
}

export async function listReturnsForOrder(db: DbOrTx, orderId: string) {
  return rows<{ id: string; status: string; requested_at: string }>(db, sql`select id, status, requested_at from return_requests where order_id = ${orderId} order by requested_at desc`)
    .then((res) => res.map((r) => ({ id: r.id, status: r.status, requestedAt: new Date(r.requested_at) })));
}

export async function returnKpis(db: DbOrTx) {
  const [row] = await rows<Record<string, string>>(db, sql`
    select count(*) filter (where status = 'requested') as requested, count(*) filter (where status = 'under_review') as under_review,
           count(*) filter (where status = 'return_shipped') as return_shipped, count(*) filter (where status = 'received') as received,
           count(*) filter (where status = 'inspecting') as inspecting
    from return_requests`);
  return { requested: n(row?.requested), underReview: n(row?.under_review), returnShipped: n(row?.return_shipped), received: n(row?.received), inspecting: n(row?.inspecting) };
}

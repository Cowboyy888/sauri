import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { orders } from "../db/schema";
import type { Range } from "../analytics/service";
import { like, n, orderBy, rows, variantImage, type Page } from "./sql";

export type OrderListRow = {
  id: string; orderNumber: string; customerId: string; customer: string; email: string; placedAt: Date; channel: string; channelCode: string;
  items: number; paymentStatus: string; status: string; fulfillmentStatus: string; totalCents: number; grossProfitCents: number; grossMargin: number;
};

export async function listOrders(db: DbOrTx, o: { q?: string; status?: string; paymentStatus?: string; fulfillmentStatus?: string; channel?: string; customerId?: string; range?: Range; sort?: string; dir?: string; page: number; pageSize: number }): Promise<Page<OrderListRow>> {
  const q = o.q?.trim();
  const res = await rows<Record<string, string | null>>(db, sql`
    select o.id, o.order_number, o.customer_id, c.name as customer, c.email, o.placed_at, sc.name as channel, sc.code as channel_code,
           (select coalesce(sum(i.quantity),0) from order_items i where i.order_id = o.id) as items,
           o.payment_status, o.status, o.fulfillment_status, o.total_cents, o.gross_profit_cents, o.gross_margin, count(*) over () as total
    from orders o join customers c on c.id = o.customer_id join sales_channels sc on sc.id = o.channel_id
    where true
      ${q ? sql`and (o.order_number ilike ${like(q)} or c.name ilike ${like(q)} or c.email ilike ${like(q)})` : sql``}
      ${o.status ? sql`and o.status = ${o.status}` : sql``}
      ${o.paymentStatus ? sql`and o.payment_status = ${o.paymentStatus}` : sql``}
      ${o.fulfillmentStatus ? sql`and o.fulfillment_status = ${o.fulfillmentStatus}` : sql``}
      ${o.channel ? sql`and sc.code = ${o.channel}` : sql``}
      ${o.customerId ? sql`and o.customer_id = ${o.customerId}` : sql``}
      ${o.range ? sql`and o.placed_at >= ${o.range.from.toISOString()} and o.placed_at < ${o.range.to.toISOString()}` : sql``}
    order by ${orderBy(o.sort, { date: "o.placed_at", total: "o.total_cents", profit: "o.gross_profit_cents", number: "o.order_number", customer: "c.name" }, "date", o.dir)}, o.order_number desc
    limit ${o.pageSize} offset ${(o.page - 1) * o.pageSize}`);
  return {
    total: n(res[0]?.total), page: o.page, pageSize: o.pageSize,
    rows: res.map((x) => ({
      id: x.id!, orderNumber: x.order_number!, customerId: x.customer_id!, customer: x.customer!, email: x.email!, placedAt: new Date(x.placed_at!), channel: x.channel!, channelCode: x.channel_code!,
      items: n(x.items), paymentStatus: x.payment_status!, status: x.status!, fulfillmentStatus: x.fulfillment_status!, totalCents: n(x.total_cents), grossProfitCents: n(x.gross_profit_cents), grossMargin: n(x.gross_margin),
    })),
  };
}

export async function getOrder(db: DbOrTx, id: string) {
  const [o] = await db.select().from(orders).where(eq(orders.id, id));
  if (!o) return null;
  const [meta, items, events, payments, refunds, movements] = await Promise.all([
    rows<Record<string, string>>(db, sql`select c.id as customer_id, c.name, c.email, c.phone, sc.name as channel, sc.code as channel_code, cs.total_orders, cs.total_spent_cents, sm.name as shipping_method_name
      from customers c join sales_channels sc on sc.id = ${o.channelId} join customer_stats cs on cs.customer_id = c.id
      left join shipping_methods sm on sm.id = ${o.shippingMethodId ?? null}
      where c.id = ${o.customerId}`),
    rows<Record<string, unknown>>(db, sql`select i.*, v.material, ${variantImage("i.product_id", "v.material")} as image from order_items i join product_variants v on v.id = i.variant_id where i.order_id = ${id} order by i.created_at, i.sku_snapshot`),
    rows<Record<string, string | null>>(db, sql`select e.status, e.note, e.created_at, u.name as user_name from order_events e left join users u on u.id = e.user_id where e.order_id = ${id} order by e.created_at, e.id`),
    rows<Record<string, string | null>>(db, sql`select provider, provider_ref, status, amount_cents, fee_cents, created_at from payments where order_id = ${id} order by created_at`),
    rows<Record<string, string | null>>(db, sql`select r.amount_cents, r.reason, r.restocked, r.created_at, u.name as user_name from refunds r left join users u on u.id = r.user_id where r.order_id = ${id} order by r.created_at`),
    rows<Record<string, string | null>>(db, sql`select m.id, m.created_at, m.movement_type, m.quantity, m.stock_before, m.stock_after, m.notes, v.sku, u.name as user_name
      from inventory_movements m join product_variants v on v.id = m.variant_id left join users u on u.id = m.user_id where m.order_id = ${id} order by m.created_at, m.id`),
  ]);
  const c = meta[0]!;
  return {
    order: o,
    customer: { id: c.customer_id!, name: c.name!, email: c.email!, phone: c.phone ?? null, totalOrders: n(c.total_orders), totalSpentCents: n(c.total_spent_cents) },
    channel: { name: c.channel!, code: c.channel_code! },
    shippingMethodName: c.shipping_method_name ?? null,
    items: items.map((i) => ({
      id: String(i.id), productId: String(i.product_id), variantId: String(i.variant_id), name: String(i.product_name_snapshot), sku: String(i.sku_snapshot),
      variant: (i.variant_snapshot as { label: string }).label, image: (i.image as string | null) ?? null, quantity: n(i.quantity),
      unitPriceCents: n(i.unit_price_cents), unitCostCents: n(i.unit_cost_cents), discountCents: n(i.discount_cents), lineTotalCents: n(i.line_total_cents),
      lineCostCents: n(i.line_cost_cents), lineProfitCents: n(i.line_profit_cents), personalization: (i.personalization as { initial?: string; engraving?: string } | null) ?? null,
    })),
    events: events.map((e) => ({ status: e.status!, note: e.note, at: new Date(e.created_at!), user: e.user_name })),
    payments: payments.map((p) => ({ provider: p.provider!, ref: p.provider_ref, status: p.status!, amountCents: n(p.amount_cents), feeCents: n(p.fee_cents), at: new Date(p.created_at!) })),
    refunds: refunds.map((r) => ({ amountCents: n(r.amount_cents), reason: r.reason, restocked: String(r.restocked) === "true", at: new Date(r.created_at!), user: r.user_name })),
    movements: movements.map((m) => ({ id: n(m.id), at: new Date(m.created_at!), type: m.movement_type!, quantity: n(m.quantity), before: n(m.stock_before), after: n(m.stock_after), notes: m.notes, sku: m.sku!, user: m.user_name ?? "System" })),
  };
}

export async function listChannels(db: DbOrTx) {
  return rows<{ code: string; name: string }>(db, sql`select code, name from sales_channels where active order by name`);
}

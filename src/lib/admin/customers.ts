import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { like, n, orderBy, productImage, rows, type Page } from "./sql";
import { getCrmSettings, getCustomerRFM, getCustomerSegments, segmentWhere, type SegmentKey } from "../crm/segments";
import { getCustomerTags, getConsentHistory, listCommunications, listNotes } from "../crm/customer-management";
import { getLoyaltySummary } from "../loyalty/service";

export type CustomerListRow = {
  id: string; name: string; email: string; phone: string | null; orders: number; revenueCents: number; profitCents: number; averageOrderCents: number;
  lastOrderAt: Date | null; customerSince: Date; acquisitionSource: string | null;
};

export async function listCustomers(db: DbOrTx, o: { q?: string; segment?: SegmentKey; sort?: string; dir?: string; page: number; pageSize: number }): Promise<Page<CustomerListRow>> {
  const q = o.q?.trim();
  const cfg = await getCrmSettings(db);
  const segmentCond = o.segment ? segmentWhere(o.segment, cfg) : sql`true`;
  const res = await rows<Record<string, string | null>>(db, sql`
    select s.*, c.phone, c.first_touch_source, count(*) over () as total from customer_stats s
    join customers c on c.id = s.customer_id
    where c.merged_into_customer_id is null and (${segmentCond})
      ${q ? sql`and (s.name ilike ${like(q)} or s.email ilike ${like(q)} or c.phone ilike ${like(q)})` : sql``}
    order by ${orderBy(o.sort, { revenue: "s.total_spent_cents", orders: "s.total_orders", profit: "s.gross_profit_cents", aov: "s.average_order_value_cents", last: "s.last_order_at", since: "s.customer_since", name: "s.name" }, "revenue", o.dir ?? (o.sort === "name" ? "asc" : "desc"))}, s.name
    limit ${o.pageSize} offset ${(o.page - 1) * o.pageSize}`);
  return {
    total: n(res[0]?.total), page: o.page, pageSize: o.pageSize,
    rows: res.map((x) => ({
      id: x.customer_id!, name: x.name!, email: x.email!, phone: x.phone ?? null, orders: n(x.total_orders), revenueCents: n(x.total_spent_cents), profitCents: n(x.gross_profit_cents),
      averageOrderCents: n(x.average_order_value_cents), lastOrderAt: x.last_order_at ? new Date(x.last_order_at) : null, customerSince: new Date(x.customer_since!), acquisitionSource: x.first_touch_source ?? null,
    })),
  };
}

/** Every distinct material/size seen across a customer's order lines (brief §3 "product behavior"),
 *  read from the variant snapshot already stored on each order_item — no new column needed. */
async function productAffinity(db: DbOrTx, id: string) {
  return rows<{ material: string | null; size: string | null; units: string }>(db, sql`
    select i.variant_snapshot->>'material' as material, i.variant_snapshot->>'size' as size, sum(i.quantity) as units
    from order_items i join orders o on o.id = i.order_id where o.customer_id = ${id} and o.paid_at is not null and o.refund_total_cents = 0
    group by i.variant_snapshot->>'material', i.variant_snapshot->>'size'`);
}

export async function getCustomer(db: DbOrTx, id: string) {
  const [stats] = await rows<Record<string, string | null>>(db, sql`select * from customer_stats where customer_id = ${id}`);
  if (!stats) return null;
  const [cust, favorites, affinity, recent, wishlist, addresses, orderHistory, tags, notes, communications, consents, rfm, segments, loyalty, refundTotals] = await Promise.all([
    rows<Record<string, string | null>>(db, sql`select phone, marketing_opt_in, sms_marketing_consent, user_id, first_touch_source, last_touch_source, first_visit_at, anonymized_at, merged_into_customer_id from customers where id = ${id}`),
    rows<Record<string, string>>(db, sql`
      select c.name as category, sum(i.quantity) as units, sum(i.line_total_cents) as rev
      from order_items i join orders o on o.id = i.order_id join products p on p.id = i.product_id join categories c on c.id = p.category_id
      where o.customer_id = ${id} and o.paid_at is not null and o.refund_total_cents = 0 group by c.name order by units desc, rev desc`),
    productAffinity(db, id),
    rows<Record<string, string | null>>(db, sql`
      select distinct on (i.product_id) i.product_id, i.product_name_snapshot as name, i.sku_snapshot as sku, o.placed_at, ${productImage("i.product_id")} as image
      from order_items i join orders o on o.id = i.order_id where o.customer_id = ${id} order by i.product_id, o.placed_at desc`),
    rows<Record<string, string | null>>(db, sql`select p.id, p.name, ${productImage("p.id")} as image, w.created_at from wishlists w join products p on p.id = w.product_id where w.customer_id = ${id} order by w.created_at desc`),
    rows<Record<string, string | null>>(db, sql`select type, first_name, last_name, line1, line2, city, postal_code, country, is_default from customer_addresses where customer_id = ${id} order by is_default desc`),
    rows<Record<string, string | null>>(db, sql`
      select o.id, o.order_number, o.placed_at, o.status, o.payment_status, o.fulfillment_status, o.total_cents,
        (select coalesce(sum(quantity),0) from order_items where order_id = o.id) as items,
        (select r.status from return_requests r where r.order_id = o.id order by r.requested_at desc limit 1) as return_status
      from orders o where o.customer_id = ${id} order by o.placed_at desc limit 50`),
    getCustomerTags(db, id),
    listNotes(db, id),
    listCommunications(db, id),
    getConsentHistory(db, id),
    getCustomerRFM(db, id),
    getCustomerSegments(db, id),
    getLoyaltySummary(db, id),
    rows<{ refunded: string; gross: string }>(db, sql`select coalesce(sum(refund_total_cents),0) as refunded, coalesce(sum(subtotal_cents - discount_total_cents),0) as gross from orders where customer_id = ${id} and paid_at is not null and status <> 'cancelled'`),
  ]);
  const c = cust[0]!;
  const totalUnits = favorites.reduce((a, f) => a + n(f.units), 0);
  const itemsPerOrder = n(stats.total_orders) > 0 ? Math.round((totalUnits / n(stats.total_orders)) * 10) / 10 : 0;
  const grossRevenueCents = n(refundTotals[0]?.gross), totalRefundedCents = n(refundTotals[0]?.refunded);
  return {
    id, name: stats.name!, email: stats.email!, phone: c.phone ?? null, marketingOptIn: String(c.marketing_opt_in) === "true", smsConsent: String(c.sms_marketing_consent) === "true",
    registered: !!c.user_id, firstTouchSource: c.first_touch_source, lastTouchSource: c.last_touch_source, firstVisitAt: c.first_visit_at ? new Date(c.first_visit_at) : null,
    anonymized: !!c.anonymized_at, mergedInto: c.merged_into_customer_id,
    customerSince: new Date(stats.customer_since!), totalOrders: n(stats.total_orders), totalSpentCents: n(stats.total_spent_cents), grossProfitCents: n(stats.gross_profit_cents),
    averageOrderValueCents: n(stats.average_order_value_cents), lifetimeValueCents: n(stats.total_spent_cents), itemsPerOrder,
    grossRevenueCents, totalRefundedCents, netSpendCents: n(stats.total_spent_cents),
    firstOrderAt: stats.first_order_at ? new Date(stats.first_order_at) : null, lastOrderAt: stats.last_order_at ? new Date(stats.last_order_at) : null,
    favoriteCategories: favorites.map((f) => ({ category: f.category!, units: n(f.units), revenueCents: n(f.rev) })),
    favoriteMaterials: aggregateBy(affinity, "material"), favoriteSizes: aggregateBy(affinity, "size"),
    recentProducts: recent.sort((a, b) => +new Date(b.placed_at!) - +new Date(a.placed_at!)).slice(0, 6).map((r) => ({ productId: r.product_id!, name: r.name!, sku: r.sku!, at: new Date(r.placed_at!), image: r.image ?? null })),
    wishlist: wishlist.map((w) => ({ productId: w.id!, name: w.name!, image: w.image ?? null, at: new Date(w.created_at!) })),
    addresses: addresses.map((a) => ({ type: a.type!, name: `${a.first_name} ${a.last_name}`, lines: [a.line1, a.line2, `${a.city} ${a.postal_code}`, a.country].filter(Boolean) as string[], isDefault: String(a.is_default) === "true" })),
    orders: orderHistory.map((o) => ({ id: o.id!, orderNumber: o.order_number!, placedAt: new Date(o.placed_at!), status: o.status!, paymentStatus: o.payment_status!, fulfillmentStatus: o.fulfillment_status!, totalCents: n(o.total_cents), items: n(o.items), returnStatus: o.return_status })),
    tags, notes, communications, consents, rfm, segments, loyalty,
  };
}
function aggregateBy(rows: { material: string | null; size: string | null; units: string }[], key: "material" | "size") {
  const totals = new Map<string, number>();
  for (const r of rows) { const v = r[key]; if (v) totals.set(v, (totals.get(v) ?? 0) + n(r.units)); }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([value, units]) => ({ value, units }));
}

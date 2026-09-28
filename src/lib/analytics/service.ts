/**
 * Server-side analytics. Aggregation runs in Postgres; nothing financial is computed in the browser.
 * Definitions (docs/ANALYTICS.md), used identically on screen, in exports and in tests:
 *
 *   recognized order   = an order that was paid (paid_at set), bucketed by paid_at in the store time zone
 *   revenue            = Σ line totals               = Σ (subtotal − discount_total)
 *   net revenue        = revenue − refunds
 *   COGS               = Σ cost_total                (goods returned to stock are no longer a cost)
 *   gross profit       = net revenue − COGS          = Σ gross_profit
 *   gross margin %     = gross profit ÷ net revenue × 100
 *   average order value= net revenue ÷ orders
 *   contribution profit= gross profit − payment fees − carrier costs   (reported separately)
 * Tax and shipping charged to customers are pass-through and are not revenue.
 */
import { sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { STORE } from "../config";
import { stockStatus, type StockStatus } from "../inventory/service";

export type Range = { from: Date; to: Date }; // `to` is exclusive
export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "90d" | "ytd" | "all" | "custom";

const n = (v: unknown) => Number(v ?? 0);
const round2 = (v: number) => Math.round(v * 100) / 100;
const pctOf = (a: number, b: number) => (b ? round2((a / b) * 100) : 0);
const RECOGNIZED = sql.raw(`o.paid_at is not null`);
const NOT_REFUNDED = sql.raw(`o.refund_total_cents = 0`);
const inRange = (r: Range) => sql`o.paid_at >= ${r.from.toISOString()} and o.paid_at < ${r.to.toISOString()}`;
async function rows<T>(db: DbOrTx, q: SQL): Promise<T[]> { return (await db.execute(q)).rows as T[]; }

/** Named ranges resolved in the business time zone (STORE_TIMEZONE), never the browser's. */
export async function resolveRange(db: DbOrTx, key: RangeKey, custom?: { from: string; to: string }): Promise<Range & { key: RangeKey; previous: Range }> {
  const tz = STORE.timezone;
  const [b] = await rows<{ sod: Date; now: Date; soy: Date; first: Date | null }>(db, sql`
    select (date_trunc('day', now() at time zone ${tz}) at time zone ${tz}) as sod, now() as now,
           (date_trunc('year', now() at time zone ${tz}) at time zone ${tz}) as soy, (select min(paid_at) from orders) as first`);
  const sod = new Date(b!.sod), now = new Date(b!.now), day = 86_400_000;
  let from: Date, to = now;
  switch (key) {
    case "today": from = sod; break;
    case "yesterday": from = new Date(sod.getTime() - day); to = sod; break;
    case "7d": from = new Date(sod.getTime() - 6 * day); break;
    case "30d": from = new Date(sod.getTime() - 29 * day); break;
    case "90d": from = new Date(sod.getTime() - 89 * day); break;
    case "ytd": from = new Date(b!.soy); break;
    case "all": from = b!.first ? new Date(b!.first) : sod; break;
    case "custom": {
      if (!custom || !/^\d{4}-\d{2}-\d{2}$/.test(custom.from) || !/^\d{4}-\d{2}-\d{2}$/.test(custom.to)) throw new Error("Custom range needs from and to dates (YYYY-MM-DD).");
      const [c] = await rows<{ f: Date; t: Date }>(db, sql`select (${custom.from}::date::timestamp at time zone ${tz}) as f, ((${custom.to}::date + 1)::timestamp at time zone ${tz}) as t`);
      from = new Date(c!.f); to = new Date(Math.min(new Date(c!.t).getTime(), now.getTime()));
      if (to <= from) throw new Error("The end date must be on or after the start date.");
      break;
    }
  }
  const len = to.getTime() - from.getTime();
  // "Today so far" compares with yesterday up to the same time of day.
  const previous = key === "today" ? { from: new Date(sod.getTime() - day), to: new Date(now.getTime() - day) } : { from: new Date(from.getTime() - len), to: from };
  return { key, from, to, previous };
}

export type Metrics = {
  orders: number; units: number; customers: number; newCustomers: number;
  grossSalesCents: number; discountCents: number; revenueCents: number; refundCents: number; netRevenueCents: number;
  cogsCents: number; grossProfitCents: number; grossMarginPct: number; averageOrderValueCents: number;
  paymentFeeCents: number; shippingCostCents: number; contributionProfitCents: number;
};

/** Every headline KPI in one round trip. */
export async function getMetrics(db: DbOrTx, r: Range): Promise<Metrics> {
  const [m] = await rows<Record<string, string>>(db, sql`
    with rec as (select o.* from orders o where ${RECOGNIZED} and ${inRange(r)}),
    firsts as (select customer_id, min(o.paid_at) as f from orders o where ${RECOGNIZED} group by customer_id)
    select count(*) as orders, coalesce(sum(subtotal_cents),0) as gross, coalesce(sum(discount_total_cents),0) as disc,
           coalesce(sum(refund_total_cents),0) as ref, coalesce(sum(cost_total_cents),0) as cogs, coalesce(sum(gross_profit_cents),0) as gp,
           coalesce(sum(payment_fee_cents),0) as fees, coalesce(sum(shipping_cost_cents),0) as ship, count(distinct customer_id) as customers,
           (select coalesce(sum(i.quantity),0) from order_items i join rec o on o.id = i.order_id where ${NOT_REFUNDED}) as units,
           (select count(*) from firsts where f >= ${r.from.toISOString()} and f < ${r.to.toISOString()}) as new_customers
    from rec`);
  const orders = n(m!.orders), gross = n(m!.gross), disc = n(m!.disc), ref = n(m!.ref), cogs = n(m!.cogs), gp = n(m!.gp), fees = n(m!.fees), ship = n(m!.ship);
  const revenue = gross - disc, net = revenue - ref;
  return {
    orders, units: n(m!.units), customers: n(m!.customers), newCustomers: n(m!.new_customers),
    grossSalesCents: gross, discountCents: disc, revenueCents: revenue, refundCents: ref, netRevenueCents: net,
    cogsCents: cogs, grossProfitCents: gp, grossMarginPct: pctOf(gp, net), averageOrderValueCents: orders ? Math.round(net / orders) : 0,
    paymentFeeCents: fees, shippingCostCents: ship, contributionProfitCents: gp - fees - ship,
  };
}

export type SeriesPoint = { bucket: string; netRevenueCents: number; grossProfitCents: number; orders: number; units: number };
export async function getSeries(db: DbOrTx, r: Range, unit?: "hour" | "day" | "week" | "month"): Promise<{ unit: string; points: SeriesPoint[] }> {
  const span = r.to.getTime() - r.from.getTime();
  const u = unit ?? (span <= 1.5 * 86_400_000 ? "hour" : span <= 95 * 86_400_000 ? "day" : span <= 400 * 86_400_000 ? "week" : "month");
  const tz = STORE.timezone, uu = sql.raw(`'${u}'`), step = sql.raw(`'1 ${u}'::interval`);
  const pts = await rows<Record<string, string>>(db, sql`
    with b as (select generate_series(date_trunc(${uu}, ${r.from.toISOString()}::timestamptz at time zone ${tz}),
                                      date_trunc(${uu}, (${r.to.toISOString()}::timestamptz - interval '1 microsecond') at time zone ${tz}), ${step}) as bucket),
    o as (select date_trunc(${uu}, o.paid_at at time zone ${tz}) as bucket, o.*,
                 case when ${NOT_REFUNDED} then (select coalesce(sum(i.quantity),0) from order_items i where i.order_id = o.id) else 0 end as units
          from orders o where ${RECOGNIZED} and ${inRange(r)})
    select to_char(b.bucket, 'YYYY-MM-DD"T"HH24:MI') as bucket, count(o.id) as orders, coalesce(sum(o.units),0) as units,
           coalesce(sum(o.subtotal_cents - o.discount_total_cents - o.refund_total_cents),0) as net, coalesce(sum(o.gross_profit_cents),0) as gp
    from b left join o on o.bucket = b.bucket group by b.bucket order by b.bucket`);
  return { unit: u, points: pts.map((p) => ({ bucket: p.bucket!, orders: n(p.orders), units: n(p.units), netRevenueCents: n(p.net), grossProfitCents: n(p.gp) })) };
}

export type GroupRow = { key: string; label: string; netRevenueCents: number; cogsCents: number; grossProfitCents: number; grossMarginPct: number; units: number; orders: number; shareOfRevenuePct: number };
const GROUP = {
  product: [sql.raw(`i.product_id::text`), sql.raw(`max(i.product_name_snapshot)`)],
  category: [sql.raw(`c.slug`), sql.raw(`max(c.name)`)],
  material: [sql.raw(`i.variant_snapshot->>'material'`), sql.raw(`i.variant_snapshot->>'material'`)],
  sku: [sql.raw(`i.sku_snapshot`), sql.raw(`max(i.product_name_snapshot || ' / ' || (i.variant_snapshot->>'label'))`)],
} as const;
const MATERIAL: Record<string, string> = { yg: "14K Yellow Gold", wg: "14K White Gold", vm: "18K Gold Vermeil", ss: "Sterling Silver" };

function withShare(list: Omit<GroupRow, "shareOfRevenuePct">[]): GroupRow[] {
  const tot = list.reduce((a, x) => a + x.netRevenueCents, 0);
  return list.map((x) => ({ ...x, shareOfRevenuePct: pctOf(x.netRevenueCents, tot) }));
}

/** Line-level sales from order-item snapshots (so renamed products still report correctly). Fully refunded orders are excluded. */
export async function getSalesBy(db: DbOrTx, r: Range, by: keyof typeof GROUP): Promise<GroupRow[]> {
  const [key, label] = GROUP[by];
  const res = await rows<Record<string, string>>(db, sql`
    select ${key} as key, ${label} as label, sum(i.line_total_cents) as rev, sum(i.line_cost_cents) as cost, sum(i.line_profit_cents) as gp,
           sum(i.quantity) as units, count(distinct o.id) as orders
    from order_items i join orders o on o.id = i.order_id join products p on p.id = i.product_id join categories c on c.id = p.category_id
    where ${RECOGNIZED} and ${NOT_REFUNDED} and ${inRange(r)}
    group by ${key} order by rev desc`);
  return withShare(res.map((x) => ({ key: x.key!, label: by === "material" ? MATERIAL[x.label!] ?? x.label! : x.label!, netRevenueCents: n(x.rev), cogsCents: n(x.cost), grossProfitCents: n(x.gp), grossMarginPct: pctOf(n(x.gp), n(x.rev)), units: n(x.units), orders: n(x.orders) })));
}

export async function getSalesByChannel(db: DbOrTx, r: Range): Promise<GroupRow[]> {
  const res = await rows<Record<string, string>>(db, sql`
    select sc.code as key, max(sc.name) as label, sum(o.subtotal_cents - o.discount_total_cents - o.refund_total_cents) as rev,
           sum(o.cost_total_cents) as cost, sum(o.gross_profit_cents) as gp, count(*) as orders,
           sum(case when ${NOT_REFUNDED} then (select coalesce(sum(i.quantity),0) from order_items i where i.order_id = o.id) else 0 end) as units
    from orders o join sales_channels sc on sc.id = o.channel_id where ${RECOGNIZED} and ${inRange(r)}
    group by sc.code order by rev desc`);
  return withShare(res.map((x) => ({ key: x.key!, label: x.label!, netRevenueCents: n(x.rev), cogsCents: n(x.cost), grossProfitCents: n(x.gp), grossMarginPct: pctOf(n(x.gp), n(x.rev)), units: n(x.units), orders: n(x.orders) })));
}

export type InventoryRow = {
  variantId: string; sku: string; barcode: string | null; productId: string; productName: string; category: string; label: string;
  costPriceCents: number; sellingPriceCents: number; stockQuantity: number; reservedQuantity: number; availableStock: number; reorderLevel: number;
  status: StockStatus; inventoryValueCents: number; sold7: number; sold30: number;
  /** Estimates. Label them as such in the UI. */
  forecast: { avgDailySales: number; estimatedDaysRemaining: number | null; suggestedReorderQuantity: number };
};

export async function getInventory(db: DbOrTx, opts: { coverDays?: number; onlyAttention?: boolean } = {}): Promise<InventoryRow[]> {
  const cover = opts.coverDays ?? 45;
  const res = await rows<Record<string, string | null>>(db, sql`
    with sold as (
      select i.variant_id, sum(i.quantity) filter (where o.paid_at >= now() - interval '7 days') as s7, sum(i.quantity) as s30
      from order_items i join orders o on o.id = i.order_id
      where ${RECOGNIZED} and ${NOT_REFUNDED} and o.paid_at >= now() - interval '30 days' group by i.variant_id)
    select s.*, coalesce(sold.s7,0) as s7, coalesce(sold.s30,0) as s30
    from variant_stock s left join sold on sold.variant_id = s.variant_id
    where s.product_status <> 'archived' ${opts.onlyAttention ? sql`and s.stock_status <> 'IN_STOCK'` : sql``}
    order by s.product_name, s.sku`);
  return res.map((x) => {
    const avail = n(x.available_stock), reorder = n(x.reorder_level), s30 = n(x.s30), avg = s30 / 30;
    return {
      variantId: x.variant_id!, sku: x.sku!, barcode: x.barcode ?? null, productId: x.product_id!, productName: x.product_name!, category: x.category_name!, label: x.variant_label!,
      costPriceCents: n(x.cost_price_cents), sellingPriceCents: n(x.selling_price_cents), stockQuantity: n(x.stock_quantity), reservedQuantity: n(x.reserved_quantity),
      availableStock: avail, reorderLevel: reorder, status: stockStatus(avail, reorder), inventoryValueCents: n(x.inventory_value_cents), sold7: n(x.s7), sold30: s30,
      forecast: { avgDailySales: round2(avg), estimatedDaysRemaining: avg ? Math.floor(avail / avg) : null, suggestedReorderQuantity: avg ? Math.max(0, Math.ceil((avg * cover + reorder - avail) / 5) * 5) : 0 },
    };
  });
}

export type CustomerStat = { customerId: string; name: string; email: string; totalOrders: number; totalSpentCents: number; grossProfitCents: number; averageOrderValueCents: number; firstOrderAt: Date | null; lastOrderAt: Date | null; customerLifetimeValueCents: number };
export async function getCustomerStats(db: DbOrTx, opts: { customerId?: string; limit?: number } = {}): Promise<CustomerStat[]> {
  const res = await rows<Record<string, string | null>>(db, sql`
    select * from customer_stats where total_orders > 0 ${opts.customerId ? sql`and customer_id = ${opts.customerId}` : sql``}
    order by total_spent_cents desc ${opts.limit ? sql`limit ${opts.limit}` : sql``}`);
  return res.map((x) => ({
    customerId: x.customer_id!, name: x.name!, email: x.email!, totalOrders: n(x.total_orders), totalSpentCents: n(x.total_spent_cents), grossProfitCents: n(x.gross_profit_cents),
    averageOrderValueCents: n(x.average_order_value_cents), firstOrderAt: x.first_order_at ? new Date(x.first_order_at) : null, lastOrderAt: x.last_order_at ? new Date(x.last_order_at) : null,
    customerLifetimeValueCents: n(x.total_spent_cents),
  }));
}

export async function getCustomerAnalytics(db: DbOrTx, r: Range) {
  const [x] = await rows<Record<string, string>>(db, sql`
    with active as (select distinct o.customer_id from orders o where ${RECOGNIZED} and ${inRange(r)}),
    period as (select count(*) as orders, coalesce(sum(o.subtotal_cents - o.discount_total_cents - o.refund_total_cents),0) as net from orders o where ${RECOGNIZED} and ${inRange(r)})
    select (select count(*) from active a join customer_stats s using (customer_id) where s.first_order_at >= ${r.from.toISOString()}) as new,
           (select count(*) from active a join customer_stats s using (customer_id) where s.first_order_at < ${r.from.toISOString()}) as returning,
           (select count(*) from customer_stats where total_orders > 0) as buyers, (select count(*) from customer_stats where total_orders >= 2) as repeaters,
           (select coalesce(sum(total_spent_cents),0) from customer_stats) as lifetime, (select count(*) from active) as active,
           (select orders from period) as orders, (select net from period) as net`);
  const buyers = n(x!.buyers), active = n(x!.active), orders = n(x!.orders), net = n(x!.net);
  return {
    newCustomers: n(x!.new), returningCustomers: n(x!.returning), repeatPurchaseRatePct: pctOf(n(x!.repeaters), buyers),
    averageLifetimeValueCents: buyers ? Math.round(n(x!.lifetime) / buyers) : 0, averageOrderValueCents: orders ? Math.round(net / orders) : 0,
    revenuePerCustomerCents: active ? Math.round(net / active) : 0,
  };
}

/* ---- the named functions from the brief (§22). The dashboard should call getMetrics once instead. ---- */
export const getRevenue = async (db: DbOrTx, r: Range) => (await getMetrics(db, r)).revenueCents;
export const getNetRevenue = async (db: DbOrTx, r: Range) => (await getMetrics(db, r)).netRevenueCents;
export const getCOGS = async (db: DbOrTx, r: Range) => (await getMetrics(db, r)).cogsCents;
export const getGrossProfit = async (db: DbOrTx, r: Range) => (await getMetrics(db, r)).grossProfitCents;
export const getGrossMargin = async (db: DbOrTx, r: Range) => (await getMetrics(db, r)).grossMarginPct;
export const getOrders = async (db: DbOrTx, r: Range) => (await getMetrics(db, r)).orders;
export const getUnitsSold = async (db: DbOrTx, r: Range) => (await getMetrics(db, r)).units;
export const getAverageOrderValue = async (db: DbOrTx, r: Range) => (await getMetrics(db, r)).averageOrderValueCents;
export async function getInventoryValue(db: DbOrTx) {
  const [x] = await rows<{ v: string }>(db, sql`select coalesce(sum(inventory_value_cents),0) as v from variant_stock`);
  return n(x!.v);
}
export const getLowStockProducts = async (db: DbOrTx) => (await getInventory(db, { onlyAttention: true })).filter((x) => x.status === "LOW_STOCK");
export const getOutOfStockProducts = async (db: DbOrTx) => (await getInventory(db, { onlyAttention: true })).filter((x) => x.status === "OUT_OF_STOCK");
export const getTopProducts = async (db: DbOrTx, r: Range, sortBy: "netRevenueCents" | "units" | "grossProfitCents" | "grossMarginPct" = "netRevenueCents", limit = 10) =>
  (await getSalesBy(db, r, "product")).sort((a, b) => b[sortBy] - a[sortBy]).slice(0, limit);
export const getTopCustomers = (db: DbOrTx, limit = 10) => getCustomerStats(db, { limit });
export const getSalesByCategory = (db: DbOrTx, r: Range) => getSalesBy(db, r, "category");
export const getCustomerLifetimeValue = async (db: DbOrTx, customerId: string) => (await getCustomerStats(db, { customerId }))[0]?.customerLifetimeValueCents ?? 0;

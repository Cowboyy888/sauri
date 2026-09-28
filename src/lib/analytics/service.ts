/**
 * Server-side analytics. Aggregation happens in Postgres, not in the browser.
 *
 * Definitions (used everywhere, including exports):
 *   recognized order  = status in paid|processing|shipped|delivered|refunded, bucketed by paid_at
 *   gross sales       = Σ subtotal
 *   net revenue       = gross − discounts − refunds
 *   COGS              = Σ qty × unit cost snapshot (refunded + restocked orders contribute 0)
 *   gross profit      = net revenue − COGS − payment fees − shipping costs
 *   gross margin %    = gross profit ÷ net revenue × 100
 * Tax collected and shipping charged are pass-through and excluded from revenue.
 */
import { sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { STORE } from "../config";

export type Range = { from: Date; to: Date }; // `to` exclusive
export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "90d" | "ytd" | "all" | "custom";

const n = (v: unknown) => Number(v ?? 0);
const RECOGNIZED = sql.raw(`o.status in ('paid','processing','shipped','delivered','refunded')`);
/** COGS counts unless the order was refunded AND its goods went back on the shelf. */
const COGS_COUNTS = sql.raw(`(o.status <> 'refunded' or exists (select 1 from refunds r where r.order_id = o.id and r.restocked = false))`);
const inRange = (r: Range) => sql`o.paid_at >= ${r.from.toISOString()} and o.paid_at < ${r.to.toISOString()}`;

async function rows<T>(db: DbOrTx, q: SQL): Promise<T[]> {
  const res = await db.execute(q);
  return res.rows as T[];
}

/** Resolve a named range in the store's time zone (so "today" means today in Phnom Penh, not UTC). */
export async function resolveRange(db: DbOrTx, key: RangeKey, custom?: { from: string; to: string }): Promise<Range & { key: RangeKey; previous: Range }> {
  const tz = STORE.timezone;
  const [b] = await rows<{ sod: Date; now: Date; soy: Date; first: Date | null }>(db, sql`
    select (date_trunc('day', now() at time zone ${tz}) at time zone ${tz}) as sod, now() as now,
           (date_trunc('year', now() at time zone ${tz}) at time zone ${tz}) as soy,
           (select min(paid_at) from orders) as first`);
  const sod = new Date(b!.sod), now = new Date(b!.now), day = 86_400_000;
  let from: Date, to = now;
  switch (key) {
    case "today": from = sod; break;
    case "yesterday": from = new Date(sod.getTime() - day); to = sod; break;
    case "7d": from = new Date(sod.getTime() - 6 * day); break;
    case "90d": from = new Date(sod.getTime() - 89 * day); break;
    case "ytd": from = new Date(b!.soy); break;
    case "all": from = b!.first ? new Date(b!.first) : sod; break;
    case "custom": {
      if (!custom) throw new Error("Custom range needs from and to dates.");
      const [c] = await rows<{ f: Date; t: Date }>(db, sql`select (${custom.from}::date::timestamp at time zone ${tz}) as f, ((${custom.to}::date + 1)::timestamp at time zone ${tz}) as t`);
      from = new Date(c!.f); to = new Date(Math.min(new Date(c!.t).getTime(), now.getTime())); break;
    }
    default: from = new Date(sod.getTime() - 29 * day);
  }
  const len = to.getTime() - from.getTime();
  const previous = key === "today" ? { from: new Date(sod.getTime() - day), to: new Date(now.getTime() - day) } : { from: new Date(from.getTime() - len), to: from };
  return { key, from, to, previous };
}

export type Metrics = {
  grossCents: number; discountCents: number; refundCents: number; netRevenueCents: number; cogsCents: number;
  feeCents: number; shippingCostCents: number; grossProfitCents: number; grossMarginPct: number;
  orders: number; units: number; averageOrderValueCents: number; customers: number; newCustomers: number;
};

/** One round trip for every headline KPI. */
export async function getMetrics(db: DbOrTx, r: Range): Promise<Metrics> {
  const [m] = await rows<Record<string, string>>(db, sql`
    with rec as (select o.* from orders o where ${RECOGNIZED} and ${inRange(r)}),
    items as (
      select coalesce(sum(i.quantity * i.unit_cost_cents), 0) as cogs, coalesce(sum(i.quantity), 0) as units
      from order_items i join rec o on o.id = i.order_id where ${COGS_COUNTS}),
    firsts as (select customer_id, min(o.paid_at) as f from orders o where ${RECOGNIZED} group by customer_id)
    select count(*) as orders, coalesce(sum(subtotal_cents),0) as gross, coalesce(sum(discount_cents),0) as disc,
           coalesce(sum(refunded_cents),0) as ref, coalesce(sum(payment_fee_cents),0) as fees, coalesce(sum(shipping_cost_cents),0) as ship,
           count(distinct customer_id) as customers, (select cogs from items) as cogs, (select units from items) as units,
           (select count(*) from firsts where f >= ${r.from.toISOString()} and f < ${r.to.toISOString()}) as new_customers
    from rec`);
  const gross = n(m!.gross), disc = n(m!.disc), ref = n(m!.ref), cogs = n(m!.cogs), fees = n(m!.fees), ship = n(m!.ship), orders = n(m!.orders);
  const net = gross - disc - ref, gp = net - cogs - fees - ship;
  return {
    grossCents: gross, discountCents: disc, refundCents: ref, netRevenueCents: net, cogsCents: cogs, feeCents: fees, shippingCostCents: ship,
    grossProfitCents: gp, grossMarginPct: net ? Math.round((gp / net) * 10_000) / 100 : 0,
    orders, units: n(m!.units), averageOrderValueCents: orders ? Math.round((gross - disc) / orders) : 0,
    customers: n(m!.customers), newCustomers: n(m!.new_customers),
  };
}

export type SeriesPoint = { bucket: string; revenueCents: number; orders: number; units: number; grossProfitCents: number };
export async function getSeries(db: DbOrTx, r: Range, unit?: "hour" | "day" | "week" | "month"): Promise<{ unit: string; points: SeriesPoint[] }> {
  const span = r.to.getTime() - r.from.getTime();
  const u = unit ?? (span <= 1.5 * 86_400_000 ? "hour" : span <= 95 * 86_400_000 ? "day" : span <= 400 * 86_400_000 ? "week" : "month");
  const tz = STORE.timezone;
  const step = sql.raw(`'1 ${u}'::interval`), uu = sql.raw(`'${u}'`);
  const pts = await rows<Record<string, string>>(db, sql`
    with b as (
      select generate_series(date_trunc(${uu}, ${r.from.toISOString()}::timestamptz at time zone ${tz}),
                             date_trunc(${uu}, (${r.to.toISOString()}::timestamptz - interval '1 microsecond') at time zone ${tz}), ${step}) as bucket),
    o as (
      select date_trunc(${uu}, o.paid_at at time zone ${tz}) as bucket, o.*,
             case when ${COGS_COUNTS} then (select coalesce(sum(i.quantity*i.unit_cost_cents),0) from order_items i where i.order_id=o.id) else 0 end as cogs,
             case when o.status <> 'refunded' then (select coalesce(sum(i.quantity),0) from order_items i where i.order_id=o.id) else 0 end as units
      from orders o where ${RECOGNIZED} and ${inRange(r)})
    select to_char(b.bucket, 'YYYY-MM-DD"T"HH24:MI') as bucket, count(o.id) as orders, coalesce(sum(o.units),0) as units,
           coalesce(sum(o.subtotal_cents - o.discount_cents - o.refunded_cents),0) as rev,
           coalesce(sum(o.subtotal_cents - o.discount_cents - o.refunded_cents - o.cogs - o.payment_fee_cents - o.shipping_cost_cents),0) as gp
    from b left join o on o.bucket = b.bucket group by b.bucket order by b.bucket`);
  return { unit: u, points: pts.map((p) => ({ bucket: p.bucket!, orders: n(p.orders), units: n(p.units), revenueCents: n(p.rev), grossProfitCents: n(p.gp) })) };
}

export type GroupRow = { key: string; label: string; revenueCents: number; costCents: number; grossProfitCents: number; marginPct: number; units: number; orders: number };
const groupExpr = {
  product: sql.raw(`p.id::text`), productLabel: sql.raw(`max(p.name)`),
  category: sql.raw(`c.slug`), categoryLabel: sql.raw(`max(c.name)`),
  material: sql.raw(`v.material`), materialLabel: sql.raw(`v.material`),
  sku: sql.raw(`v.sku`), skuLabel: sql.raw(`max(i.product_name || ' / ' || i.variant_label)`),
} as const;

/** Item-level sales. Order discounts are allocated to lines pro rata. Profit is before fees and shipping. */
export async function getSalesBy(db: DbOrTx, r: Range, by: "product" | "category" | "material" | "sku"): Promise<GroupRow[]> {
  const key = groupExpr[by], label = groupExpr[`${by}Label`];
  const res = await rows<Record<string, string>>(db, sql`
    select ${key} as key, ${label} as label,
           sum(i.quantity * i.unit_price_cents * (1 - o.discount_cents::numeric / nullif(o.subtotal_cents,0))) as rev,
           sum(i.quantity * i.unit_cost_cents) as cost, sum(i.quantity) as units, count(distinct o.id) as orders
    from order_items i join orders o on o.id = i.order_id
      join product_variants v on v.id = i.variant_id join products p on p.id = i.product_id join categories c on c.id = p.category_id
    where ${RECOGNIZED} and o.status <> 'refunded' and ${inRange(r)}
    group by ${key} order by rev desc nulls last`);
  return res.map(toGroup);
}

export async function getSalesByChannel(db: DbOrTx, r: Range): Promise<GroupRow[]> {
  const res = await rows<Record<string, string>>(db, sql`
    select o.channel as key, max(sc.name) as label, sum(o.subtotal_cents - o.discount_cents - o.refunded_cents) as rev,
           sum(case when ${COGS_COUNTS} then (select coalesce(sum(i.quantity*i.unit_cost_cents),0) from order_items i where i.order_id=o.id) else 0 end) as cost,
           sum(o.payment_fee_cents + o.shipping_cost_cents) as overhead,
           sum(case when o.status <> 'refunded' then (select coalesce(sum(i.quantity),0) from order_items i where i.order_id=o.id) else 0 end) as units,
           count(*) as orders
    from orders o join sales_channels sc on sc.key = o.channel where ${RECOGNIZED} and ${inRange(r)}
    group by o.channel order by rev desc`);
  return res.map((x) => { const g = toGroup(x); const gp = g.revenueCents - g.costCents - n(x.overhead); return { ...g, grossProfitCents: gp, marginPct: g.revenueCents ? round2((gp / g.revenueCents) * 100) : 0 }; });
}

const round2 = (v: number) => Math.round(v * 100) / 100;
function toGroup(x: Record<string, string>): GroupRow {
  const rev = Math.round(n(x.rev)), cost = n(x.cost);
  const MATERIAL: Record<string, string> = { yg: "14K Yellow Gold", wg: "14K White Gold", vm: "18K Gold Vermeil", ss: "Sterling Silver" };
  return { key: x.key!, label: MATERIAL[x.label!] ?? x.label!, revenueCents: rev, costCents: cost, grossProfitCents: rev - cost, marginPct: rev ? round2(((rev - cost) / rev) * 100) : 0, units: n(x.units), orders: n(x.orders) };
}

export type InventoryRow = {
  variantId: string; sku: string; productId: string; productName: string; category: string; material: string; size: string | null; gemstone: string | null;
  costCents: number; priceCents: number; onHand: number; reserved: number; available: number; reorderLevel: number;
  status: "in" | "low" | "out"; valueCents: number; sold7: number; sold30: number;
  /** Estimates, clearly labelled as such in the UI. */
  forecast: { avgDaily: number; daysRemaining: number | null; suggestedReorder: number };
};

export async function getInventory(db: DbOrTx, opts: { coverDays?: number } = {}): Promise<InventoryRow[]> {
  const cover = opts.coverDays ?? 45;
  const res = await rows<Record<string, string | null>>(db, sql`
    with sold as (
      select i.variant_id,
             sum(i.quantity) filter (where o.paid_at >= now() - interval '7 days') as s7,
             sum(i.quantity) filter (where o.paid_at >= now() - interval '30 days') as s30
      from order_items i join orders o on o.id = i.order_id
      where ${RECOGNIZED} and o.status <> 'refunded' and o.paid_at >= now() - interval '30 days' group by i.variant_id)
    select v.id, v.sku, p.id as pid, p.name, c.name as cat, v.material, v.size, v.gemstone, v.cost_cents, v.price_cents,
           inv.on_hand, inv.reserved, inv.reorder_level, coalesce(s.s7,0) as s7, coalesce(s.s30,0) as s30
    from product_variants v join products p on p.id = v.product_id join categories c on c.id = p.category_id
      join inventory inv on inv.variant_id = v.id left join sold s on s.variant_id = v.id
    where p.status <> 'archived' order by p.name, v.sku`);
  return res.map((x) => {
    const onHand = n(x.on_hand), reserved = n(x.reserved), avail = onHand - reserved, reorder = n(x.reorder_level), s30 = n(x.s30);
    const avg = s30 / 30;
    return {
      variantId: x.id!, sku: x.sku!, productId: x.pid!, productName: x.name!, category: x.cat!, material: x.material!, size: x.size ?? null, gemstone: x.gemstone ?? null,
      costCents: n(x.cost_cents), priceCents: n(x.price_cents), onHand, reserved, available: avail, reorderLevel: reorder,
      status: avail <= 0 ? "out" : avail <= reorder ? "low" : "in", valueCents: onHand * n(x.cost_cents), sold7: n(x.s7), sold30: s30,
      forecast: { avgDaily: round2(avg), daysRemaining: avg ? Math.floor(avail / avg) : null, suggestedReorder: avg ? Math.max(0, Math.ceil((avg * cover + reorder - avail) / 5) * 5) : 0 },
    };
  });
}

export type CustomerStat = { customerId: string; name: string; email: string; orders: number; spentCents: number; profitCents: number; firstOrderAt: Date; lastOrderAt: Date; averageOrderCents: number };
export async function getCustomerStats(db: DbOrTx, opts: { customerId?: string; limit?: number } = {}): Promise<CustomerStat[]> {
  const res = await rows<Record<string, string>>(db, sql`
    select c.id, c.name, c.email, count(o.id) as orders,
           sum(o.subtotal_cents - o.discount_cents - o.refunded_cents) as spent,
           sum(o.subtotal_cents - o.discount_cents - o.refunded_cents - o.payment_fee_cents - o.shipping_cost_cents
               - case when ${COGS_COUNTS} then (select coalesce(sum(i.quantity*i.unit_cost_cents),0) from order_items i where i.order_id=o.id) else 0 end) as profit,
           min(o.paid_at) as first, max(o.paid_at) as last
    from customers c join orders o on o.customer_id = c.id
    where ${RECOGNIZED} ${opts.customerId ? sql`and c.id = ${opts.customerId}` : sql``}
    group by c.id order by spent desc ${opts.limit ? sql`limit ${opts.limit}` : sql``}`);
  return res.map((x) => ({ customerId: x.id!, name: x.name!, email: x.email!, orders: n(x.orders), spentCents: n(x.spent), profitCents: n(x.profit), firstOrderAt: new Date(x.first!), lastOrderAt: new Date(x.last!), averageOrderCents: n(x.orders) ? Math.round(n(x.spent) / n(x.orders)) : 0 }));
}

export async function getCustomerAnalytics(db: DbOrTx, r: Range) {
  const [x] = await rows<Record<string, string>>(db, sql`
    with firsts as (select customer_id, min(o.paid_at) f, count(*) cnt, sum(o.subtotal_cents - o.discount_cents - o.refunded_cents) spent from orders o where ${RECOGNIZED} group by customer_id),
    active as (select distinct o.customer_id from orders o where ${RECOGNIZED} and ${inRange(r)}),
    period as (select count(*) orders, coalesce(sum(o.subtotal_cents - o.discount_cents - o.refunded_cents),0) net from orders o where ${RECOGNIZED} and ${inRange(r)})
    select (select count(*) from active a join firsts f using (customer_id) where f.f >= ${r.from.toISOString()}) as new,
           (select count(*) from active a join firsts f using (customer_id) where f.f < ${r.from.toISOString()}) as returning,
           (select count(*) from firsts) as buyers, (select count(*) from firsts where cnt >= 2) as repeaters,
           (select coalesce(sum(spent),0) from firsts) as lifetime, (select count(*) from active) as active,
           (select orders from period) as orders, (select net from period) as net`);
  const buyers = n(x!.buyers), active = n(x!.active), orders = n(x!.orders), net = n(x!.net);
  return {
    newCustomers: n(x!.new), returningCustomers: n(x!.returning),
    repeatPurchaseRatePct: buyers ? round2((n(x!.repeaters) / buyers) * 100) : 0,
    averageLifetimeValueCents: buyers ? Math.round(n(x!.lifetime) / buyers) : 0,
    averageOrderValueCents: orders ? Math.round(net / orders) : 0,
    revenuePerCustomerCents: active ? Math.round(net / active) : 0,
  };
}

/* ---- the function names required by the brief (§53), as thin wrappers ---- */
export const getRevenue = async (db: DbOrTx, r: Range) => { const m = await getMetrics(db, r); return m.grossCents - m.discountCents; };
export const getNetRevenue = async (db: DbOrTx, r: Range) => (await getMetrics(db, r)).netRevenueCents;
export const getCOGS = async (db: DbOrTx, r: Range) => (await getMetrics(db, r)).cogsCents;
export const getGrossProfit = async (db: DbOrTx, r: Range) => (await getMetrics(db, r)).grossProfitCents;
export const getGrossMargin = async (db: DbOrTx, r: Range) => (await getMetrics(db, r)).grossMarginPct;
export const getOrders = async (db: DbOrTx, r: Range) => (await getMetrics(db, r)).orders;
export const getUnitsSold = async (db: DbOrTx, r: Range) => (await getMetrics(db, r)).units;
export const getAverageOrderValue = async (db: DbOrTx, r: Range) => (await getMetrics(db, r)).averageOrderValueCents;
export async function getInventoryValue(db: DbOrTx) {
  const [x] = await rows<{ v: string }>(db, sql`select coalesce(sum(inv.on_hand * v.cost_cents),0) as v from inventory inv join product_variants v on v.id = inv.variant_id`);
  return n(x!.v);
}
export const getLowStockProducts = async (db: DbOrTx) => (await getInventory(db)).filter((x) => x.status !== "in");
export const getTopProducts = (db: DbOrTx, r: Range) => getSalesBy(db, r, "product");
export const getTopCustomers = (db: DbOrTx, limit = 10) => getCustomerStats(db, { limit });
export const getSalesByCategory = (db: DbOrTx, r: Range) => getSalesBy(db, r, "category");
export const getCustomerLifetimeValue = async (db: DbOrTx, customerId: string) => (await getCustomerStats(db, { customerId }))[0]?.spentCents ?? 0;

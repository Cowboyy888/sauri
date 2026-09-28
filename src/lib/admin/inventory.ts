import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { STORE } from "../config";
import type { Range } from "../analytics/service";
import { like, n, orderBy, rows, variantImage, type Page } from "./sql";

export type StockRow = {
  variantId: string; productId: string; productName: string; label: string; sku: string; barcode: string | null; category: string; image: string | null;
  costPriceCents: number; sellingPriceCents: number; stockQuantity: number; reservedQuantity: number; availableStock: number; reorderLevel: number;
  status: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK"; inventoryValueCents: number;
  sold7: number; sold30: number; lastSoldAt: Date | null;
  /** Estimates. */ avgDailySales: number; estimatedDaysRemaining: number | null; suggestedReorderQuantity: number;
};

const SOLD = sql`
  select i.variant_id,
         coalesce(sum(i.quantity) filter (where o.paid_at >= now() - interval '7 days'), 0) as s7,
         coalesce(sum(i.quantity) filter (where o.paid_at >= now() - interval '30 days'), 0) as s30,
         max(o.paid_at) as last_sold
  from order_items i join orders o on o.id = i.order_id
  where o.paid_at is not null and o.refund_total_cents = 0 group by i.variant_id`;

function mapStock(x: Record<string, string | null>, coverDays = 45): StockRow {
  const avail = n(x.available_stock), reorder = n(x.reorder_level), s30 = n(x.s30), avg = s30 / 30;
  return {
    variantId: x.variant_id!, productId: x.product_id!, productName: x.product_name!, label: x.variant_label!, sku: x.sku!, barcode: x.barcode ?? null, category: x.category_name!, image: x.image ?? null,
    costPriceCents: n(x.cost_price_cents), sellingPriceCents: n(x.selling_price_cents), stockQuantity: n(x.stock_quantity), reservedQuantity: n(x.reserved_quantity), availableStock: avail, reorderLevel: reorder,
    status: x.stock_status as StockRow["status"], inventoryValueCents: n(x.inventory_value_cents), sold7: n(x.s7), sold30: s30, lastSoldAt: x.last_sold ? new Date(x.last_sold) : null,
    avgDailySales: Math.round(avg * 100) / 100, estimatedDaysRemaining: avg ? Math.max(0, Math.floor(avail / avg)) : null,
    suggestedReorderQuantity: avg ? Math.max(0, Math.ceil((avg * coverDays + reorder - avail) / 5) * 5) : Math.max(0, reorder * 2 - avail),
  };
}

const BASE = (where: ReturnType<typeof sql>) => sql`
  select vs.*, ${variantImage("vs.product_id", "pv.material")} as image, coalesce(s.s7,0) as s7, coalesce(s.s30,0) as s30, s.last_sold
  from variant_stock vs join product_variants pv on pv.id = vs.variant_id left join (${SOLD}) s on s.variant_id = vs.variant_id
  where vs.product_status <> 'archived' ${where}`;

export async function listStock(db: DbOrTx, o: { q?: string; status?: string; category?: string; sort?: string; dir?: string; page: number; pageSize: number }): Promise<Page<StockRow>> {
  const q = o.q?.trim();
  const res = await rows<Record<string, string | null>>(db, sql`
    select x.*, count(*) over () as total from (${BASE(sql`
      ${q ? sql`and (vs.product_name ilike ${like(q)} or vs.sku ilike ${like(q)} or vs.barcode ilike ${like(q)} or vs.variant_label ilike ${like(q)})` : sql``}
      ${o.status ? sql`and vs.stock_status = ${o.status}` : sql``}
      ${o.category ? sql`and vs.category_slug = ${o.category}` : sql``}`)}) x
    order by ${orderBy(o.sort, { product: "x.product_name", sku: "x.sku", available: "x.available_stock", value: "x.inventory_value_cents", status: "x.stock_status" }, "product", o.dir ?? (!o.sort || o.sort === "product" || o.sort === "sku" ? "asc" : "desc"))}, x.sku
    limit ${o.pageSize} offset ${(o.page - 1) * o.pageSize}`);
  return { total: n(res[0]?.total), page: o.page, pageSize: o.pageSize, rows: res.map((x) => mapStock(x)) };
}

/** Low stock, most urgent first: fewest estimated days left, then fewest units. */
export async function lowStock(db: DbOrTx, limit = 50): Promise<StockRow[]> {
  const res = await rows<Record<string, string | null>>(db, BASE(sql`and vs.stock_status = 'LOW_STOCK'`));
  return res.map((x) => mapStock(x)).sort((a, b) => (a.estimatedDaysRemaining ?? 1e9) - (b.estimatedDaysRemaining ?? 1e9) || a.availableStock - b.availableStock).slice(0, limit);
}

/** Out of stock, best sellers first (they cost the most in lost sales). */
export async function outOfStock(db: DbOrTx, limit = 50): Promise<StockRow[]> {
  const res = await rows<Record<string, string | null>>(db, BASE(sql`and vs.stock_status = 'OUT_OF_STOCK'`));
  return res.map((x) => mapStock(x)).sort((a, b) => b.sold30 - a.sold30 || +(b.lastSoldAt ?? 0) - +(a.lastSoldAt ?? 0)).slice(0, limit);
}

export async function inventorySummary(db: DbOrTx) {
  const [x] = await rows<Record<string, string>>(db, sql`
    select count(distinct product_id) filter (where product_status = 'active') as products, count(*) as variants,
           coalesce(sum(stock_quantity),0) as units, coalesce(sum(reserved_quantity),0) as reserved, coalesce(sum(inventory_value_cents),0) as value,
           count(*) filter (where stock_status = 'LOW_STOCK') as low, count(*) filter (where stock_status = 'OUT_OF_STOCK') as out
    from variant_stock where product_status <> 'archived'`);
  return { totalProducts: n(x!.products), totalVariants: n(x!.variants), totalUnits: n(x!.units), reservedUnits: n(x!.reserved), inventoryValueCents: n(x!.value), lowStock: n(x!.low), outOfStock: n(x!.out) };
}

export async function inventoryValueBy(db: DbOrTx, by: "category" | "product", limit = 10) {
  const key = by === "category" ? sql.raw("category_name") : sql.raw("product_name");
  const res = await rows<Record<string, string>>(db, sql`
    select ${key} as label, coalesce(sum(inventory_value_cents),0) as value, coalesce(sum(available_stock),0) as units
    from variant_stock where product_status <> 'archived' group by ${key} order by value desc limit ${limit}`);
  const total = res.reduce((a, r) => a + n(r.value), 0);
  return res.map((r) => ({ label: r.label!, valueCents: n(r.value), units: n(r.units), sharePct: total ? Math.round((n(r.value) / total) * 1000) / 10 : 0 }));
}

/**
 * Estimated inventory value at the end of each day: stock on hand reconstructed from the movement ledger,
 * valued at TODAY's cost prices (historical costs are not versioned). Label it as an estimate.
 */
export async function inventoryValueTrend(db: DbOrTx, r: Range) {
  const tz = STORE.timezone;
  const res = await rows<Record<string, string>>(db, sql`
    with b as (select generate_series(date_trunc('day', ${r.from.toISOString()}::timestamptz at time zone ${tz}), date_trunc('day', (${r.to.toISOString()}::timestamptz - interval '1 microsecond') at time zone ${tz}), '1 day'::interval) as day),
    d as (select date_trunc('day', m.created_at at time zone ${tz}) as day, sum(m.quantity::bigint * v.cost_price_cents) as delta
          from inventory_movements m join product_variants v on v.id = m.variant_id join products p on p.id = v.product_id where p.status <> 'archived' group by 1)
    select to_char(b.day, 'YYYY-MM-DD') as day, (select coalesce(sum(delta),0) from d where d.day <= b.day) as value from b order by b.day`);
  return res.map((x) => ({ day: x.day!, valueCents: n(x.value) }));
}

export type MovementRow = { id: number; at: Date; productId: string; productName: string; sku: string; label: string; type: string; quantity: number; before: number; after: number; referenceType: string | null; reference: string | null; orderId: string | null; user: string; notes: string | null };
export async function listMovements(db: DbOrTx, o: { q?: string; type?: string; range?: Range; page: number; pageSize: number }): Promise<Page<MovementRow>> {
  const q = o.q?.trim();
  const res = await rows<Record<string, string | null>>(db, sql`
    select m.id, m.created_at, vs.product_id, vs.product_name, vs.sku, vs.variant_label, m.movement_type, m.quantity, m.stock_before, m.stock_after,
           m.reference_type, m.reference_id, m.order_id, coalesce(u.name, 'System') as user_name, m.notes, count(*) over () as total
    from inventory_movements m join variant_stock vs on vs.variant_id = m.variant_id left join users u on u.id = m.user_id
    where true
      ${q ? sql`and (vs.product_name ilike ${like(q)} or vs.sku ilike ${like(q)} or m.reference_id ilike ${like(q)} or m.notes ilike ${like(q)})` : sql``}
      ${o.type ? sql`and m.movement_type = ${o.type}` : sql``}
      ${o.range ? sql`and m.created_at >= ${o.range.from.toISOString()} and m.created_at < ${o.range.to.toISOString()}` : sql``}
    order by m.created_at desc, m.id desc limit ${o.pageSize} offset ${(o.page - 1) * o.pageSize}`);
  return {
    total: n(res[0]?.total), page: o.page, pageSize: o.pageSize,
    rows: res.map((m) => ({ id: n(m.id), at: new Date(m.created_at!), productId: m.product_id!, productName: m.product_name!, sku: m.sku!, label: m.variant_label!, type: m.movement_type!, quantity: n(m.quantity), before: n(m.stock_before), after: n(m.stock_after), referenceType: m.reference_type ?? null, reference: m.reference_id ?? null, orderId: m.order_id ?? null, user: m.user_name!, notes: m.notes ?? null })),
  };
}

export async function listSuppliers(db: DbOrTx) {
  return rows<{ name: string }>(db, sql`select name from suppliers order by name`);
}

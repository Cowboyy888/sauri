import { asc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { categories, collections, productImages, products, reviews } from "../db/schema";
import { getSalesBy, getSeries, type Range } from "../analytics/service";
import { like, n, orderBy, productImage, rows, variantImage, type Page } from "./sql";

export type ProductListRow = {
  id: string; name: string; slug: string; status: string; category: string; image: string | null; sku: string; variants: number;
  priceMinCents: number; priceMaxCents: number; costMinCents: number; costMaxCents: number; stock: number; available: number; unitsSold: number; revenueCents: number;
};

/** Server-side search + filter + sort + pagination. Search matches name, SKU, barcode, category and variant (metal, size, stone). */
export async function listProducts(db: DbOrTx, o: { q?: string; category?: string; status?: string; sort?: string; dir?: string; page: number; pageSize: number; range: Range }): Promise<Page<ProductListRow>> {
  const q = o.q?.trim();
  const res = await rows<Record<string, string | null>>(db, sql`
    with p as (
      select p.id, p.name, p.slug, p.status, c.name as category, ${productImage("p.id")} as image,
             max(c.sku_prefix) || '-' || p.code as sku, count(v.id) as variants,
             min(v.selling_price_cents) as price_min, max(v.selling_price_cents) as price_max, min(v.cost_price_cents) as cost_min, max(v.cost_price_cents) as cost_max,
             coalesce(sum(i.stock_quantity),0) as stock, coalesce(sum(i.stock_quantity - i.reserved_quantity),0) as available
      from products p join categories c on c.id = p.category_id
        left join product_variants v on v.product_id = p.id left join inventory i on i.variant_id = v.id
      where true
        ${q ? sql`and (p.name ilike ${like(q)} or c.name ilike ${like(q)} or exists (select 1 from variant_stock vs where vs.product_id = p.id and (vs.sku ilike ${like(q)} or vs.barcode ilike ${like(q)} or vs.variant_label ilike ${like(q)})))` : sql``}
        ${o.category ? sql`and c.slug = ${o.category}` : sql``}
        ${o.status ? sql`and p.status = ${o.status}` : sql`and p.status <> 'archived'`}
      group by p.id, c.name)
    select p.*, coalesce(s.units,0) as units, coalesce(s.rev,0) as rev, count(*) over () as total
    from p left join lateral (
      select sum(i.quantity) as units, sum(i.line_total_cents) as rev from order_items i join orders o on o.id = i.order_id
      where i.product_id = p.id and o.paid_at >= ${o.range.from.toISOString()} and o.paid_at < ${o.range.to.toISOString()} and o.refund_total_cents = 0) s on true
    order by ${orderBy(o.sort, { name: "p.name", revenue: "rev", units: "units", stock: "available", price: "price_min", status: "p.status" }, "revenue", o.dir ?? (o.sort === "name" ? "asc" : "desc"))}, p.name
    limit ${o.pageSize} offset ${(o.page - 1) * o.pageSize}`);
  return {
    total: n(res[0]?.total), page: o.page, pageSize: o.pageSize,
    rows: res.map((x) => ({
      id: x.id!, name: x.name!, slug: x.slug!, status: x.status!, category: x.category!, image: x.image ?? null, sku: x.sku ?? "", variants: n(x.variants),
      priceMinCents: n(x.price_min), priceMaxCents: n(x.price_max), costMinCents: n(x.cost_min), costMaxCents: n(x.cost_max), stock: n(x.stock), available: n(x.available), unitsSold: n(x.units), revenueCents: n(x.rev),
    })),
  };
}

export type VariantRow = {
  id: string; sku: string; barcode: string | null; material: string; color: string | null; size: string | null; gemstone: string | null; style: string | null; label: string; status: string;
  sellingPriceCents: number; costPriceCents: number; compareAtPriceCents: number | null; weightMg: number;
  stockQuantity: number; reservedQuantity: number; availableStock: number; reorderLevel: number; stockStatus: string; inventoryValueCents: number; image: string | null;
};

export async function getProduct(db: DbOrTx, id: string) {
  const [p] = await db.select().from(products).where(eq(products.id, id));
  if (!p) return null;
  const [variants, images, revs, cats, cols] = await Promise.all([
    rows<Record<string, string | null>>(db, sql`
      select v.id, v.sku, v.barcode, v.material, v.color, v.size, v.gemstone, v.style, v.status, v.selling_price_cents, v.cost_price_cents, v.compare_at_price_cents, v.weight_mg,
             vs.variant_label, vs.stock_quantity, vs.reserved_quantity, vs.available_stock, vs.reorder_level, vs.stock_status, vs.inventory_value_cents,
             ${variantImage("v.product_id", "v.material")} as image
      from product_variants v join variant_stock vs on vs.variant_id = v.id where v.product_id = ${id} order by v.material, v.sku`),
    db.select().from(productImages).where(eq(productImages.productId, id)).orderBy(asc(productImages.position)),
    db.select().from(reviews).where(eq(reviews.productId, id)).orderBy(sql`${reviews.createdAt} desc`),
    db.select().from(categories).orderBy(asc(categories.position)),
    db.select().from(collections).orderBy(asc(collections.name)),
  ]);
  return {
    product: p, images, reviews: revs, categories: cats, collections: cols,
    variants: variants.map((v): VariantRow => ({
      id: v.id!, sku: v.sku!, barcode: v.barcode ?? null, material: v.material!, color: v.color ?? null, size: v.size ?? null, gemstone: v.gemstone ?? null, style: v.style ?? null, label: v.variant_label!, status: v.status!,
      sellingPriceCents: n(v.selling_price_cents), costPriceCents: n(v.cost_price_cents), compareAtPriceCents: v.compare_at_price_cents == null ? null : n(v.compare_at_price_cents), weightMg: n(v.weight_mg),
      stockQuantity: n(v.stock_quantity), reservedQuantity: n(v.reserved_quantity), availableStock: n(v.available_stock), reorderLevel: n(v.reorder_level), stockStatus: v.stock_status!, inventoryValueCents: n(v.inventory_value_cents), image: v.image ?? null,
    })),
  };
}

/** Everything on the product's Analytics tab, for the selected range. */
export async function getProductAnalytics(db: DbOrTx, productId: string, r: Range) {
  const [summary, series, movements, recentOrders] = await Promise.all([
    getSalesBy(db, r, "product", { productId }),
    getSeries(db, r, { productId }),
    rows<Record<string, string | null>>(db, sql`
      select m.id, m.created_at, m.movement_type, m.quantity, m.stock_before, m.stock_after, m.reference_id, m.order_id, m.notes, v.sku, u.name as user_name
      from inventory_movements m join product_variants v on v.id = m.variant_id left join users u on u.id = m.user_id
      where v.product_id = ${productId} order by m.created_at desc, m.id desc limit 15`),
    rows<Record<string, string | null>>(db, sql`
      select o.id, o.order_number, o.placed_at, o.status, c.name as customer, sum(i.quantity) as qty, sum(i.line_total_cents) as line_total
      from order_items i join orders o on o.id = i.order_id join customers c on c.id = o.customer_id
      where i.product_id = ${productId} group by o.id, c.name order by o.placed_at desc limit 10`),
  ]);
  const s = summary[0];
  return {
    unitsSold: s?.units ?? 0, revenueCents: s?.netRevenueCents ?? 0, cogsCents: s?.cogsCents ?? 0, grossProfitCents: s?.grossProfitCents ?? 0, grossMarginPct: s?.grossMarginPct ?? 0, orders: s?.orders ?? 0,
    series,
    movements: movements.map((m) => ({ id: n(m.id), at: new Date(m.created_at!), type: m.movement_type!, quantity: n(m.quantity), before: n(m.stock_before), after: n(m.stock_after), reference: m.reference_id, orderId: m.order_id, notes: m.notes, sku: m.sku!, user: m.user_name ?? "System" })),
    recentOrders: recentOrders.map((o) => ({ id: o.id!, orderNumber: o.order_number!, placedAt: new Date(o.placed_at!), status: o.status!, customer: o.customer!, quantity: n(o.qty), lineTotalCents: n(o.line_total) })),
  };
}

export async function listCategoriesWithCounts(db: DbOrTx) {
  return rows<{ slug: string; name: string }>(db, sql`select slug, name from categories order by position`);
}

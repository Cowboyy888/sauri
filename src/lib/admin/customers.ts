import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { like, n, orderBy, productImage, rows, type Page } from "./sql";

export type CustomerListRow = { id: string; name: string; email: string; orders: number; revenueCents: number; profitCents: number; averageOrderCents: number; lastOrderAt: Date | null; customerSince: Date };

export async function listCustomers(db: DbOrTx, o: { q?: string; sort?: string; dir?: string; page: number; pageSize: number }): Promise<Page<CustomerListRow>> {
  const q = o.q?.trim();
  const res = await rows<Record<string, string | null>>(db, sql`
    select s.*, count(*) over () as total from customer_stats s
    where true ${q ? sql`and (s.name ilike ${like(q)} or s.email ilike ${like(q)})` : sql``}
    order by ${orderBy(o.sort, { revenue: "s.total_spent_cents", orders: "s.total_orders", profit: "s.gross_profit_cents", aov: "s.average_order_value_cents", last: "s.last_order_at", since: "s.customer_since", name: "s.name" }, "revenue", o.dir ?? (o.sort === "name" ? "asc" : "desc"))}, s.name
    limit ${o.pageSize} offset ${(o.page - 1) * o.pageSize}`);
  return {
    total: n(res[0]?.total), page: o.page, pageSize: o.pageSize,
    rows: res.map((x) => ({ id: x.customer_id!, name: x.name!, email: x.email!, orders: n(x.total_orders), revenueCents: n(x.total_spent_cents), profitCents: n(x.gross_profit_cents), averageOrderCents: n(x.average_order_value_cents), lastOrderAt: x.last_order_at ? new Date(x.last_order_at) : null, customerSince: new Date(x.customer_since!) })),
  };
}

export async function getCustomer(db: DbOrTx, id: string) {
  const [stats] = await rows<Record<string, string | null>>(db, sql`select * from customer_stats where customer_id = ${id}`);
  if (!stats) return null;
  const [cust, favorites, recent, wishlist, addresses] = await Promise.all([
    rows<Record<string, string | null>>(db, sql`select phone, marketing_opt_in, user_id from customers where id = ${id}`),
    rows<Record<string, string>>(db, sql`
      select c.name as category, sum(i.quantity) as units, sum(i.line_total_cents) as rev
      from order_items i join orders o on o.id = i.order_id join products p on p.id = i.product_id join categories c on c.id = p.category_id
      where o.customer_id = ${id} and o.paid_at is not null and o.refund_total_cents = 0 group by c.name order by units desc, rev desc`),
    rows<Record<string, string | null>>(db, sql`
      select distinct on (i.product_id) i.product_id, i.product_name_snapshot as name, i.sku_snapshot as sku, o.placed_at, ${productImage("i.product_id")} as image
      from order_items i join orders o on o.id = i.order_id where o.customer_id = ${id} order by i.product_id, o.placed_at desc`),
    rows<Record<string, string | null>>(db, sql`select p.id, p.name, ${productImage("p.id")} as image, w.created_at from wishlists w join products p on p.id = w.product_id where w.customer_id = ${id} order by w.created_at desc`),
    rows<Record<string, string | null>>(db, sql`select type, first_name, last_name, line1, line2, city, postal_code, country, is_default from customer_addresses where customer_id = ${id} order by is_default desc`),
  ]);
  return {
    id, name: stats.name!, email: stats.email!, phone: cust[0]?.phone ?? null, marketingOptIn: cust[0]?.marketing_opt_in === "true" || (cust[0]?.marketing_opt_in as unknown) === true, registered: !!cust[0]?.user_id,
    customerSince: new Date(stats.customer_since!), totalOrders: n(stats.total_orders), totalSpentCents: n(stats.total_spent_cents), grossProfitCents: n(stats.gross_profit_cents),
    averageOrderValueCents: n(stats.average_order_value_cents), lifetimeValueCents: n(stats.total_spent_cents),
    firstOrderAt: stats.first_order_at ? new Date(stats.first_order_at) : null, lastOrderAt: stats.last_order_at ? new Date(stats.last_order_at) : null,
    favoriteCategories: favorites.map((f) => ({ category: f.category!, units: n(f.units), revenueCents: n(f.rev) })),
    recentProducts: recent.sort((a, b) => +new Date(b.placed_at!) - +new Date(a.placed_at!)).slice(0, 6).map((r) => ({ productId: r.product_id!, name: r.name!, sku: r.sku!, at: new Date(r.placed_at!), image: r.image ?? null })),
    wishlist: wishlist.map((w) => ({ productId: w.id!, name: w.name!, image: w.image ?? null, at: new Date(w.created_at!) })),
    addresses: addresses.map((a) => ({ type: a.type!, name: `${a.first_name} ${a.last_name}`, lines: [a.line1, a.line2, `${a.city} ${a.postal_code}`, a.country].filter(Boolean) as string[], isDefault: String(a.is_default) === "true" })),
  };
}

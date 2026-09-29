/**
 * Wishlist CRM (brief §18). "Conversion" is interpreted as: of the *distinct (customer, product)* pairs
 * ever wishlisted, how many of those customers went on to buy that same product (in any order, any time
 * after adding it) — the natural reading of "wishlist products later purchased ÷ wishlist products."
 */
import "server-only";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { n, rows } from "../admin/sql";

export async function getMostWishlistedProducts(db: DbOrTx, limit = 10) {
  return rows<{ product_id: string; name: string; count: string }>(db, sql`
    select w.product_id, p.name, count(*) as count from wishlists w join products p on p.id = w.product_id
    group by w.product_id, p.name order by count(*) desc limit ${limit}`).then((res) => res.map((r) => ({ productId: r.product_id, name: r.name, count: n(r.count) })));
}

export async function getWishlistConversionRate(db: DbOrTx): Promise<{ wishlisted: number; converted: number; ratePct: number | null }> {
  const [row] = await rows<{ wishlisted: string; converted: string }>(db, sql`
    select count(*) as wishlisted,
      count(*) filter (where exists (
        select 1 from order_items oi join orders o on o.id = oi.order_id
        where oi.product_id = w.product_id and o.customer_id = w.customer_id and o.paid_at is not null and o.paid_at >= w.created_at
      )) as converted
    from wishlists w`);
  const wishlisted = n(row?.wishlisted), converted = n(row?.converted);
  return { wishlisted, converted, ratePct: wishlisted ? Math.round((converted / wishlisted) * 1000) / 10 : null };
}

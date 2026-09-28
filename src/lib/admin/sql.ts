import { sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../db/client";

export const n = (v: unknown) => Number(v ?? 0);
export async function rows<T = Record<string, unknown>>(db: DbOrTx, q: SQL): Promise<T[]> { return (await db.execute(q)).rows as T[]; }
/** Escape % and _ so a search for "10%" matches literally. */
export const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
/** Whitelisted ORDER BY: never interpolate user input into SQL. */
export function orderBy(sort: string | undefined, allowed: Record<string, string>, fallback: string, dir: string | undefined) {
  const col = (sort && allowed[sort]) || allowed[fallback]!;
  return sql.raw(`${col} ${dir === "asc" ? "asc" : "desc"} nulls last`);
}
export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number };
/** Image for a variant: the image tagged to a variant of the same metal, else the product's first image. */
export const variantImage = (productIdCol: string, materialCol: string) => sql.raw(`coalesce(
  (select pi.url from product_images pi join product_variants iv on iv.id = pi.variant_id where pi.product_id = ${productIdCol} and iv.material = ${materialCol} order by pi.position limit 1),
  (select pi.url from product_images pi where pi.product_id = ${productIdCol} order by pi.position limit 1))`);
export const productImage = (productIdCol: string) => sql.raw(`(select pi.url from product_images pi where pi.product_id = ${productIdCol} order by pi.position limit 1)`);

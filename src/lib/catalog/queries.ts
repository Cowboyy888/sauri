import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { categories, inventory, productVariants, products } from "../db/schema";

/** Active products with their "from" price and total available stock. */
export async function listActiveProducts(db: DbOrTx) {
  return db.select({
    id: products.id, slug: products.slug, name: products.name, badge: products.badge, category: categories.name,
    fromPriceCents: sql<number>`min(${productVariants.sellingPriceCents})::int`,
    available: sql<number>`sum(${inventory.stockQuantity} - ${inventory.reservedQuantity})::int`,
  }).from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.status, "active")))
    .innerJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(eq(products.status, "active"))
    .groupBy(products.id, categories.name, categories.position)
    .orderBy(asc(categories.position), asc(products.name));
}

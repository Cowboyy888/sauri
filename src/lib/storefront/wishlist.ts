import "server-only";
import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { wishlistEvents, wishlists } from "../db/schema";
import { getProductCardsByIds, type ProductCard } from "./catalog";

export async function getWishlistProductIds(db: DbOrTx, customerId: string): Promise<string[]> {
  const rows = await db.select({ productId: wishlists.productId }).from(wishlists).where(eq(wishlists.customerId, customerId));
  return rows.map((r) => r.productId);
}

export async function getWishlist(db: DbOrTx, customerId: string): Promise<ProductCard[]> {
  return getProductCardsByIds(db, await getWishlistProductIds(db, customerId));
}

export async function addToWishlist(db: DbOrTx, customerId: string, productId: string) {
  const [row] = await db.insert(wishlists).values({ customerId, productId }).onConflictDoNothing().returning();
  if (row) await db.insert(wishlistEvents).values({ customerId, productId, action: "added" });
}

export async function removeFromWishlist(db: DbOrTx, customerId: string, productId: string) {
  const [row] = await db.delete(wishlists).where(and(eq(wishlists.customerId, customerId), eq(wishlists.productId, productId))).returning();
  if (row) await db.insert(wishlistEvents).values({ customerId, productId, action: "removed" });
}

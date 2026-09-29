/**
 * Back-in-stock subscriptions (brief §40). Unlike abandoned-cart recovery or marketing automation, this
 * *does* send a real email — a customer explicitly asked to be told about one specific product, which is
 * closer to a transactional notice than a marketing send. See docs/CRM.md.
 * No `import "server-only"` guard here: `notifyBackInStock()` is a transitive dependency of
 * `lib/inventory/service.ts`'s `applyMovement()`, which `scripts/seed.ts` also calls as a plain Node
 * script (outside Next.js's module graph, where the guard would unconditionally throw regardless of the
 * actual call site).
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { productVariants, products, stockNotifications } from "../db/schema";
import { ValidationError } from "../errors";
import { emailProvider, backInStockEmail } from "../email/provider";

export async function subscribeToBackInStock(db: Db, variantId: string, email: string, customerId?: string) {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new ValidationError("Enter a valid email address.");
  await db.insert(stockNotifications).values({ email: clean, variantId, customerId: customerId ?? null }).onConflictDoNothing();
}

/** Fires when a variant's available stock crosses from zero (or less) to positive. Marks every pending
 *  subscription notified in the same call — a second restock before anyone re-subscribes is a no-op. */
export async function notifyBackInStock(tx: Tx, variantId: string) {
  const pending = await tx.select({ id: stockNotifications.id, email: stockNotifications.email })
    .from(stockNotifications).where(and(eq(stockNotifications.variantId, variantId), isNull(stockNotifications.notifiedAt)));
  if (!pending.length) return;
  const [v] = await tx.select({ name: products.name, sku: productVariants.sku, slug: products.slug })
    .from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)).where(eq(productVariants.id, variantId));
  if (!v) return;
  for (const p of pending) {
    await emailProvider.send(backInStockEmail({ email: p.email, productName: v.name, sku: v.sku, slug: v.slug }));
    await tx.update(stockNotifications).set({ notifiedAt: new Date() }).where(eq(stockNotifications.id, p.id));
  }
}

export async function listSubscriptions(db: Db, customerId: string) {
  return db.select({ id: stockNotifications.id, variantId: stockNotifications.variantId, sku: productVariants.sku, productName: products.name, notifiedAt: stockNotifications.notifiedAt, createdAt: stockNotifications.createdAt })
    .from(stockNotifications).innerJoin(productVariants, eq(productVariants.id, stockNotifications.variantId)).innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(stockNotifications.customerId, customerId)).orderBy(stockNotifications.createdAt);
}

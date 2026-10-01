/**
 * Stocktake / cycle counting (brief §46-48). Counting is `inventory:write` (the same permission that already
 * gates every other stock change); applying a stocktake whose largest single-line discrepancy meets or
 * exceeds the configurable threshold additionally requires OWNER or ADMIN ("manager approval") — see
 * docs/STOCKTAKE.md.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { inventory, productVariants, products, settings, stocktakeItems, stocktakes } from "../db/schema";
import { ValidationError, NotFoundError, ForbiddenError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { applyMovement, lockInventory } from "../inventory/service";
import { DEFAULT_STOCKTAKE_SETTINGS } from "../db/reference-data";

export type StocktakeSettings = typeof DEFAULT_STOCKTAKE_SETTINGS;
export async function getStocktakeSettings(db: DbOrTx): Promise<StocktakeSettings> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "stocktake"));
  return { ...DEFAULT_STOCKTAKE_SETTINGS, ...(row?.value as Partial<StocktakeSettings> | undefined) };
}
export async function setStocktakeSettings(db: Db, actor: Actor, patch: Partial<StocktakeSettings>) {
  assertCan(actor, "inventory:write");
  const before = await getStocktakeSettings(db);
  const next = { ...before, ...patch };
  if (next.approvalThresholdUnits < 0) throw new ValidationError("Threshold can't be negative.");
  await db.insert(settings).values({ key: "stocktake", value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next } });
  await audit(db, actor, "Updated stocktake settings", "settings", "stocktake", before, next);
  return next;
}

export type StocktakeRow = typeof stocktakes.$inferSelect;

/** Snapshots every active variant's current stock as `expected_quantity` at the moment the count starts —
 *  never recomputed later, so a sale mid-count doesn't retroactively change what "expected" meant. */
export async function startStocktake(db: Db, actor: Actor, input: { locationId?: string | null; notes?: string }): Promise<StocktakeRow> {
  assertCan(actor, "inventory:write");
  return db.transaction(async (tx) => {
    const [st] = await tx.insert(stocktakes).values({ locationId: input.locationId ?? null, startedByUserId: actor.userId, notes: input.notes ?? "" }).returning();
    const variants = await tx.select({ id: productVariants.id, stock: inventory.stockQuantity }).from(productVariants)
      .innerJoin(inventory, eq(inventory.variantId, productVariants.id)).innerJoin(products, eq(products.id, productVariants.productId))
      .where(sql`${products.status} <> 'archived' and ${productVariants.status} = 'active'`);
    if (variants.length) await tx.insert(stocktakeItems).values(variants.map((v) => ({ stocktakeId: st!.id, variantId: v.id, expectedQuantity: v.stock })));
    await audit(tx, actor, "Started stocktake", "stocktake", st!.id, undefined, { variants: variants.length });
    return st!;
  });
}

export async function recordCount(db: Db, actor: Actor, stocktakeId: string, variantId: string, countedQuantity: number) {
  assertCan(actor, "inventory:write");
  if (!Number.isInteger(countedQuantity) || countedQuantity < 0) throw new ValidationError("Counted quantity must be zero or more.");
  const [row] = await db.update(stocktakeItems).set({ countedQuantity }).where(sql`${stocktakeItems.stocktakeId} = ${stocktakeId} and ${stocktakeItems.variantId} = ${variantId}`).returning();
  if (!row) throw new NotFoundError("That item isn't part of this stocktake.");
  return row;
}

export async function getStocktake(db: DbOrTx, id: string) {
  const [st] = await db.select().from(stocktakes).where(eq(stocktakes.id, id));
  if (!st) return null;
  const items = await db.select({
    id: stocktakeItems.id, variantId: stocktakeItems.variantId, sku: productVariants.sku, productName: products.name,
    expectedQuantity: stocktakeItems.expectedQuantity, countedQuantity: stocktakeItems.countedQuantity, notes: stocktakeItems.notes,
  }).from(stocktakeItems).innerJoin(productVariants, eq(productVariants.id, stocktakeItems.variantId)).innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(stocktakeItems.stocktakeId, id)).orderBy(productVariants.sku);
  return { stocktake: st, items: items.map((i) => ({ ...i, difference: i.countedQuantity == null ? null : i.countedQuantity - i.expectedQuantity })) };
}

/**
 * Applies every counted line as an ADJUSTMENT inventory movement (brief §47). If the largest single-line
 * discrepancy is at or beyond the configured threshold, only OWNER/ADMIN may call this (brief §48) — an
 * INVENTORY-role counter must hand off to a manager to actually apply the result.
 */
export async function completeStocktake(db: Db, actor: Actor, stocktakeId: string) {
  assertCan(actor, "inventory:write");
  // Read-only precheck outside any transaction: if this needs manager approval and the caller isn't one,
  // marking the stocktake "pending_approval" must actually commit — it can't live inside the same
  // transaction as the ForbiddenError throw below, which would otherwise roll the marker back too.
  const [preCheck] = await db.select().from(stocktakes).where(eq(stocktakes.id, stocktakeId));
  if (!preCheck) throw new NotFoundError("Stocktake not found.");
  if (preCheck.status === "in_progress") {
    const items = await db.select().from(stocktakeItems).where(eq(stocktakeItems.stocktakeId, stocktakeId));
    const counted = items.filter((i) => i.countedQuantity != null);
    const cfg = await getStocktakeSettings(db);
    const maxDiscrepancy = Math.max(0, ...counted.map((i) => Math.abs(i.countedQuantity! - i.expectedQuantity)));
    if (maxDiscrepancy >= cfg.approvalThresholdUnits && actor.role !== "OWNER" && actor.role !== "ADMIN") {
      await db.update(stocktakes).set({ status: "pending_approval" }).where(and(eq(stocktakes.id, stocktakeId), eq(stocktakes.status, "in_progress")));
      throw new ForbiddenError(`A discrepancy of ${maxDiscrepancy} units needs OWNER or ADMIN approval before it can be applied.`);
    }
  }
  return db.transaction(async (tx) => {
    const [st] = await tx.select().from(stocktakes).where(eq(stocktakes.id, stocktakeId)).for("update");
    if (!st) throw new NotFoundError("Stocktake not found.");
    if (st.status !== "in_progress" && st.status !== "pending_approval") throw new ValidationError("This stocktake has already been completed or cancelled.");
    if (st.status === "pending_approval" && actor.role !== "OWNER" && actor.role !== "ADMIN") throw new ForbiddenError("This stocktake needs OWNER or ADMIN approval.");
    const items = await tx.select().from(stocktakeItems).where(eq(stocktakeItems.stocktakeId, stocktakeId));
    const counted = items.filter((i) => i.countedQuantity != null);
    if (!counted.length) throw new ValidationError("Count at least one item before completing.");
    const needsApproval = st.status === "pending_approval";
    const maxDiscrepancy = Math.max(0, ...counted.map((i) => Math.abs(i.countedQuantity! - i.expectedQuantity)));
    const variantIds = counted.map((i) => i.variantId);
    const locked = await lockInventory(tx, variantIds);
    for (const item of counted) {
      const delta = item.countedQuantity! - item.expectedQuantity;
      if (delta === 0) continue;
      const row = locked.get(item.variantId)!;
      await applyMovement(tx, row, { variantId: item.variantId, quantity: delta, movementType: "ADJUSTMENT", referenceType: "stock_count", referenceId: stocktakeId, userId: actor.userId, notes: `Stocktake ${stocktakeId}` });
    }
    const [row] = await tx.update(stocktakes).set({ status: "completed", completedAt: new Date(), approvedByUserId: needsApproval ? actor.userId : null, approvedAt: needsApproval ? new Date() : null }).where(eq(stocktakes.id, stocktakeId)).returning();
    await audit(tx, actor, "Completed stocktake", "stocktake", stocktakeId, undefined, { itemsAdjusted: counted.filter((i) => i.countedQuantity! - i.expectedQuantity !== 0).length, maxDiscrepancy });
    return row!;
  });
}

export async function cancelStocktake(db: Db, actor: Actor, id: string) {
  assertCan(actor, "inventory:write");
  const [row] = await db.update(stocktakes).set({ status: "cancelled" }).where(eq(stocktakes.id, id)).returning();
  if (!row) throw new NotFoundError("Stocktake not found.");
  await audit(db, actor, "Cancelled stocktake", "stocktake", id, undefined, undefined);
  return row;
}

export async function listStocktakes(db: DbOrTx) {
  return db.select().from(stocktakes).orderBy(sql`${stocktakes.startedAt} desc`).limit(100);
}

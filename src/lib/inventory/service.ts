/**
 * Inventory. Every stock change:
 *   1. locks the inventory row (SELECT … FOR UPDATE, in a fixed order to avoid deadlocks),
 *   2. validates the new level (never negative; the database enforces this too),
 *   3. writes the new level AND an inventory_movements row in the same transaction,
 *   4. raises a low / out-of-stock notification on the transition only.
 */
import { asc, eq, inArray } from "drizzle-orm";
import type { Db, DbOrTx, Tx } from "../db/client";
import { inventory, inventoryMovements, productVariants, products, suppliers } from "../db/schema";
import { InsufficientStockError, NotFoundError, ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit, emit, notify } from "../audit";
import { notifyBackInStock } from "./stock-notifications";

export type MovementType = typeof inventoryMovements.$inferInsert["movementType"];
export type ReferenceType = NonNullable<typeof inventoryMovements.$inferInsert["referenceType"]>;
export type LockedRow = { variantId: string; stockQuantity: number; reservedQuantity: number; reorderLevel: number };
export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

export const availableStock = (r: { stockQuantity: number; reservedQuantity: number }) => r.stockQuantity - r.reservedQuantity;
export const stockStatus = (available: number, reorderLevel: number): StockStatus =>
  available <= 0 ? "OUT_OF_STOCK" : available <= reorderLevel ? "LOW_STOCK" : "IN_STOCK";

export async function lockInventory(tx: Tx, variantIds: string[]): Promise<Map<string, LockedRow>> {
  const ids = [...new Set(variantIds)].sort();
  if (!ids.length) return new Map();
  const rows = await tx.select({ variantId: inventory.variantId, stockQuantity: inventory.stockQuantity, reservedQuantity: inventory.reservedQuantity, reorderLevel: inventory.reorderLevel })
    .from(inventory).where(inArray(inventory.variantId, ids)).orderBy(asc(inventory.variantId)).for("update");
  return new Map(rows.map((r) => [r.variantId, r]));
}

async function variantName(tx: DbOrTx, variantId: string) {
  const [v] = await tx.select({ sku: productVariants.sku, name: products.name }).from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId)).where(eq(productVariants.id, variantId));
  return v ?? { sku: variantId, name: "Unknown product" };
}

export type MoveInput = {
  variantId: string;
  quantity: number; // signed
  movementType: MovementType;
  referenceType?: ReferenceType | null;
  referenceId?: string | null;
  orderId?: string | null;
  supplierId?: string | null;
  unitCostCents?: number | null;
  notes?: string | null;
  userId?: string | null;
  /** Change to reserved_quantity applied atomically (e.g. −2 when a reserved order is paid). */
  reservedDelta?: number;
  /** Only for importing history (seed). Defaults to now. */
  at?: Date;
};

/** Low-level: the caller must already hold the row lock (lockInventory) inside `tx`. */
export async function applyMovement(tx: Tx, row: LockedRow, m: MoveInput) {
  if (!Number.isInteger(m.quantity) || m.quantity === 0) throw new ValidationError("Quantity must be a non-zero whole number.");
  const stockBefore = row.stockQuantity;
  const stockAfter = stockBefore + m.quantity;
  const reserved = row.reservedQuantity + (m.reservedDelta ?? 0);
  if (stockAfter < 0) {
    const v = await variantName(tx, m.variantId);
    throw new InsufficientStockError(`Only ${stockBefore} ${stockBefore === 1 ? "unit" : "units"} of ${v.name} (${v.sku}) available.`);
  }
  if (reserved < 0 || reserved > stockAfter) throw new InsufficientStockError("That stock is reserved for pending orders.");
  await tx.update(inventory).set({ stockQuantity: stockAfter, reservedQuantity: reserved }).where(eq(inventory.variantId, m.variantId));
  await tx.insert(inventoryMovements).values({
    variantId: m.variantId, movementType: m.movementType, quantity: m.quantity, stockBefore, stockAfter,
    referenceType: m.referenceType ?? null, referenceId: m.referenceId ?? null, orderId: m.orderId ?? null, supplierId: m.supplierId ?? null,
    unitCostCents: m.unitCostCents ?? null, notes: m.notes ?? null, userId: m.userId ?? null, ...(m.at ? { createdAt: m.at } : {}),
  });
  const availBefore = stockBefore - row.reservedQuantity, availAfter = stockAfter - reserved;
  await raiseStockAlerts(tx, row, availBefore, availAfter);
  if (availAfter > 0 && availBefore <= 0) await notifyBackInStock(tx, m.variantId);
  row.stockQuantity = stockAfter;
  row.reservedQuantity = reserved;
  await emit(tx, { type: "inventory.changed", variantId: m.variantId, stockAfter });
  return { stockBefore, stockAfter };
}

async function raiseStockAlerts(tx: Tx, row: LockedRow, availBefore: number, availAfter: number) {
  if (availAfter >= availBefore) return;
  if (availAfter <= 0 && availBefore > 0) {
    const v = await variantName(tx, row.variantId);
    await notify(tx, "out_of_stock", `Out of stock: ${v.name}`, `${v.sku} has no units available.`, v.sku);
  } else if (availAfter <= row.reorderLevel && availBefore > row.reorderLevel) {
    const v = await variantName(tx, row.variantId);
    await notify(tx, "low_stock", `Low stock: ${v.name}`, `${v.sku}: only ${availAfter} left, reorder level ${row.reorderLevel}.`, v.sku);
  }
}

/** Hold stock for a pending (unpaid) order. No movement: stock_quantity does not change. */
export async function reserve(tx: Tx, row: LockedRow, quantity: number) {
  const avail = availableStock(row);
  if (avail < quantity) throw new InsufficientStockError(`Only ${Math.max(0, avail)} ${avail === 1 ? "unit" : "units"} available.`);
  const before = avail;
  row.reservedQuantity += quantity;
  await tx.update(inventory).set({ reservedQuantity: row.reservedQuantity }).where(eq(inventory.variantId, row.variantId));
  await raiseStockAlerts(tx, row, before, availableStock(row));
}
export async function release(tx: Tx, row: LockedRow, quantity: number) {
  row.reservedQuantity = Math.max(0, row.reservedQuantity - quantity);
  await tx.update(inventory).set({ reservedQuantity: row.reservedQuantity }).where(eq(inventory.variantId, row.variantId));
}

const ADJUST_TYPES = ["ADJUSTMENT", "DAMAGED", "LOST", "TRANSFER", "MANUAL"] as const;
export type AdjustType = (typeof ADJUST_TYPES)[number];

/** The one costing method this store uses (brief §27, docs/INVENTORY_COSTING.md): weighted average of the
 *  stock already on hand and the new units coming in. Shared by `restock()` and Phase 8's purchase-receiving
 *  flow (`lib/purchasing/receiving.ts`) so the method can never drift between the two call sites. */
export function weightedAverageCost(oldCostCents: number, oldQty: number, newCostCents: number, newQty: number): number {
  if (oldQty + newQty <= 0) return newCostCents;
  return Math.round((oldCostCents * oldQty + newCostCents * newQty) / (oldQty + newQty));
}

/** RESTOCK from a supplier. A new unit cost updates the variant cost as a weighted average. */
export async function restock(db: Db, actor: Actor, input: { variantId: string; quantity: number; unitCostCents?: number; supplierName?: string; reference?: string; notes?: string }) {
  assertCan(actor, "inventory:write");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new ValidationError("Enter a quantity above zero.");
  if (input.unitCostCents != null && (!Number.isInteger(input.unitCostCents) || input.unitCostCents < 0)) throw new ValidationError("Unit cost must be zero or more.");
  return db.transaction(async (tx) => {
    const row = (await lockInventory(tx, [input.variantId])).get(input.variantId);
    const [variant] = await tx.select().from(productVariants).where(eq(productVariants.id, input.variantId));
    if (!row || !variant) throw new NotFoundError("Variant not found.");
    let supplierId: string | null = null;
    if (input.supplierName) {
      const [s] = await tx.insert(suppliers).values({ name: input.supplierName }).onConflictDoUpdate({ target: suppliers.name, set: { name: input.supplierName } }).returning({ id: suppliers.id });
      supplierId = s?.id ?? null;
    }
    if (input.unitCostCents != null && input.unitCostCents !== variant.costPriceCents) {
      const newCost = weightedAverageCost(variant.costPriceCents, row.stockQuantity, input.unitCostCents, input.quantity);
      await tx.update(productVariants).set({ costPriceCents: newCost }).where(eq(productVariants.id, variant.id));
      await audit(tx, actor, "Changed cost price (weighted average)", "product_variant", variant.sku, { costPriceCents: variant.costPriceCents }, { costPriceCents: newCost });
    }
    const res = await applyMovement(tx, row, {
      variantId: variant.id, quantity: input.quantity, movementType: "RESTOCK", supplierId,
      referenceType: input.reference ? "purchase_order" : null, referenceId: input.reference ?? null,
      unitCostCents: input.unitCostCents ?? variant.costPriceCents, notes: input.notes ?? null, userId: actor.userId,
    });
    await audit(tx, actor, "Changed stock", "product_variant", variant.sku, { stockQuantity: res.stockBefore }, { stockQuantity: res.stockAfter, reason: "RESTOCK" });
    return res;
  });
}

/** Set a counted stock level (cycle count, damage, loss, transfer, manual correction). */
export async function adjustStock(db: Db, actor: Actor, input: { variantId: string; newStockQuantity: number; movementType: AdjustType; notes?: string }) {
  assertCan(actor, "inventory:write");
  if (!ADJUST_TYPES.includes(input.movementType)) throw new ValidationError("Choose a valid reason.");
  if (!Number.isInteger(input.newStockQuantity) || input.newStockQuantity < 0) throw new ValidationError("Stock must be zero or more.");
  return db.transaction(async (tx) => {
    const row = (await lockInventory(tx, [input.variantId])).get(input.variantId);
    if (!row) throw new NotFoundError("Variant not found.");
    const delta = input.newStockQuantity - row.stockQuantity;
    if (delta === 0) return { stockBefore: row.stockQuantity, stockAfter: row.stockQuantity };
    const res = await applyMovement(tx, row, {
      variantId: input.variantId, quantity: delta, movementType: input.movementType,
      referenceType: input.movementType === "TRANSFER" ? "transfer" : "stock_count", notes: input.notes ?? null, userId: actor.userId,
    });
    const v = await variantName(tx, input.variantId);
    await audit(tx, actor, "Changed stock", "product_variant", v.sku, { stockQuantity: res.stockBefore }, { stockQuantity: res.stockAfter, reason: input.movementType });
    return res;
  });
}

export async function setReorderLevel(db: Db, actor: Actor, variantId: string, level: number) {
  assertCan(actor, "inventory:write");
  if (!Number.isInteger(level) || level < 0) throw new ValidationError("Reorder level must be zero or more.");
  await db.transaction(async (tx) => {
    const [before] = await tx.select({ lvl: inventory.reorderLevel }).from(inventory).where(eq(inventory.variantId, variantId)).for("update");
    if (!before) throw new NotFoundError("Variant not found.");
    await tx.update(inventory).set({ reorderLevel: level }).where(eq(inventory.variantId, variantId));
    await audit(tx, actor, "Changed reorder level", "product_variant", variantId, { reorderLevel: before.lvl }, { reorderLevel: level });
  });
}

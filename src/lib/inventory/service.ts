/**
 * Inventory. Every stock change:
 *   1. locks the inventory row (SELECT ... FOR UPDATE),
 *   2. validates the new level (never negative; the DB also enforces this),
 *   3. writes the new level AND an inventory_movements row in the same transaction,
 *   4. raises low / out-of-stock notifications on the transition only.
 */
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Db, DbOrTx, Tx } from "../db/client";
import { inventory, inventoryMovements, productVariants, products, suppliers } from "../db/schema";
import { InsufficientStockError, NotFoundError, ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit, notify } from "../audit";

export type MovementType = typeof inventoryMovements.$inferInsert["type"];
type LockedRow = { variantId: string; onHand: number; reserved: number; reorderLevel: number };

/** Lock inventory rows in a stable order (by id) so concurrent orders cannot deadlock. */
export async function lockInventory(tx: Tx, variantIds: string[]): Promise<Map<string, LockedRow>> {
  const ids = [...new Set(variantIds)].sort();
  if (!ids.length) return new Map();
  const rows = await tx.select({ variantId: inventory.variantId, onHand: inventory.onHand, reserved: inventory.reserved, reorderLevel: inventory.reorderLevel })
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
  type: MovementType;
  reference?: string | null;
  orderId?: string | null;
  supplierId?: string | null;
  unitCostCents?: number | null;
  notes?: string | null;
  userId?: string | null;
  /** Change to `reserved` applied atomically with on_hand (e.g. -2 when a reserved order is paid). */
  reservedDelta?: number;
  /** Only for importing history (seed). Defaults to now. */
  at?: Date;
};

/** Low-level: caller must already hold the row lock (via lockInventory) inside `tx`. */
export async function applyMovement(tx: Tx, row: LockedRow, m: MoveInput) {
  if (!Number.isInteger(m.quantity) || m.quantity === 0) throw new ValidationError("Quantity must be a non-zero whole number.");
  const before = row.onHand;
  const after = before + m.quantity;
  const reserved = row.reserved + (m.reservedDelta ?? 0);
  if (after < 0) {
    const v = await variantName(tx, m.variantId);
    throw new InsufficientStockError(`${v.name} (${v.sku}) has only ${before} in stock.`);
  }
  if (reserved < 0 || reserved > after) throw new InsufficientStockError("Stock is reserved for pending orders.");
  await tx.update(inventory).set({ onHand: after, reserved }).where(eq(inventory.variantId, m.variantId));
  await tx.insert(inventoryMovements).values({
    variantId: m.variantId, type: m.type, quantity: m.quantity, before, after,
    reference: m.reference ?? null, orderId: m.orderId ?? null, supplierId: m.supplierId ?? null,
    unitCostCents: m.unitCostCents ?? null, notes: m.notes ?? null, userId: m.userId ?? null,
    ...(m.at ? { createdAt: m.at } : {}),
  });
  const availBefore = before - row.reserved, availAfter = after - reserved;
  if (availAfter < availBefore) {
    if (availAfter <= 0 && availBefore > 0) {
      const v = await variantName(tx, m.variantId);
      await notify(tx, "out_of_stock", `Out of stock: ${v.name}`, `${v.sku} has no units available.`, v.sku);
    } else if (availAfter <= row.reorderLevel && availBefore > row.reorderLevel) {
      const v = await variantName(tx, m.variantId);
      await notify(tx, "low_stock", `Low stock: ${v.name}`, `${v.sku}: only ${availAfter} left, reorder level ${row.reorderLevel}.`, v.sku);
    }
  }
  row.onHand = after;
  row.reserved = reserved;
  return { before, after };
}

/** Reserve stock for a pending (unpaid) order. No movement is written: on-hand does not change. */
export async function reserve(tx: Tx, row: LockedRow, quantity: number) {
  if (row.onHand - row.reserved < quantity) throw new InsufficientStockError("Not enough stock available.");
  row.reserved += quantity;
  await tx.update(inventory).set({ reserved: row.reserved }).where(eq(inventory.variantId, row.variantId));
}
export async function release(tx: Tx, row: LockedRow, quantity: number) {
  row.reserved = Math.max(0, row.reserved - quantity);
  await tx.update(inventory).set({ reserved: row.reserved }).where(eq(inventory.variantId, row.variantId));
}

const ADJUST_TYPES = ["ADJUSTMENT", "DAMAGED", "LOST", "TRANSFER", "MANUAL"] as const;

/** RESTOCK: receive units from a supplier. A new unit cost updates the variant cost as a weighted average. */
export async function restock(db: Db, actor: Actor, input: { variantId: string; quantity: number; unitCostCents?: number; supplierName?: string; reference?: string; notes?: string; receivedAt?: Date }) {
  assertCan(actor, "inventory:write");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new ValidationError("Enter a quantity above zero.");
  if (input.unitCostCents != null && (!Number.isInteger(input.unitCostCents) || input.unitCostCents < 0)) throw new ValidationError("Unit cost must be zero or more.");
  return db.transaction(async (tx) => {
    const rows = await lockInventory(tx, [input.variantId]);
    const row = rows.get(input.variantId);
    if (!row) throw new NotFoundError("Variant not found.");
    const [variant] = await tx.select().from(productVariants).where(eq(productVariants.id, input.variantId));
    if (!variant) throw new NotFoundError("Variant not found.");
    let supplierId: string | null = null;
    if (input.supplierName) {
      const [s] = await tx.insert(suppliers).values({ name: input.supplierName }).onConflictDoUpdate({ target: suppliers.name, set: { name: input.supplierName } }).returning({ id: suppliers.id });
      supplierId = s?.id ?? null;
    }
    if (input.unitCostCents != null && input.unitCostCents !== variant.costCents) {
      const newCost = Math.round((variant.costCents * row.onHand + input.unitCostCents * input.quantity) / (row.onHand + input.quantity));
      await tx.update(productVariants).set({ costCents: newCost }).where(eq(productVariants.id, variant.id));
      await audit(tx, actor, "Updated cost (weighted average)", "variant", variant.sku, { costCents: variant.costCents }, { costCents: newCost });
    }
    const res = await applyMovement(tx, row, {
      variantId: variant.id, quantity: input.quantity, type: "PURCHASE", supplierId,
      unitCostCents: input.unitCostCents ?? variant.costCents, reference: input.reference ?? null,
      notes: [input.notes, input.receivedAt ? `received ${input.receivedAt.toISOString().slice(0, 10)}` : null].filter(Boolean).join("; ") || null,
      userId: actor.userId,
    });
    await audit(tx, actor, "Restocked", "variant", variant.sku, { onHand: res.before }, { onHand: res.after });
    return res;
  });
}

/** Set a counted stock level (cycle count, damage, loss, transfer). */
export async function adjustStock(db: Db, actor: Actor, input: { variantId: string; newOnHand: number; type: (typeof ADJUST_TYPES)[number]; notes?: string }) {
  assertCan(actor, "inventory:write");
  if (!ADJUST_TYPES.includes(input.type)) throw new ValidationError("Choose a valid reason.");
  if (!Number.isInteger(input.newOnHand) || input.newOnHand < 0) throw new ValidationError("Stock must be zero or more.");
  return db.transaction(async (tx) => {
    const row = (await lockInventory(tx, [input.variantId])).get(input.variantId);
    if (!row) throw new NotFoundError("Variant not found.");
    const delta = input.newOnHand - row.onHand;
    if (delta === 0) return { before: row.onHand, after: row.onHand };
    const res = await applyMovement(tx, row, { variantId: input.variantId, quantity: delta, type: input.type, notes: input.notes ?? null, userId: actor.userId });
    const v = await variantName(tx, input.variantId);
    await audit(tx, actor, "Changed stock", "variant", v.sku, { onHand: res.before }, { onHand: res.after, reason: input.type });
    return res;
  });
}

export async function setReorderLevel(db: Db, actor: Actor, variantId: string, level: number) {
  assertCan(actor, "inventory:write");
  if (!Number.isInteger(level) || level < 0) throw new ValidationError("Reorder level must be zero or more.");
  await db.update(inventory).set({ reorderLevel: level }).where(eq(inventory.variantId, variantId));
}

export const available = sql<number>`(${inventory.onHand} - ${inventory.reserved})`;
export const stockStatus = (avail: number, reorder: number) => (avail <= 0 ? "out" : avail <= reorder ? "low" : "in") as "out" | "low" | "in";

/**
 * Goods receiving and quality control (brief §19-26). Only the ACCEPTED quantity ever becomes sellable
 * stock — damaged/rejected units never touch `inventory.stock_quantity` (they were never in it), so no
 * DAMAGED inventory movement is written for them; the receipt line itself is their permanent record
 * (brief §25's own "receiving record with damaged quantity" alternative). Reuses the exact same low-level
 * primitives and weighted-average costing method as `lib/inventory/service.ts`'s `restock()` — never a
 * second, divergent implementation. See docs/PURCHASING.md.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { productVariants, products, purchaseOrderItems, purchaseOrders, purchaseReceiptItems, purchaseReceipts, supplierProducts } from "../db/schema";
import { ValidationError, NotFoundError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";
import { applyMovement, lockInventory, weightedAverageCost } from "../inventory/service";

export type ReceiveLine = { purchaseOrderItemId: string; acceptedQuantity: number; damagedQuantity?: number; rejectedQuantity?: number; notes?: string };
export type ReceiveInput = { purchaseOrderId: string; lines: ReceiveLine[]; notes?: string };

function validateLines(lines: ReceiveLine[]) {
  if (!lines.length) throw new ValidationError("Enter at least one received line.");
  for (const l of lines) {
    const accepted = l.acceptedQuantity, damaged = l.damagedQuantity ?? 0, rejected = l.rejectedQuantity ?? 0;
    if (![accepted, damaged, rejected].every((n) => Number.isInteger(n) && n >= 0)) throw new ValidationError("Quantities must be whole numbers, zero or more.");
    if (accepted + damaged + rejected <= 0) throw new ValidationError("Enter a received quantity for at least one line.");
  }
}

/**
 * Confirms one receiving event against a PO (brief §20-23). Runs in one transaction: locks every affected
 * variant's inventory row, validates `received ≤ remaining` per line (brief §21), increases stock by the
 * accepted quantity only (via `applyMovement`, type PURCHASE), updates the variant's cost as a weighted
 * average (brief §26-27 — same formula `restock()` uses), rolls the PO's per-item `received_quantity`
 * forward, recomputes the PO's overall status (PARTIALLY_RECEIVED / RECEIVED), and updates the
 * supplier-product relationship's last purchase price/date if one exists. Never creates a duplicate
 * inventory movement — each receipt is its own event, and `received_quantity` can never exceed `quantity`
 * (enforced by both this function and a database CHECK constraint).
 */
export async function receivePurchaseOrder(db: Db, actor: Actor, input: ReceiveInput) {
  assertCan(actor, "inventory:write");
  validateLines(input.lines);
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, input.purchaseOrderId)).for("update");
    if (!po) throw new NotFoundError("Purchase order not found.");
    if (!["APPROVED", "ORDERED", "PARTIALLY_RECEIVED"].includes(po.status)) throw new ValidationError(`A purchase order that is ${po.status} cannot receive stock.`);

    const itemIds = input.lines.map((l) => l.purchaseOrderItemId);
    const items = await tx.select().from(purchaseOrderItems).where(and(inArray(purchaseOrderItems.id, itemIds), eq(purchaseOrderItems.purchaseOrderId, po.id)));
    const itemById = new Map(items.map((i) => [i.id, i]));
    for (const l of input.lines) {
      const item = itemById.get(l.purchaseOrderItemId);
      if (!item) throw new ValidationError("One of the selected lines doesn't belong to this purchase order.");
      const total = l.acceptedQuantity + (l.damagedQuantity ?? 0) + (l.rejectedQuantity ?? 0);
      const remaining = item.quantity - item.receivedQuantity;
      if (total > remaining) throw new ValidationError(`Received quantity for ${item.supplierSku ?? "a line"} can't exceed the remaining ${remaining} units.`);
    }

    const [receipt] = await tx.insert(purchaseReceipts).values({ purchaseOrderId: po.id, receivedByUserId: actor.userId, notes: input.notes ?? "" }).returning();

    const variantIds = [...new Set(items.map((i) => i.variantId))];
    const locked = await lockInventory(tx, variantIds);

    for (const l of input.lines) {
      const item = itemById.get(l.purchaseOrderItemId)!;
      const accepted = l.acceptedQuantity, damaged = l.damagedQuantity ?? 0, rejected = l.rejectedQuantity ?? 0;
      await tx.insert(purchaseReceiptItems).values({
        purchaseReceiptId: receipt!.id, purchaseOrderItemId: item.id, acceptedQuantity: accepted, damagedQuantity: damaged, rejectedQuantity: rejected,
        unitCostCents: item.unitCostCents, notes: l.notes ?? null,
      });
      await tx.update(purchaseOrderItems).set({ receivedQuantity: item.receivedQuantity + accepted + damaged + rejected }).where(eq(purchaseOrderItems.id, item.id));

      if (accepted > 0) {
        const row = locked.get(item.variantId)!;
        const [variant] = await tx.select().from(productVariants).where(eq(productVariants.id, item.variantId));
        if (variant && item.unitCostCents !== variant.costPriceCents) {
          const newCost = weightedAverageCost(variant.costPriceCents, row.stockQuantity, item.unitCostCents, accepted);
          await tx.update(productVariants).set({ costPriceCents: newCost }).where(eq(productVariants.id, variant.id));
          await audit(tx, actor, "Changed cost price (weighted average)", "product_variant", variant.sku, { costPriceCents: variant.costPriceCents }, { costPriceCents: newCost });
        }
        await applyMovement(tx, row, {
          variantId: item.variantId, quantity: accepted, movementType: "PURCHASE", supplierId: po.supplierId,
          referenceType: "purchase_order", referenceId: po.poNumber, unitCostCents: item.unitCostCents, userId: actor.userId,
          notes: damaged || rejected ? `Received ${accepted + damaged + rejected}, accepted ${accepted}${damaged ? `, damaged ${damaged}` : ""}${rejected ? `, rejected ${rejected}` : ""}.` : null,
        });
      }
      await tx.update(supplierProducts).set({ lastPurchasePriceCents: item.unitCostCents, lastPurchaseDate: new Date() })
        .where(sql`${supplierProducts.supplierId} = ${po.supplierId} and ${supplierProducts.variantId} = ${item.variantId}`);
    }

    // Recompute the PO's overall status from every item's running total — never assumed from just this receipt.
    const [totals] = await tx.select({
      orderedTotal: sql<string>`coalesce(sum(quantity),0)`, receivedTotal: sql<string>`coalesce(sum(received_quantity),0)`,
    }).from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, po.id));
    const orderedTotal = Number(totals?.orderedTotal ?? 0), receivedTotal = Number(totals?.receivedTotal ?? 0);
    const nextStatus = receivedTotal >= orderedTotal ? "RECEIVED" : receivedTotal > 0 ? "PARTIALLY_RECEIVED" : po.status;
    if (nextStatus !== po.status) await tx.update(purchaseOrders).set({ status: nextStatus as typeof po.status }).where(eq(purchaseOrders.id, po.id));

    await audit(tx, actor, "Received purchase order goods", "purchase_order", po.poNumber, undefined, { receiptId: receipt!.id, lines: input.lines.length, status: nextStatus });
    return { receipt: receipt!, status: nextStatus };
  });
}

export async function getReceivingContext(db: DbOrTx, purchaseOrderId: string) {
  const items = await db.select({
    id: purchaseOrderItems.id, variantId: purchaseOrderItems.variantId, sku: productVariants.sku, productName: products.name, quantity: purchaseOrderItems.quantity,
    receivedQuantity: purchaseOrderItems.receivedQuantity, unitCostCents: purchaseOrderItems.unitCostCents,
  }).from(purchaseOrderItems).innerJoin(productVariants, eq(productVariants.id, purchaseOrderItems.variantId)).innerJoin(products, eq(products.id, productVariants.productId)).where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId));
  return items.map((i) => ({ ...i, remaining: i.quantity - i.receivedQuantity }));
}

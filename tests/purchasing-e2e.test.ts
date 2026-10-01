/**
 * Brief §53: full end-to-end purchasing scenario. Aurora Signet Ring, 100 units @ $50 from Supplier A,
 * through create → approve → order → partial receive (with damage) → complete receive, verifying inventory,
 * cost, PO status, and supplier analytics all update together with no duplicate inventory movement.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, ALL_TIME } from "./helpers";
import { createSupplier, upsertSupplierProduct } from "@/lib/purchasing/suppliers";
import { createPurchaseOrder, setPurchaseOrderStatus, getPurchaseOrder } from "@/lib/purchasing/orders";
import { receivePurchaseOrder } from "@/lib/purchasing/receiving";
import { getSupplierPerformance } from "@/lib/analytics/purchasing";
import { inventory, inventoryMovements, productVariants } from "@/lib/db/schema";

const owner = { userId: null, name: "seed", role: "OWNER" as const };

describe("brief §53: end-to-end purchasing scenario", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("Aurora Signet Ring, 100 units @ $50 from Supplier A: create -> approve -> order -> partial receive with damage -> complete", async () => {
    // 1. Create supplier
    const supplierA = await createSupplier(db, owner, { name: "Supplier A" });
    const { variant } = await makeVariant({ name: "Aurora Signet Ring", stock: 0, priceCents: 20_000, costCents: 4_800 });

    // 2. Add supplier-product relationship
    await upsertSupplierProduct(db, owner, { supplierId: supplierA.id, variantId: variant.id, purchasePriceCents: 5_000, preferredSupplier: true });

    // 3. Create PO
    const po = await createPurchaseOrder(db, owner, { supplierId: supplierA.id, items: [{ variantId: variant.id, quantity: 100, unitCostCents: 5_000 }] });
    expect(po.status).toBe("DRAFT");
    expect(po.totalCents).toBe(500_000);

    // 4. Submit for approval
    await setPurchaseOrderStatus(db, owner, po.id, "PENDING_APPROVAL");
    // 5. Approve PO
    const approved = await setPurchaseOrderStatus(db, owner, po.id, "APPROVED");
    expect(approved.status).toBe("APPROVED");
    // 6. Mark ordered
    await setPurchaseOrderStatus(db, owner, po.id, "ORDERED");

    // 7. Receive 60, 8. accept 58, 9. mark 2 damaged
    const full1 = await getPurchaseOrder(db, po.id);
    await receivePurchaseOrder(db, owner, { purchaseOrderId: po.id, lines: [{ purchaseOrderItemId: full1!.items[0]!.id, acceptedQuantity: 58, damagedQuantity: 2 }] });

    // 10. Inventory increases by 58
    let [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(58);
    // 11. PO becomes PARTIALLY_RECEIVED
    let full2 = await getPurchaseOrder(db, po.id);
    expect(full2!.po.status).toBe("PARTIALLY_RECEIVED");

    // 12. Receive remaining 40, 13. accept 40
    await receivePurchaseOrder(db, owner, { purchaseOrderId: po.id, lines: [{ purchaseOrderItemId: full1!.items[0]!.id, acceptedQuantity: 40 }] });

    // 14. PO becomes RECEIVED
    full2 = await getPurchaseOrder(db, po.id);
    expect(full2!.po.status).toBe("RECEIVED");

    // 15. Total inventory increase = 98
    [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(98);

    // 16. Cost records are created (weighted average: 0 existing + 98 accepted @ $50 => $50)
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variant.id));
    expect(v!.costPriceCents).toBe(5_000);

    // Verify no duplicate inventory movement: exactly 2 PURCHASE movements (one per receiving event)
    const movements = await db.select().from(inventoryMovements).where(eq(inventoryMovements.variantId, variant.id));
    const purchaseMovements = movements.filter((m) => m.movementType === "PURCHASE");
    expect(purchaseMovements).toHaveLength(2);
    expect(purchaseMovements.reduce((a, m) => a + m.quantity, 0)).toBe(98);

    // 17. Inventory value updates (98 units @ $50 = $4,900)
    expect(inv!.stockQuantity * v!.costPriceCents).toBe(490_000);

    // 18. Supplier analytics update
    const perf = await getSupplierPerformance(db, ALL_TIME);
    const row = perf.find((p) => p.supplierId === supplierA.id)!;
    expect(row.unitsPurchased).toBe(100); // 98 accepted + 2 damaged
    expect(row.damagedQuantity).toBe(2);
    expect(row.totalSpendCents).toBe(500_000);
  });
});

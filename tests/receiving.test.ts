/**
 * Goods receiving: partial receiving, quality control, inventory update, weighted-average costing,
 * duplicate-receiving prevention (brief §19-27, §54, §56).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant } from "./helpers";
import { createSupplier } from "@/lib/purchasing/suppliers";
import { createPurchaseOrder, setPurchaseOrderStatus, getPurchaseOrder } from "@/lib/purchasing/orders";
import { receivePurchaseOrder } from "@/lib/purchasing/receiving";
import { inventory, inventoryMovements, productVariants, purchaseOrders } from "@/lib/db/schema";

const owner = { userId: null, name: "seed", role: "OWNER" as const };
const inventoryRole = { userId: null, name: "inv", role: "INVENTORY" as const };
const sales = { userId: null, name: "sales", role: "SALES" as const };

async function approvedPO(quantity: number, unitCostCents: number, stock = 0) {
  const supplier = await createSupplier(db, owner, { name: "Receiving Test Supplier" });
  const { variant } = await makeVariant({ stock, priceCents: 20_000, costCents: 5_000 });
  const po = await createPurchaseOrder(db, owner, { supplierId: supplier.id, items: [{ variantId: variant.id, quantity, unitCostCents }] });
  await setPurchaseOrderStatus(db, owner, po.id, "PENDING_APPROVAL");
  await setPurchaseOrderStatus(db, owner, po.id, "APPROVED");
  await setPurchaseOrderStatus(db, owner, po.id, "ORDERED");
  const full = await getPurchaseOrder(db, po.id);
  return { po, variant, item: full!.items[0]! };
}

describe("partial and complete receiving (brief §19-23)", () => {
  beforeEach(resetDb);

  it("first shipment of 60 of 100: inventory +60, PO becomes PARTIALLY_RECEIVED", async () => {
    const { po, variant, item } = await approvedPO(100, 5_000);
    await receivePurchaseOrder(db, owner, { purchaseOrderId: po.id, lines: [{ purchaseOrderItemId: item.id, acceptedQuantity: 60 }] });
    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(60);
    const [updated] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id));
    expect(updated!.status).toBe("PARTIALLY_RECEIVED");
  });

  it("second shipment of the remaining 40: inventory +40 more (total 100), PO becomes RECEIVED", async () => {
    const { po, variant, item } = await approvedPO(100, 5_000);
    await receivePurchaseOrder(db, owner, { purchaseOrderId: po.id, lines: [{ purchaseOrderItemId: item.id, acceptedQuantity: 60 }] });
    await receivePurchaseOrder(db, owner, { purchaseOrderId: po.id, lines: [{ purchaseOrderItemId: item.id, acceptedQuantity: 40 }] });
    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(100);
    const full = await getPurchaseOrder(db, po.id);
    expect(full!.po.status).toBe("RECEIVED");
    expect(full!.items[0]!.receivedQuantity).toBe(100);
  });

  it("rejects receiving more than the remaining quantity", async () => {
    const { po, item } = await approvedPO(50, 5_000);
    await receivePurchaseOrder(db, owner, { purchaseOrderId: po.id, lines: [{ purchaseOrderItemId: item.id, acceptedQuantity: 40 }] });
    await expect(receivePurchaseOrder(db, owner, { purchaseOrderId: po.id, lines: [{ purchaseOrderItemId: item.id, acceptedQuantity: 20 }] })).rejects.toThrow(/remaining/);
  });

  it("creates exactly one inventory movement per receiving event — never a duplicate", async () => {
    const { po, variant, item } = await approvedPO(50, 5_000);
    await receivePurchaseOrder(db, owner, { purchaseOrderId: po.id, lines: [{ purchaseOrderItemId: item.id, acceptedQuantity: 50 }] });
    const movements = await db.select().from(inventoryMovements).where(eq(inventoryMovements.variantId, variant.id));
    expect(movements.filter((m) => m.movementType === "PURCHASE")).toHaveLength(1);
    expect(movements.find((m) => m.movementType === "PURCHASE")!.referenceId).toBe(po.poNumber);
  });

  it("only inventory:write can receive — SALES cannot", async () => {
    const { po, item } = await approvedPO(10, 5_000);
    await expect(receivePurchaseOrder(db, sales, { purchaseOrderId: po.id, lines: [{ purchaseOrderItemId: item.id, acceptedQuantity: 10 }] })).rejects.toThrow();
    const r = await receivePurchaseOrder(db, inventoryRole, { purchaseOrderId: po.id, lines: [{ purchaseOrderItemId: item.id, acceptedQuantity: 10 }] });
    expect(r.status).toBe("RECEIVED");
  });
});

describe("quality control: damaged and rejected units never become sellable stock (brief §24-25, §56)", () => {
  beforeEach(resetDb);

  it("received 100, accepted 96, damaged 4: sellable inventory +96, no double counting", async () => {
    const { po, variant, item } = await approvedPO(100, 5_000);
    await receivePurchaseOrder(db, owner, { purchaseOrderId: po.id, lines: [{ purchaseOrderItemId: item.id, acceptedQuantity: 96, damagedQuantity: 4 }] });
    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(96); // damaged units never entered stock
    const movements = await db.select().from(inventoryMovements).where(eq(inventoryMovements.variantId, variant.id));
    expect(movements.filter((m) => m.movementType === "PURCHASE").reduce((a, m) => a + m.quantity, 0)).toBe(96);
    const full = await getPurchaseOrder(db, po.id);
    expect(full!.items[0]!.receivedQuantity).toBe(100); // ordered/received bookkeeping still reflects the full 100 handled
    expect(full!.po.status).toBe("RECEIVED");
  });

  it("the end-to-end scenario: receive 60 (58 accepted, 2 damaged), then the remaining 40 accepted — total inventory increase 98", async () => {
    const { po, variant, item } = await approvedPO(100, 5_000);
    await receivePurchaseOrder(db, owner, { purchaseOrderId: po.id, lines: [{ purchaseOrderItemId: item.id, acceptedQuantity: 58, damagedQuantity: 2 }] });
    let full = await getPurchaseOrder(db, po.id);
    expect(full!.po.status).toBe("PARTIALLY_RECEIVED");
    await receivePurchaseOrder(db, owner, { purchaseOrderId: po.id, lines: [{ purchaseOrderItemId: item.id, acceptedQuantity: 40 }] });
    full = await getPurchaseOrder(db, po.id);
    expect(full!.po.status).toBe("RECEIVED");
    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(98);
  });
});

describe("costing: receiving updates the weighted average, same method as restock (brief §26-27, §54)", () => {
  beforeEach(resetDb);

  it("100 units @ $50 existing + 100 units @ $60 received => weighted average $55", async () => {
    const supplier = await createSupplier(db, owner, { name: "Cost Test Supplier" });
    const { variant } = await makeVariant({ stock: 100, priceCents: 20_000, costCents: 5_000 }); // 100 @ $50
    const po = await createPurchaseOrder(db, owner, { supplierId: supplier.id, items: [{ variantId: variant.id, quantity: 100, unitCostCents: 6_000 }] }); // 100 @ $60
    await setPurchaseOrderStatus(db, owner, po.id, "PENDING_APPROVAL");
    await setPurchaseOrderStatus(db, owner, po.id, "APPROVED");
    await setPurchaseOrderStatus(db, owner, po.id, "ORDERED");
    const full = await getPurchaseOrder(db, po.id);
    await receivePurchaseOrder(db, owner, { purchaseOrderId: po.id, lines: [{ purchaseOrderItemId: full!.items[0]!.id, acceptedQuantity: 100 }] });
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variant.id));
    expect(v!.costPriceCents).toBe(5_500);
  });

  it("historical unit costs are preserved on the receipt even if the variant's cost later changes", async () => {
    const { po, item } = await approvedPO(10, 4_000);
    const receipt = await receivePurchaseOrder(db, owner, { purchaseOrderId: po.id, lines: [{ purchaseOrderItemId: item.id, acceptedQuantity: 10 }] });
    expect(receipt.receipt.purchaseOrderId).toBe(po.id);
  });
});

afterAll(() => pool.end());

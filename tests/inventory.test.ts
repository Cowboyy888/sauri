import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, makeStaff, buyer } from "./helpers";
import { adjustStock, restock, setReorderLevel } from "@/lib/inventory/service";
import { placeOrder } from "@/lib/orders/service";
import { getInventory, getInventoryValue, getLowStockProducts, getOutOfStockProducts } from "@/lib/analytics/service";
import { auditLogs, inventory, inventoryMovements, productVariants } from "@/lib/db/schema";

describe("inventory", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("restock adds units, records a RESTOCK movement, and updates cost as a weighted average", async () => {
    const staff = await makeStaff("INVENTORY");
    const { variant } = await makeVariant({ stock: 10, costCents: 5_000 });
    await restock(db, staff, { variantId: variant.id, quantity: 10, unitCostCents: 7_000, supplierName: "Linden Castings", reference: "PO-4210" });
    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variant.id));
    expect(inv!.stockQuantity).toBe(20);
    expect(v!.costPriceCents).toBe(6_000);
    expect(await getInventoryValue(db)).toBe(20 * 6_000);
    const [m] = await db.select().from(inventoryMovements);
    expect(m).toMatchObject({ movementType: "RESTOCK", quantity: 10, stockBefore: 10, stockAfter: 20, referenceType: "purchase_order", referenceId: "PO-4210", userId: staff.userId });
    const actions = (await db.select().from(auditLogs)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["Changed stock", "Changed cost price (weighted average)"]));
  });

  it("adjustments record the reason, never go below zero, and are audited with old and new values", async () => {
    const staff = await makeStaff("INVENTORY");
    const { variant } = await makeVariant({ stock: 10 });
    await adjustStock(db, staff, { variantId: variant.id, newStockQuantity: 8, movementType: "DAMAGED", notes: "Clasp defect" });
    await expect(adjustStock(db, staff, { variantId: variant.id, newStockQuantity: -1, movementType: "ADJUSTMENT" })).rejects.toThrow(/zero or more/);
    const moves = await db.select().from(inventoryMovements);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ movementType: "DAMAGED", quantity: -2, stockBefore: 10, stockAfter: 8, notes: "Clasp defect" });
    const [a] = await db.select().from(auditLogs);
    expect(a).toMatchObject({ action: "Changed stock", oldValue: { stockQuantity: 10 }, newValue: { stockQuantity: 8, reason: "DAMAGED" } });
  });

  it("status, low and out-of-stock lists use available = stock − reserved", async () => {
    const staff = await makeStaff("INVENTORY");
    const a = await makeVariant({ code: "AAA", stock: 6, reorder: 5 });
    const b = await makeVariant({ code: "BBB", stock: 1, reorder: 5 });
    await makeVariant({ code: "CCC", stock: 50, reorder: 5 });
    await placeOrder(db, { lines: [{ variantId: a.variant.id, quantity: 2 }], customer: buyer }); // reserves 2 → available 4 (low)
    await setReorderLevel(db, staff, b.variant.id, 0);
    await adjustStock(db, staff, { variantId: b.variant.id, newStockQuantity: 0, movementType: "LOST" });
    expect((await getLowStockProducts(db)).map((x) => x.sku)).toEqual(["RNG-AAA-YG-6"]);
    expect((await getOutOfStockProducts(db)).map((x) => x.sku)).toEqual(["RNG-BBB-YG-6"]);
    const row = (await getInventory(db)).find((x) => x.sku === "RNG-AAA-YG-6")!;
    expect(row).toMatchObject({ stockQuantity: 6, reservedQuantity: 2, availableStock: 4, status: "LOW_STOCK" });
  });

  it("forecast: average daily sales, estimated days remaining, suggested reorder (estimates)", async () => {
    const staff = await makeStaff("SALES");
    const { variant } = await makeVariant({ stock: 100, reorder: 5 });
    for (let i = 0; i < 6; i++) await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 5 }], customer: { email: `c${i}@example.com`, name: "C" }, status: "paid", channel: "PHYSICAL_STORE" }, staff);
    const [row] = await getInventory(db);
    expect(row).toMatchObject({ stockQuantity: 70, sold30: 30, sold7: 30 });
    expect(row!.forecast).toEqual({ avgDailySales: 1, estimatedDaysRemaining: 70, suggestedReorderQuantity: 0 });
  });
});

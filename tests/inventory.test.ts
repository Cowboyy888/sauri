import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, makeStaff, buyer } from "./helpers";
import { adjustStock, restock } from "@/lib/inventory/service";
import { placeOrder } from "@/lib/orders/service";
import { getInventory, getInventoryValue } from "@/lib/analytics/service";
import { auditLogs, inventory, inventoryMovements, productVariants } from "@/lib/db/schema";
import { can } from "@/lib/auth/permissions";

describe("inventory", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("restock adds units, records a PURCHASE, and updates cost as a weighted average", async () => {
    const staff = await makeStaff("INVENTORY");
    const { variant } = await makeVariant(db, { stock: 10, costCents: 5_000 });
    await restock(db, staff, { variantId: variant.id, quantity: 10, unitCostCents: 7_000, supplierName: "Linden Castings", reference: "PO-4210" });
    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variant.id));
    expect(inv!.onHand).toBe(20);
    expect(v!.costCents).toBe(6_000);
    expect(await getInventoryValue(db)).toBe(20 * 6_000);
    const [m] = await db.select().from(inventoryMovements);
    expect(m).toMatchObject({ type: "PURCHASE", quantity: 10, before: 10, after: 20, reference: "PO-4210" });
    expect((await db.select().from(auditLogs)).map((a) => a.action)).toContain("Restocked");
  });

  it("adjustments record the reason and can never go below zero", async () => {
    const staff = await makeStaff("INVENTORY");
    const { variant } = await makeVariant(db, { stock: 10 });
    await adjustStock(db, staff, { variantId: variant.id, newOnHand: 8, type: "DAMAGED", notes: "Clasp defect" });
    await expect(adjustStock(db, staff, { variantId: variant.id, newOnHand: -1, type: "ADJUSTMENT" })).rejects.toThrow(/zero or more/);
    const moves = await db.select().from(inventoryMovements);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ type: "DAMAGED", quantity: -2, before: 10, after: 8 });
  });

  it("roles are enforced on the server", async () => {
    const sales = await makeStaff("SALES");
    const viewer = await makeStaff("VIEWER", "viewer2");
    const { variant } = await makeVariant(db, { stock: 10 });
    await expect(restock(db, sales, { variantId: variant.id, quantity: 5 })).rejects.toThrow(/cannot perform inventory:write/);
    await expect(adjustStock(db, viewer, { variantId: variant.id, newOnHand: 0, type: "LOST" })).rejects.toThrow(/cannot/);
    expect(can("ADMIN", "settings:write")).toBe(false);
    expect(can("ADMIN", "orders:write")).toBe(true);
    expect(can("INVENTORY", "orders:read")).toBe(false);
    expect(can("VIEWER", "dashboard:read")).toBe(true);
  });

  it("forecast: average daily sales, days remaining and a suggested reorder (estimates)", async () => {
    const { variant } = await makeVariant(db, { stock: 100, reorder: 5 });
    for (let i = 0; i < 6; i++) await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 5 }], customer: { email: `c${i}@example.com`, name: "C" }, status: "paid", channel: "manual" });
    const [row] = await getInventory(db);
    expect(row).toMatchObject({ onHand: 70, sold30: 30, status: "in" });
    expect(row!.forecast.avgDaily).toBe(1);
    expect(row!.forecast.daysRemaining).toBe(70);
    expect(row!.forecast.suggestedReorder).toBe(0); // 70 on hand already covers 45 days + reorder level
    void buyer;
  });
});

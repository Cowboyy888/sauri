/**
 * Brief §12 — the business test that must pass.
 * Aurora Ring: cost $50, price $100, stock 100. A customer buys 3.
 * Expected: stock 97, revenue $300, COGS $150, gross profit $150, gross margin 50%, inventory value $4,850.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, makeStaff, buyer, ALL_TIME } from "./helpers";
import { markOrderPaid, placeOrder } from "@/lib/orders/service";
import { getCOGS, getGrossMargin, getGrossProfit, getInventoryValue, getMetrics, getRevenue } from "@/lib/analytics/service";
import { inventory, inventoryMovements, orderItems, orders } from "@/lib/db/schema";

describe("business test (brief §12)", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it.each(["MANUAL_ORDER", "WEBSITE"])("Aurora Ring, buy 3 via %s → 97 / $300 / $150 / $150 / 50% / $4,850", async (channel) => {
    const staff = await makeStaff("SALES");
    const { variant } = await makeVariant({ stock: 100, costCents: 5_000, priceCents: 10_000 });

    if (channel === "WEBSITE") {
      // Storefront flow: checkout reserves, the payment provider confirms.
      const o = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 3 }], channel, customer: buyer });
      await markOrderPaid(db, o.id, { providerRef: "pi_test" });
    } else {
      await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 3 }], channel, customer: buyer, status: "paid" }, staff);
    }

    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(97);
    expect(inv!.reservedQuantity).toBe(0);
    expect(await getRevenue(db, ALL_TIME)).toBe(30_000);
    expect(await getCOGS(db, ALL_TIME)).toBe(15_000);
    expect(await getGrossProfit(db, ALL_TIME)).toBe(15_000);
    expect(await getGrossMargin(db, ALL_TIME)).toBe(50);
    expect(await getInventoryValue(db)).toBe(485_000);
    expect((await getMetrics(db, ALL_TIME)).averageOrderValueCents).toBe(30_000);

    // The order and its line carry the same figures as a snapshot.
    const [o] = await db.select().from(orders);
    expect(o).toMatchObject({ orderNumber: "ORD-10001", status: "paid", paymentStatus: "paid", fulfillmentStatus: "unfulfilled", costTotalCents: 15_000, grossProfitCents: 15_000, grossMargin: 50 });
    const [line] = await db.select().from(orderItems);
    expect(line).toMatchObject({ productNameSnapshot: "Aurora Ring", skuSnapshot: "RNG-AUR-YG-6", quantity: 3, unitPriceCents: 10_000, unitCostCents: 5_000, lineTotalCents: 30_000, lineCostCents: 15_000, lineProfitCents: 15_000 });

    const moves = await db.select().from(inventoryMovements);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ movementType: "SALE", quantity: -3, stockBefore: 100, stockAfter: 97, referenceType: "order", referenceId: "ORD-10001" });
  });
});

/**
 * §57 IMPORTANT BUSINESS TEST — must pass.
 * 100 units, cost $50, price $100, customer buys 3.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, buyer } from "./helpers";
import { placeOrder } from "@/lib/orders/service";
import { getInventoryValue, getMetrics } from "@/lib/analytics/service";
import { inventory, inventoryMovements } from "@/lib/db/schema";

const ALL_TIME = { from: new Date("2000-01-01"), to: new Date("2100-01-01") };

describe("business test (§57)", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("100 units, cost $50, price $100, buy 3 → inventory 97, revenue $300, COGS $150, GP $150, margin 50%, value $4,850", async () => {
    const { variant } = await makeVariant(db, { stock: 100, costCents: 5_000, priceCents: 10_000 });

    // A manual order: no card fee and no carrier cost, exactly as the brief's arithmetic assumes.
    await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 3 }], channel: "manual", customer: buyer, status: "paid" });

    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    const m = await getMetrics(db, ALL_TIME);

    expect(inv!.onHand).toBe(97);
    expect(m.netRevenueCents).toBe(30_000);
    expect(m.cogsCents).toBe(15_000);
    expect(m.grossProfitCents).toBe(15_000);
    expect(m.grossMarginPct).toBe(50);
    expect(await getInventoryValue(db)).toBe(485_000);

    const moves = await db.select().from(inventoryMovements);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ type: "SALE", quantity: -3, before: 100, after: 97, reference: "ORD-10001" });
  });
});

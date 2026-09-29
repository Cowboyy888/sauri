/** calculateShipping() eligibility/pricing and customer-initiated cancellation (brief §17-18, §45). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, buyer } from "./helpers";
import { placeOrder } from "@/lib/orders/service";
import { canCustomerCancel, requestCancellation } from "@/lib/orders/cancellation";
import { calculateShipping, getEligibleShippingMethods } from "@/lib/storefront/shipping";
import { inventory, orders, shippingMethods } from "@/lib/db/schema";

afterAll(() => pool.end());

describe("calculateShipping / getEligibleShippingMethods", () => {
  beforeEach(resetDb);

  it("excludes methods restricted to a different country or region", async () => {
    const [m] = await db.insert(shippingMethods).values({
      name: "US Only", description: "", priceCents: 500, estimatedMinDays: 2, estimatedMaxDays: 4, active: true, countryCode: "US",
    }).returning();
    const usEligible = await getEligibleShippingMethods(db, { subtotalCents: 10_000, countryCode: "US" });
    expect(usEligible.some((x) => x.id === m!.id)).toBe(true);
    const caEligible = await getEligibleShippingMethods(db, { subtotalCents: 10_000, countryCode: "CA" });
    expect(caEligible.some((x) => x.id === m!.id)).toBe(false);
  });

  it("excludes methods outside the order's min/max value bounds", async () => {
    const [m] = await db.insert(shippingMethods).values({
      name: "Big Orders Only", description: "", priceCents: 0, estimatedMinDays: 1, estimatedMaxDays: 2, active: true, minOrderCents: 20_000,
    }).returning();
    const low = await getEligibleShippingMethods(db, { subtotalCents: 5_000 });
    expect(low.some((x) => x.id === m!.id)).toBe(false);
    const high = await getEligibleShippingMethods(db, { subtotalCents: 25_000 });
    expect(high.some((x) => x.id === m!.id)).toBe(true);
  });

  it("returns null for a chosen method that isn't eligible for this destination", async () => {
    const [m] = await db.insert(shippingMethods).values({
      name: "US Only", description: "", priceCents: 500, estimatedMinDays: 2, estimatedMaxDays: 4, active: true, countryCode: "US",
    }).returning();
    const result = await calculateShipping(db, { subtotalCents: 10_000, countryCode: "CA", shippingMethodId: m!.id });
    expect(result).toBeNull();
  });

  it("prices a valid method and reports its delivery estimate", async () => {
    const [m] = await db.insert(shippingMethods).values({
      name: "Standard", description: "", priceCents: 750, estimatedMinDays: 3, estimatedMaxDays: 6, active: true,
    }).returning();
    const result = await calculateShipping(db, { subtotalCents: 10_000, shippingMethodId: m!.id });
    expect(result?.shippingPriceCents).toBe(750);
    expect(result?.estimatedDeliveryDays).toEqual([3, 6]);
  });
});

describe("customer cancellation", () => {
  beforeEach(resetDb);

  async function order(status: "pending" | "paid" = "paid", quantity = 2) {
    const owner = { userId: null, name: "seed", role: "OWNER" as const };
    const { variant } = await makeVariant({ stock: 100 });
    const o = await placeOrder(db, { lines: [{ variantId: variant.id, quantity }], customer: buyer, status, channel: "MANUAL_ORDER" }, owner);
    return { order: o, variant };
  }

  it("lets a customer cancel their own paid order and restocks inventory exactly once", async () => {
    const { order: o, variant } = await order("paid", 2);
    expect(await canCustomerCancel(db, o.customerId!, o.id)).toBe(true);
    await requestCancellation(db, o.customerId!, o.id, "Changed my mind");
    const [row] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(row!.status).toBe("cancelled");
    const [inv] = await db.select().from(inventory).where(eq(inventory.variantId, variant.id));
    expect(inv!.stockQuantity).toBe(100); // 98 reserved/sold, restored back to 100 on cancel
  });

  it("blocks cancelling someone else's order", async () => {
    const { order: o } = await order("paid");
    await expect(requestCancellation(db, "00000000-0000-0000-0000-000000000000", o.id)).rejects.toThrow(/does not belong to you/);
  });

  it("blocks cancelling an order that has already shipped", async () => {
    const { order: o } = await order("paid");
    await db.update(orders).set({ status: "shipped" }).where(eq(orders.id, o.id));
    expect(await canCustomerCancel(db, o.customerId!, o.id)).toBe(false);
    await expect(requestCancellation(db, o.customerId!, o.id)).rejects.toThrow(/can no longer be cancelled online/);
  });
});

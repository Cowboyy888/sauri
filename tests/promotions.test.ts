/**
 * Promotions and coupons — brief §13-18, §53. Checkout-time validation (validateDiscount) is exercised
 * through the real `placeOrder` path, not by calling the validator directly, so this proves the server-side
 * enforcement a browser can't bypass, matching how discounts.test.ts-equivalent coverage already works
 * elsewhere in this codebase.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant } from "./helpers";
import { placeOrder, markOrderPaid } from "@/lib/orders/service";
import { createPromotion, getCouponAnalytics } from "@/lib/marketing/promotions";
import { collections, discounts, products } from "@/lib/db/schema";

const owner = { userId: null, name: "seed", role: "OWNER" as const };

async function tryOrder(variantId: string, code: string, email = `c-${Math.random()}@example.com`) {
  return placeOrder(db, { lines: [{ variantId, quantity: 1 }], discountCode: code, customer: { email, name: "Test" }, status: "pending", channel: "WEBSITE" }, owner);
}

describe("brief §53: coupon math and validation", () => {
  beforeEach(resetDb);

  it("WELCOME10: 10% off a $200 order => $20 discount, $180 subtotal after discount", async () => {
    const { variant } = await makeVariant({ stock: 20, priceCents: 20_000 });
    await createPromotion(db, owner, { code: "WELCOME10", type: "percent", value: 10 });
    const order = await tryOrder(variant.id, "WELCOME10");
    expect(order.discountTotalCents).toBe(2_000);
    expect(order.subtotalCents - order.discountTotalCents).toBe(18_000);
  });

  it("rejects an expired coupon", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    await createPromotion(db, owner, { code: "EXPIRED", type: "fixed", value: 500, endsAt: new Date(Date.now() - 86_400_000) });
    await expect(tryOrder(variant.id, "EXPIRED")).rejects.toThrow(/expired/);
  });

  it("rejects an inactive (paused) coupon", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    const p = await createPromotion(db, owner, { code: "PAUSEME", type: "fixed", value: 500 });
    await db.update(discounts).set({ active: false }).where(eq(discounts.id, p.id));
    await expect(tryOrder(variant.id, "PAUSEME")).rejects.toThrow(/not a valid code/);
  });

  it("rejects once the usage limit is reached", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    await createPromotion(db, owner, { code: "LIMITED", type: "fixed", value: 500, usageLimit: 1 });
    await tryOrder(variant.id, "LIMITED");
    await expect(tryOrder(variant.id, "LIMITED")).rejects.toThrow(/usage limit/);
  });

  it("rejects once a customer's per-customer limit is reached", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    await createPromotion(db, owner, { code: "ONEEACH", type: "fixed", value: 500, perCustomerLimit: 1 });
    await tryOrder(variant.id, "ONEEACH", "repeat@example.com");
    await expect(tryOrder(variant.id, "ONEEACH", "repeat@example.com")).rejects.toThrow(/already used/);
  });

  it("rejects when the order is below the minimum spend", async () => {
    const { variant } = await makeVariant({ stock: 20, priceCents: 1_000 });
    await createPromotion(db, owner, { code: "BIGSPEND", type: "fixed", value: 100, minSubtotalCents: 50_000 });
    await expect(tryOrder(variant.id, "BIGSPEND")).rejects.toThrow(/minimum order/);
  });

  it("rejects an invalid/unknown code", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    await expect(tryOrder(variant.id, "DOESNOTEXIST")).rejects.toThrow(/not a valid code/);
  });
});

describe("richer promotion eligibility (brief §13-14, §18)", () => {
  beforeEach(resetDb);

  it("a collection-restricted promotion only applies to products in that collection", async () => {
    const [collection] = await db.insert(collections).values({ slug: "celestial", name: "Celestial", description: "" }).returning();
    const { variant: inCollection, product } = await makeVariant({ stock: 20, priceCents: 10_000, code: "CEL" });
    await db.update(products).set({ collectionId: collection!.id }).where(eq(products.id, product.id));
    const { variant: outOfCollection } = await makeVariant({ stock: 20, priceCents: 10_000, code: "OTH" });
    await createPromotion(db, owner, { code: "CELESTIAL10", type: "percent", value: 10, eligibleCollectionIds: [collection!.id] });

    const good = await tryOrder(inCollection.id, "CELESTIAL10");
    expect(good.discountTotalCents).toBeGreaterThan(0);
    await expect(tryOrder(outOfCollection.id, "CELESTIAL10")).rejects.toThrow(/does not apply/);
  });

  it("a first-order-only promotion is rejected for a customer with a prior paid order", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    await createPromotion(db, owner, { code: "NEWCUST", type: "percent", value: 15, firstOrderOnly: true });
    const first = await tryOrder(variant.id, "", "returning@example.com");
    await markOrderPaid(db, first.id);
    await expect(tryOrder(variant.id, "NEWCUST", "returning@example.com")).rejects.toThrow(/first-time customers only/);
  });

  it("a first-order-only promotion succeeds for a genuinely new customer", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    await createPromotion(db, owner, { code: "NEWCUST2", type: "percent", value: 15, firstOrderOnly: true });
    const order = await tryOrder(variant.id, "NEWCUST2", "brandnew@example.com");
    expect(order.discountTotalCents).toBeGreaterThan(0);
  });
});

describe("coupon analytics (brief §16)", () => {
  beforeEach(resetDb);

  it("reports usage, revenue, and discount cost from real order data", async () => {
    const { variant } = await makeVariant({ stock: 20, priceCents: 10_000 });
    const promo = await createPromotion(db, owner, { code: "ANALYZE", type: "fixed", value: 1_000 });
    const order = await tryOrder(variant.id, "ANALYZE");
    await markOrderPaid(db, order.id);
    const stats = await getCouponAnalytics(db, promo.id);
    expect(stats.usageCount).toBe(1);
    expect(stats.orders).toBe(1);
    expect(stats.discountCostCents).toBe(1_000);
    expect(stats.revenueCents).toBe(9_000);
    expect(stats.newCustomers).toBe(1);
  });
});

afterAll(() => pool.end());

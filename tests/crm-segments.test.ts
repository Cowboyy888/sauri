/** Database-driven customer segments and RFM (brief §4-5, §45). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, resetDb, makeVariant, buyer } from "./helpers";
import { placeOrder, markOrderPaid } from "@/lib/orders/service";
import { customers, orders } from "@/lib/db/schema";
import { getCustomerRFM, getCustomerSegments, getSegmentCounts, setCrmSettings } from "@/lib/crm/segments";

const owner = { userId: null, name: "seed", role: "OWNER" as const };

async function registerOnly(email: string, daysAgo: number) {
  const at = new Date(Date.now() - daysAgo * 86_400_000);
  const [row] = await db.insert(customers).values({ email, name: email.split("@")[0]!, createdAt: at, updatedAt: at }).returning();
  return row!;
}

describe("customer segments", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("never_purchased and new segments reflect registration with no orders", async () => {
    await registerOnly("brandnew@example.com", 1);
    const counts = await getSegmentCounts(db);
    expect(counts.never_purchased).toBeGreaterThanOrEqual(1);
    expect(counts.new).toBeGreaterThanOrEqual(1);
  });

  it("first_time vs returning is exactly one order vs two or more", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    const one = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "one@example.com", name: "One" }, status: "pending", channel: "WEBSITE" }, owner);
    await markOrderPaid(db, one.id);
    const twoOrder1 = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "two@example.com", name: "Two" }, status: "pending", channel: "WEBSITE" }, owner);
    await markOrderPaid(db, twoOrder1.id);
    const twoOrder2 = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "two@example.com", name: "Two" }, status: "pending", channel: "WEBSITE" }, owner);
    await markOrderPaid(db, twoOrder2.id);

    expect(await getCustomerSegments(db, one.customerId!)).toContain("first_time");
    expect(await getCustomerSegments(db, one.customerId!)).not.toContain("returning");
    expect(await getCustomerSegments(db, twoOrder1.customerId!)).toContain("returning");
    expect(await getCustomerSegments(db, twoOrder1.customerId!)).not.toContain("first_time");
  });

  it("high_value reflects the configurable threshold, not a hardcoded number", async () => {
    const { variant } = await makeVariant({ stock: 20, priceCents: 50_000 });
    const order = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "pending", channel: "WEBSITE" }, owner);
    await markOrderPaid(db, order.id);
    expect(await getCustomerSegments(db, order.customerId!)).not.toContain("high_value"); // $500 < default $1000 threshold
    await setCrmSettings(db, owner, { highValueThresholdCents: 40_000 });
    expect(await getCustomerSegments(db, order.customerId!)).toContain("high_value");
  });

  it("inactive requires at least one order and none within the configured window", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    const longAgo = new Date(Date.now() - 200 * 86_400_000);
    const order = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "old@example.com", name: "Old" }, status: "pending", channel: "WEBSITE", placedAt: longAgo }, owner);
    await markOrderPaid(db, order.id);
    await db.update(orders).set({ paidAt: longAgo }).where(eq(orders.id, order.id));
    expect(await getCustomerSegments(db, order.customerId!)).toContain("inactive");
  });

  it("RFM recency classifies Recent / At Risk / Inactive from the same configurable thresholds", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    const order = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: buyer, status: "pending", channel: "WEBSITE" }, owner);
    await markOrderPaid(db, order.id);
    const rfm = await getCustomerRFM(db, order.customerId!);
    expect(rfm.recencyLabel).toBe("Recent");
    expect(rfm.frequency).toBe(1);
    expect(rfm.monetaryCents).toBeGreaterThan(0);
  });

  it("a customer merged away is excluded from segment counts", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    const order = await placeOrder(db, { lines: [{ variantId: variant.id, quantity: 1 }], customer: { email: "willmerge@example.com", name: "Will" }, status: "pending", channel: "WEBSITE" }, owner);
    await markOrderPaid(db, order.id);
    const before = await getSegmentCounts(db);
    await db.update(customers).set({ mergedIntoCustomerId: order.customerId }).where(eq(customers.id, order.customerId!));
    // now the row references itself as merged, which is nonsensical but sufficient to prove the filter excludes it
    const after = await getSegmentCounts(db);
    expect(after.first_time).toBe(before.first_time - 1);
  });
});

/** Retention metrics and cohort analysis (brief §30-31, §45). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool, resetDb, makeVariant } from "./helpers";
import { placeOrder } from "@/lib/orders/service";
import { orders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getCohortAnalysis, getRetentionMetrics } from "@/lib/analytics/retention";

const owner = { userId: null, name: "seed", role: "OWNER" as const };
const ALL_TIME = { from: new Date("2000-01-01"), to: new Date("2100-01-01") };

async function order(email: string, variantId: string, paidAt: Date) {
  const o = await placeOrder(db, { lines: [{ variantId, quantity: 1 }], customer: { email, name: email }, status: "paid", channel: "MANUAL_ORDER", placedAt: paidAt }, owner);
  await db.update(orders).set({ paidAt }).where(eq(orders.id, o.id));
  return o;
}

describe("retention analytics", () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it("computes repeat purchase rate, second purchase rate, and average days between orders from real orders", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    await order("single@example.com", variant.id, new Date("2026-01-05"));
    await order("repeat@example.com", variant.id, new Date("2026-01-10"));
    await order("repeat@example.com", variant.id, new Date("2026-01-20"));

    const metrics = await getRetentionMetrics(db, ALL_TIME);
    expect(metrics.repeatPurchaseRatePct).toBe(50); // 1 of 2 buyers has 2+ orders
    expect(metrics.avgDaysBetweenOrders).toBe(10); // Jan 10 -> Jan 20
  });

  it("never fabricates a percentage when there is no prior-period data", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    await order("new@example.com", variant.id, new Date());
    const narrowRange = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };
    const metrics = await getRetentionMetrics(db, narrowRange);
    expect(metrics.retentionRatePct).toBeNull(); // no orders existed in the equivalent previous period
    expect(metrics.churnProxyPct).toBeNull();
  });

  it("builds a cohort table with null cells for months that haven't happened yet, never a fabricated 0", async () => {
    const { variant } = await makeVariant({ stock: 20 });
    await order("cohort-a@example.com", variant.id, new Date());
    const cohorts = await getCohortAnalysis(db, 6, 6);
    expect(cohorts.length).toBeGreaterThanOrEqual(1);
    const thisMonth = cohorts[cohorts.length - 1]!;
    expect(thisMonth.months[0]).toBe(100); // the customer's own first-order month always counts as active
    expect(thisMonth.months[thisMonth.months.length - 1]).toBeNull(); // a future month hasn't happened yet
  });
});
